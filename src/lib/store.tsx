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
  BomItem,
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
  insertarItem,
  leerActual,
  renombrarEnTienda,
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
  /** Salió bien, pero hay algo para avisar (stock en negativo, receta incompleta…) */
  aviso?: string;
}

/**
 * Por qué cambió el stock al editar una ficha. Antes, cambiar el número en
 * "Editar" lo pisaba sin más: una producción cargada así no descontaba la
 * receta, una compra quedaba como "edición" y, con el formulario abierto un
 * rato, se borraba cualquier venta de la tienda que entrara mientras tanto.
 */
export type MotivoStock = 'produccion' | 'ingreso' | 'conteo' | 'consumo';

export interface OpcionesFicha {
  /** El stock que la persona tenía a la vista cuando abrió el formulario */
  actualVisto?: number;
  motivoStock?: MotivoStock;
}

/** Una cantidad que se suma o se descuenta: número real y mayor a cero */
function cantidadValida(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n) && n > 0;
}

/**
 * La receta con cada componente una sola vez. Si el mismo ítem aparece en dos
 * líneas (ACE-03 tenía la pimienta repetida), se suman: así la base recibe un
 * solo descuento por ítem y el historial muestra bien cuánto quedó.
 */
function recetaAgrupada(bom: BomItem[]): BomItem[] {
  const porClave = new Map<string, BomItem>();
  for (const l of bom ?? []) {
    const k = `${l.categoria}|${l.codigo}`;
    const cant = Number(l.cantidad) || 0;
    const prev = porClave.get(k);
    porClave.set(k, prev ? { ...prev, cantidad: prev.cantidad + cant } : { ...l, cantidad: cant });
  }
  return [...porClave.values()];
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
  upsertProducto: (
    p: Producto,
    codigoOriginal?: string,
    opciones?: OpcionesFicha
  ) => Promise<Resultado>;
  upsertItem: (
    categoria: Categoria,
    item: any,
    codigoOriginal?: string,
    opciones?: OpcionesFicha
  ) => Promise<Resultado>;
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
      setGuardando(true);
      try {
        return await aplicarRegistro(codigoProducto, cantidad, tipoMov, nota);
      } finally {
        setGuardando(false);
      }
    }

    /**
     * El registro en sí, sin tocar el indicador de "guardando" (lo usa también
     * la edición de una ficha). `productoFicha` es la ficha recién guardada:
     * si en el mismo guardado se cambió la receta, se produce con la nueva.
     */
    async function aplicarRegistro(
      codigoProducto: string,
      cantidad: number,
      tipoMov: 'venta' | 'produccion',
      nota?: string,
      productoFicha?: Producto
    ): Promise<VentaResultado> {
      const vacia: VentaResultado = { ok: false, mensaje: '', componentes: [], alertas: [] };
      if (!esAdmin) return { ...vacia, mensaje: SIN_PERMISO, error: SIN_PERMISO };
      if (!cantidadValida(cantidad)) {
        const error = 'La cantidad tiene que ser un número mayor a cero.';
        return { ...vacia, mensaje: error, error };
      }

      const encontrado =
        productoFicha ?? state.productos.find((p) => p.codigo === codigoProducto);
      if (!encontrado) return { ...vacia, mensaje: 'Producto no encontrado' };
      const producto: Producto = { ...encontrado, bom: recetaAgrupada(encontrado.bom) };

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
      }
    }

    /** Manda un movimiento a la base y deja el estado local igual a lo que quedó allá */
    async function aplicarYAnotar(deltas: Delta[], mov: Movimiento): Promise<void> {
      const { resultantes, movimiento } = await aplicarMovimiento(deltas, mov);
      aplicarResultantes(resultantes);
      if (movimiento)
        setState((prev) => ({ ...prev, movimientos: [movimiento, ...prev.movimientos] }));
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
        await aplicarYAnotar(deltas, mov);
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

    /** Reemplaza (o agrega) un ítem en el estado local */
    function ponerEnEstado(categoria: Categoria, codigoViejo: string, item: any) {
      setState((prev) => {
        const next = structuredClone(prev);
        const lista = listaDe(next, categoria) as any[];
        const idx = lista.findIndex((x) => x.codigo === codigoViejo);
        if (idx >= 0) lista[idx] = item;
        else lista.unshift(item);
        return next;
      });
    }

    /**
     * Alta o edición de una ficha (cualquier categoría).
     *
     * El stock nunca viaja en el guardado de la ficha: si cambió, va aparte por
     * st_aplicar —con la fila bloqueada— y según el motivo que eligió la
     * persona: una producción descuenta la receta, un ingreso suma sobre el
     * stock real (no pisa las ventas que entraron mientras el formulario estaba
     * abierto) y sólo el conteo físico fija un número exacto.
     *
     * El cambio de stock se mide contra lo que la persona VIO al abrir el
     * formulario, no contra el estado actual: si mientras tanto se recargaron
     * los datos, no editar el campo ya no puede pisar una venta.
     */
    async function guardarFicha(
      categoria: Categoria,
      item: any,
      codigoOriginal?: string,
      opciones: OpcionesFicha = {}
    ): Promise<Resultado> {
      if (!esAdmin) return { ok: false, error: SIN_PERMISO };
      const esAlta = !codigoOriginal;
      const codigoViejo = codigoOriginal ?? item.codigo;
      const anterior = buscarItem(state, categoria, codigoViejo);
      const actualNuevo = Number(item.actual);

      if (!Number.isFinite(actualNuevo)) return { ok: false, error: 'El stock tiene que ser un número.' };
      if (esAlta && anterior)
        return { ok: false, error: `Ya existe ${item.codigo}. Buscalo en la lista y editalo.` };
      if (!esAlta && !anterior)
        return {
          ok: false,
          error: 'Este ítem ya no está en el inventario (lo pudo haber eliminado otra persona). Actualizá la página.',
        };

      const renombra = !esAlta && codigoViejo !== item.codigo;
      const visto = opciones.actualVisto;
      const deltaStock = !esAlta && visto != null ? actualNuevo - visto : 0;
      const motivo = opciones.motivoStock;
      if (deltaStock !== 0) {
        if (!motivo) return { ok: false, error: 'Elegí por qué cambia el stock.' };
        if (motivo === 'produccion' && (categoria !== 'producto' || deltaStock < 0))
          return { ok: false, error: 'Sólo se puede producir para sumar stock de un producto.' };
        if (motivo === 'ingreso' && deltaStock < 0)
          return { ok: false, error: 'Un ingreso sólo puede sumar stock.' };
        if (motivo === 'consumo' && deltaStock > 0)
          return { ok: false, error: 'Un consumo sólo puede restar stock.' };
        if (motivo === 'conteo' && actualNuevo < 0)
          return { ok: false, error: 'Un conteo físico no puede dar negativo.' };
      }

      setGuardando(true);
      try {
        // ---------- ALTA ----------
        if (esAlta) {
          await insertarItem(categoria, item);
          ponerEnEstado(categoria, item.codigo, item);
          await aplicarYAnotar(
            [],
            anotar(
              'alta',
              categoria,
              item.codigo,
              item.nombre,
              actualNuevo || 0,
              actualNuevo
                ? `Ítem creado con ${actualNuevo} en stock`
                : 'Ítem creado (sin stock inicial)'
            )
          );
          return { ok: true };
        }

        // ---------- FICHA (sin el stock) ----------
        let stockBase = anterior!.actual;
        if (renombra) {
          // La fila nueva nace con el stock REAL de la vieja, leído recién.
          // Primero se crea la nueva y recién después se borra la vieja: si
          // algo falla en el medio, el ítem no desaparece.
          const real = await leerActual(categoria, codigoViejo);
          if (real == null) throw new Error('El ítem ya no está en la base. Actualizá la página.');
          stockBase = real;
          await insertarItem(categoria, { ...item, actual: real });
          await borrarItem(categoria, codigoViejo);
        } else {
          await guardarItem(categoria, item);
        }
        const guardado = { ...item, actual: stockBase };
        ponerEnEstado(categoria, codigoViejo, guardado);

        const sinStock = (x: any) => ({ ...x, actual: undefined });
        const cambios = describirCambios(sinStock(anterior), sinStock(item));
        if (cambios.length)
          await aplicarYAnotar(
            [],
            anotar('edicion', categoria, item.codigo, item.nombre, 0, cambios.join(' · '))
          );

        // ---------- CAMBIO DE CÓDIGO: recetas y tienda lo siguen ----------
        const avisos: string[] = [];
        if (renombra) {
          if (categoria !== 'producto') {
            const usan = state.productos.filter((p) =>
              p.bom.some((b) => b.categoria === categoria && b.codigo === codigoViejo)
            );
            for (const p of usan) {
              const actualizado: Producto = {
                ...p,
                bom: p.bom.map((b) =>
                  b.categoria === categoria && b.codigo === codigoViejo
                    ? { ...b, codigo: item.codigo }
                    : b
                ),
              };
              await guardarItem('producto', actualizado);
              ponerEnEstado('producto', p.codigo, actualizado);
              await aplicarYAnotar(
                [],
                anotar(
                  'edicion',
                  'producto',
                  p.codigo,
                  p.nombre,
                  0,
                  `receta: ${codigoViejo} → ${item.codigo} (cambió el código del componente)`
                )
              );
            }
            if (usan.length) avisos.push(`Se actualizaron ${usan.length} receta(s).`);
          }
          const tienda = await renombrarEnTienda(categoria, codigoViejo, item.codigo);
          if (tienda.vinculos)
            avisos.push(`Se actualizaron ${tienda.vinculos} vínculo(s) con la tienda.`);
        }

        // ---------- CAMBIO DE STOCK, según el motivo ----------
        if (deltaStock !== 0) {
          const codigo = item.codigo;
          if (motivo === 'produccion') {
            const r = await aplicarRegistro(
              codigo,
              deltaStock,
              'produccion',
              'Cargada desde la ficha del producto',
              guardado as Producto
            );
            if (!r.ok)
              return {
                ok: false,
                error: `La ficha se guardó, pero la producción no: ${r.error ?? r.mensaje}`,
              };
            if (r.alertas.length) avisos.push(...r.alertas);
          } else if (motivo === 'ingreso') {
            await aplicarYAnotar(
              [{ categoria, codigo, delta: deltaStock }],
              anotar('ingreso', categoria, codigo, item.nombre, deltaStock, `Ingreso de ${deltaStock}`)
            );
          } else if (motivo === 'consumo') {
            await aplicarYAnotar(
              [{ categoria, codigo, delta: deltaStock }],
              anotar('consumo_interno', categoria, codigo, item.nombre, -deltaStock, 'Consumo interno')
            );
          } else {
            await aplicarYAnotar(
              [{ categoria, codigo, set: actualNuevo }],
              anotar(
                'ajuste',
                categoria,
                codigo,
                item.nombre,
                actualNuevo - stockBase,
                `Conteo físico: quedó en ${actualNuevo}`
              )
            );
          }
        }
        return { ok: true, aviso: avisos.length ? avisos.join(' ') : undefined };
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
        if (!cantidadValida(cantidad))
          return { ok: false, error: 'La cantidad tiene que ser un número mayor a cero.' };
        return movimientoSimple(
          [{ categoria, codigo, delta: cantidad }],
          anotar('ingreso', categoria, codigo, item.nombre, cantidad, `Ingreso de ${cantidad}`)
        );
      },

      async consumoInterno(categoria, codigo, cantidad, nota) {
        const item = buscarItem(state, categoria, codigo);
        if (!item) return { ok: false, error: 'No se encontró el ítem.' };
        if (!cantidadValida(cantidad))
          return { ok: false, error: 'La cantidad tiene que ser un número mayor a cero.' };
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
        if (!Number.isFinite(nuevoActual) || nuevoActual < 0)
          return { ok: false, error: 'El conteo tiene que ser un número de cero para arriba.' };
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

      upsertProducto: (p, codigoOriginal, opciones) =>
        guardarFicha('producto', p, codigoOriginal, opciones),
      upsertItem: (categoria, item, codigoOriginal, opciones) =>
        guardarFicha(categoria, item, codigoOriginal, opciones),

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
