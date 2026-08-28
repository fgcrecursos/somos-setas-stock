// =====================================================================
// Estado de la aplicación.
//
// La fuente de verdad son las tablas st_items / st_movimientos de Supabase:
// lo que uno carga, lo ve el resto. En memoria se mantiene la misma forma de
// siempre (DBState) para que las vistas no cambien, pero cada modificación
// viaja a la base y el stock resultante vuelve de ahí.
// =====================================================================
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type {
  Categoria,
  ComponenteMovido,
  DBState,
  Etiqueta,
  Insumo,
  MateriaPrima,
  Movimiento,
  Producto,
} from './types';
import { buscarItem, describirCambios, listaDe, uid } from './helpers';
import { useAuth } from './auth';
import {
  aplicarMovimiento,
  borrarItem,
  contarItems,
  estadoVacio,
  guardarItem,
  subirTodo,
  traerTodo,
  vaciarItems,
  type Delta,
} from './cloud';
import {
  seedEtiquetas,
  seedInsumos,
  seedInsumosInternos,
  seedMateriaPrima,
  seedProductos,
} from '../data/seed';

/** Datos que quedaron guardados en este navegador antes de que existiera la nube */
const LEGACY_KEY = 'somos-setas-stock:v1';

export function estadoDelExcel(): DBState {
  return {
    productos: structuredClone(seedProductos),
    insumos: structuredClone(seedInsumos),
    insumosInternos: structuredClone(seedInsumosInternos),
    etiquetas: structuredClone(seedEtiquetas),
    materiaPrima: structuredClone(seedMateriaPrima),
    movimientos: [],
  };
}

function estadoGuardadoEnEsteNavegador(): DBState | null {
  try {
    const raw = localStorage.getItem(LEGACY_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as DBState;
    if (!parsed?.productos?.length) return null;
    return parsed;
  } catch {
    return null;
  }
}

export interface Resultado {
  ok: boolean;
  error?: string;
}

export interface VentaResultado extends Resultado {
  mensaje: string;
  producto?: Producto;
  componentes: ComponenteMovido[];
  alertas: string[];
}

interface StoreCtx {
  state: DBState;
  cargando: boolean;
  errorCarga: string | null;
  /** La base todavía no tiene ningún ítem cargado */
  vacio: boolean;
  /** Inventario que había quedado en este navegador, para la carga inicial */
  datosLocales: DBState | null;
  puedeEditar: boolean;
  guardando: boolean;
  refrescar: () => Promise<void>;
  cargaInicial: (origen: 'navegador' | 'excel') => Promise<Resultado>;
  vender: (codigoProducto: string, cantidad: number, nota?: string) => Promise<VentaResultado>;
  producir: (codigoProducto: string, cantidad: number, nota?: string) => Promise<VentaResultado>;
  /** Salida de stock que NO es venta: lo usó el equipo (muestras, pruebas, consumo) */
  consumoInterno: (
    categoria: Categoria,
    codigo: string,
    cantidad: number,
    nota?: string
  ) => Promise<Resultado>;
  ingreso: (categoria: Categoria, codigo: string, cantidad: number) => Promise<Resultado>;
  ajustar: (categoria: Categoria, codigo: string, nuevoActual: number) => Promise<Resultado>;
  upsertProducto: (p: Producto, codigoOriginal?: string) => Promise<Resultado>;
  upsertItem: (categoria: Categoria, item: any, codigoOriginal?: string) => Promise<Resultado>;
  eliminarItem: (categoria: Categoria, codigo: string) => Promise<Resultado>;
  restablecerDesdeExcel: () => Promise<Resultado>;
}

const Ctx = createContext<StoreCtx | null>(null);

const SIN_PERMISO = 'Tu usuario es de solo lectura: no podés modificar el stock.';

function mensajeError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (/row-level security|permission|policy/i.test(msg)) return SIN_PERMISO;
  if (/failed to fetch|network/i.test(msg))
    return 'No se pudo conectar con la base de datos. Revisá la conexión y volvé a intentar.';
  return msg;
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const { esAdmin, email } = useAuth();
  const [state, setState] = useState<DBState>(estadoVacio);
  const [cargando, setCargando] = useState(true);
  const [errorCarga, setErrorCarga] = useState<string | null>(null);
  const [vacio, setVacio] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [datosLocales] = useState<DBState | null>(estadoGuardadoEnEsteNavegador);
  const ultimaCarga = useRef(0);

  const refrescar = useCallback(async () => {
    try {
      const cantidad = await contarItems();
      if (cantidad === 0) {
        setVacio(true);
        setState(estadoVacio());
        setErrorCarga(null);
        return;
      }
      const nuevo = await traerTodo();
      setState(nuevo);
      setVacio(false);
      setErrorCarga(null);
      ultimaCarga.current = Date.now();
    } catch (err) {
      setErrorCarga(mensajeError(err));
    }
  }, []);

  useEffect(() => {
    let vivo = true;
    setCargando(true);
    refrescar().finally(() => {
      if (vivo) setCargando(false);
    });
    return () => {
      vivo = false;
    };
  }, [refrescar]);

  // Al volver a la pestaña se recargan los datos: si otra persona vendió algo
  // mientras tanto, se ve al instante y no se trabaja sobre números viejos.
  useEffect(() => {
    const alVolver = () => {
      if (document.visibilityState !== 'visible') return;
      if (Date.now() - ultimaCarga.current < 15000) return;
      refrescar();
    };
    window.addEventListener('focus', alVolver);
    document.addEventListener('visibilitychange', alVolver);
    return () => {
      window.removeEventListener('focus', alVolver);
      document.removeEventListener('visibilitychange', alVolver);
    };
  }, [refrescar]);

  /** Escribe en el estado local el stock que devolvió la base */
  const aplicarResultantes = useCallback(
    (resultantes: { categoria: Categoria; codigo: string; actual: number }[]) => {
      setState((prev) => {
        const next = structuredClone(prev);
        for (const r of resultantes) {
          const item = buscarItem(next, r.categoria, r.codigo);
          if (item) item.actual = r.actual;
        }
        return next;
      });
    },
    []
  );

  const api = useMemo<StoreCtx>(() => {
    /** Venta y producción comparten todo salvo el signo del producto terminado */
    async function registrar(
      codigoProducto: string,
      cantidad: number,
      tipoMov: 'venta' | 'produccion',
      nota?: string
    ): Promise<VentaResultado> {
      const vacia: VentaResultado = { ok: false, mensaje: '', componentes: [], alertas: [] };
      if (!esAdmin) return { ...vacia, mensaje: SIN_PERMISO, error: SIN_PERMISO };

      const producto = state.productos.find((p) => p.codigo === codigoProducto);
      if (!producto) return { ...vacia, mensaje: 'Producto no encontrado' };

      // Avisos de receta (sólo al producir): no bloquean, pero quedan marcados.
      const avisosReceta: string[] = [];
      if (tipoMov === 'produccion') {
        const faltantes = producto.bom.filter(
          (b) => !buscarItem(state, b.categoria, b.codigo)
        );
        if (producto.bom.length === 0) {
          avisosReceta.push(
            `${producto.nombre} no tiene receta cargada: la producción no descuenta ningún insumo.`
          );
        } else if (faltantes.length) {
          avisosReceta.push(
            `No se descuentan (no están en el inventario): ${faltantes
              .map((b) => b.codigo)
              .join(', ')}. Corregí la receta en Productos.`
          );
        }
      }

      const deltas: Delta[] = [
        {
          categoria: 'producto',
          codigo: producto.codigo,
          delta: tipoMov === 'venta' ? -cantidad : cantidad,
        },
      ];
      // La receta se consume al producir (es cuando se elabora el producto y se
      // gastan los insumos reales). La venta sólo mueve el stock del producto
      // terminado, que ya salió descontado de la receta al producirse.
      const componentes: ComponenteMovido[] =
        tipoMov === 'produccion'
          ? producto.bom.map((linea) => {
              const comp = buscarItem(state, linea.categoria, linea.codigo);
              const consumido = linea.cantidad * cantidad;
              deltas.push({ categoria: linea.categoria, codigo: linea.codigo, delta: -consumido });
              return {
                categoria: linea.categoria,
                codigo: linea.codigo,
                nombre: comp?.nombre ?? '(no encontrado)',
                cantidad: consumido,
                resultante: (comp?.actual ?? 0) - consumido,
                faltante: !comp || comp.actual - consumido < 0,
              };
            })
          : [];

      const mov: Movimiento = {
        id: uid(),
        fecha: new Date().toISOString(),
        tipo: tipoMov,
        categoria: 'producto',
        codigo: producto.codigo,
        nombre: producto.nombre,
        cantidad,
        nota,
        componentes,
        usuario: email,
        incidencia: avisosReceta.length ? avisosReceta.join(' ') : undefined,
      };

      setGuardando(true);
      try {
        const { resultantes, movimiento } = await aplicarMovimiento(deltas, mov);
        aplicarResultantes(resultantes);
        const guardado = movimiento ?? mov;
        setState((prev) => ({ ...prev, movimientos: [guardado, ...prev.movimientos] }));

        // Las alertas se arman con el stock REAL que devolvió la base.
        // Los avisos de receta (vacía / componentes inexistentes) van primero.
        const alertas: string[] = [...avisosReceta];
        const finales = guardado.componentes ?? componentes;
        for (const c of finales) {
          const item = buscarItem(state, c.categoria, c.codigo);
          if (!item) {
            alertas.push(`El componente ${c.codigo} ya no existe en el stock.`);
            continue;
          }
          if (c.resultante < 0) {
            alertas.push(
              `${item.nombre} (${c.codigo}) quedó en negativo: faltan ${Math.abs(c.resultante)}.`
            );
          } else if (c.resultante < item.minimo) {
            alertas.push(
              `${item.nombre} (${c.codigo}) por debajo del mínimo (${c.resultante}/${item.minimo}).`
            );
          }
        }

        const prodFinal = resultantes.find(
          (r) => r.categoria === 'producto' && r.codigo === producto.codigo
        );
        return {
          ok: true,
          mensaje:
            tipoMov === 'venta'
              ? `Venta registrada: ${cantidad} × ${producto.nombre}`
              : `Producción registrada: ${cantidad} × ${producto.nombre}`,
          producto: prodFinal ? { ...producto, actual: prodFinal.actual } : producto,
          componentes: finales,
          alertas,
        };
      } catch (err) {
        const error = mensajeError(err);
        return { ...vacia, mensaje: error, error };
      } finally {
        setGuardando(false);
      }
    }

    /**
     * Movimiento de una sola línea (sin receta): ingreso, ajuste, consumo
     * interno, alta, edición o baja. Si `deltas` viene vacío no toca el stock,
     * sólo deja el movimiento anotado en el historial.
     */
    async function movimientoSimple(deltas: Delta[], mov: Movimiento): Promise<Resultado> {
      if (!esAdmin) return { ok: false, error: SIN_PERMISO };
      setGuardando(true);
      try {
        const { resultantes, movimiento } = await aplicarMovimiento(deltas, mov);
        aplicarResultantes(resultantes);
        if (movimiento)
          setState((prev) => ({ ...prev, movimientos: [movimiento, ...prev.movimientos] }));
        return { ok: true };
      } catch (err) {
        return { ok: false, error: mensajeError(err) };
      } finally {
        setGuardando(false);
      }
    }

    /** Anota un movimiento en el historial sin tocar el stock (altas, ediciones, bajas) */
    function anotar(
      tipo: Movimiento['tipo'],
      categoria: Categoria,
      codigo: string,
      nombre: string,
      cantidad: number,
      nota: string
    ): Movimiento {
      return {
        id: uid(),
        fecha: new Date().toISOString(),
        tipo,
        categoria,
        codigo,
        nombre,
        cantidad,
        nota,
        usuario: email,
        origen: 'plataforma',
      };
    }

    /**
     * Alta o edición de una ficha (cualquier categoría).
     *
     * Deja anotado en el historial qué se creó o qué campos cambiaron. Si en una
     * edición cambió el stock, ese cambio va por st_aplicar —con la fila
     * bloqueada— en vez de viajar en el upsert de la ficha: así editar el
     * nombre de un producto no pisa una venta que alguien registró mientras el
     * formulario estaba abierto.
     */
    async function guardarFicha(
      categoria: Categoria,
      item: any,
      codigoOriginal?: string
    ): Promise<Resultado> {
      if (!esAdmin) return { ok: false, error: SIN_PERMISO };
      const anterior = codigoOriginal
        ? buscarItem(state, categoria, codigoOriginal)
        : buscarItem(state, categoria, item.codigo);
      const esAlta = !anterior;
      const actualNuevo = Number(item.actual) || 0;
      const cambioStock = !esAlta && actualNuevo !== (anterior?.actual ?? 0);

      setGuardando(true);
      try {
        await guardarItem(categoria, item, codigoOriginal, !esAlta);

        const guardado = esAlta || cambioStock ? item : { ...item, actual: anterior!.actual };
        setState((prev) => {
          const next = structuredClone(prev);
          const lista = listaDe(next, categoria) as any[];
          const key = codigoOriginal ?? item.codigo;
          const idx = lista.findIndex((x) => x.codigo === key);
          if (idx >= 0) lista[idx] = guardado;
          else lista.unshift(guardado);
          return next;
        });

        if (esAlta) {
          const mov = await aplicarMovimiento(
            [],
            anotar(
              'alta',
              categoria,
              item.codigo,
              item.nombre,
              actualNuevo,
              actualNuevo
                ? `Ítem creado con ${actualNuevo} en stock`
                : 'Ítem creado (sin stock inicial)'
            )
          );
          if (mov.movimiento)
            setState((prev) => ({
              ...prev,
              movimientos: [mov.movimiento!, ...prev.movimientos],
            }));
        } else {
          const cambios = describirCambios(anterior, item);
          if (cambios.length) {
            const { resultantes, movimiento } = await aplicarMovimiento(
              cambioStock ? [{ categoria, codigo: item.codigo, set: actualNuevo }] : [],
              anotar(
                'edicion',
                categoria,
                item.codigo,
                item.nombre,
                cambioStock ? actualNuevo - (anterior?.actual ?? 0) : 0,
                cambios.join(' · ')
              )
            );
            aplicarResultantes(resultantes);
            if (movimiento)
              setState((prev) => ({ ...prev, movimientos: [movimiento, ...prev.movimientos] }));
          }
        }
        return { ok: true };
      } catch (err) {
        return { ok: false, error: mensajeError(err) };
      } finally {
        setGuardando(false);
      }
    }

    /** Envuelve una escritura simple: chequea permiso, marca guardando y traduce el error */
    async function escribir(fn: () => Promise<void>): Promise<Resultado> {
      if (!esAdmin) return { ok: false, error: SIN_PERMISO };
      setGuardando(true);
      try {
        await fn();
        return { ok: true };
      } catch (err) {
        return { ok: false, error: mensajeError(err) };
      } finally {
        setGuardando(false);
      }
    }

    return {
      state,
      cargando,
      errorCarga,
      vacio,
      datosLocales,
      puedeEditar: esAdmin,
      guardando,
      refrescar,

      async cargaInicial(origen) {
        if (!esAdmin) return { ok: false, error: SIN_PERMISO };
        const inicial = origen === 'navegador' ? datosLocales : estadoDelExcel();
        if (!inicial) return { ok: false, error: 'No hay datos guardados en este navegador.' };
        setGuardando(true);
        try {
          await subirTodo(inicial);
          await refrescar();
          return { ok: true };
        } catch (err) {
          return { ok: false, error: mensajeError(err) };
        } finally {
          setGuardando(false);
        }
      },

      vender: (codigo, cantidad, nota) => registrar(codigo, cantidad, 'venta', nota),
      producir: (codigo, cantidad, nota) => registrar(codigo, cantidad, 'produccion', nota),

      async ingreso(categoria, codigo, cantidad) {
        const item = buscarItem(state, categoria, codigo);
        if (!item) return { ok: false, error: 'No se encontró el ítem.' };
        return movimientoSimple(
          [{ categoria, codigo, delta: cantidad }],
          anotar('ingreso', categoria, codigo, item.nombre, cantidad, `Ingreso de ${cantidad}`)
        );
      },

      async consumoInterno(categoria, codigo, cantidad, nota) {
        const item = buscarItem(state, categoria, codigo);
        if (!item) return { ok: false, error: 'No se encontró el ítem.' };
        if (cantidad <= 0) return { ok: false, error: 'La cantidad tiene que ser mayor a cero.' };
        // Sale del stock igual que una venta, pero sin plata de por medio: no
        // suma a ventas ni a facturación. Como una venta, tampoco toca la receta:
        // lo que se consume es el producto ya terminado.
        return movimientoSimple(
          [{ categoria, codigo, delta: -cantidad }],
          anotar(
            'consumo_interno',
            categoria,
            codigo,
            item.nombre,
            cantidad,
            nota?.trim() || 'Consumo interno'
          )
        );
      },

      async ajustar(categoria, codigo, nuevoActual) {
        const item = buscarItem(state, categoria, codigo);
        if (!item) return { ok: false, error: 'No se encontró el ítem.' };
        // `set` en vez de delta: es un conteo físico, vale el número exacto.
        return movimientoSimple(
          [{ categoria, codigo, set: nuevoActual }],
          anotar(
            'ajuste',
            categoria,
            codigo,
            item.nombre,
            nuevoActual - item.actual,
            `Ajuste manual a ${nuevoActual}`
          )
        );
      },

      upsertProducto: (p, codigoOriginal) => guardarFicha('producto', p, codigoOriginal),
      upsertItem: (categoria, item, codigoOriginal) =>
        guardarFicha(categoria, item, codigoOriginal),

      eliminarItem: (categoria, codigo) =>
        escribir(async () => {
          const item = buscarItem(state, categoria, codigo);
          await borrarItem(categoria, codigo);
          setState((prev) => {
            const next = structuredClone(prev);
            const lista = listaDe(next, categoria) as any[];
            const idx = lista.findIndex((x) => x.codigo === codigo);
            if (idx >= 0) lista.splice(idx, 1);
            return next;
          });
          // El stock que tenía sale del sistema: queda anotado para que el
          // historial cierre y no aparezca stock evaporado sin explicación.
          const baja = await aplicarMovimiento(
            [],
            anotar(
              'baja',
              categoria,
              codigo,
              item?.nombre ?? codigo,
              -(item?.actual ?? 0),
              item?.actual
                ? `Ítem eliminado del sistema (tenía ${item.actual} en stock)`
                : 'Ítem eliminado del sistema'
            )
          ).catch(() => {
            /* el ítem ya se borró: que falle el registro no puede revertir la baja */
            return null;
          });
          if (baja?.movimiento)
            setState((prev) => ({ ...prev, movimientos: [baja.movimiento!, ...prev.movimientos] }));
        }),

      async restablecerDesdeExcel() {
        if (!esAdmin) return { ok: false, error: SIN_PERMISO };
        setGuardando(true);
        try {
          await vaciarItems();
          await subirTodo(estadoDelExcel());
          await refrescar();
          return { ok: true };
        } catch (err) {
          return { ok: false, error: mensajeError(err) };
        } finally {
          setGuardando(false);
        }
      },
    };
  }, [
    state,
    cargando,
    errorCarga,
    vacio,
    datosLocales,
    esAdmin,
    email,
    guardando,
    refrescar,
    aplicarResultantes,
  ]);

  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

export function useStore(): StoreCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useStore debe usarse dentro de StoreProvider');
  return ctx;
}

export type { Producto, Insumo, Etiqueta, MateriaPrima };
