import {
  createContext,
  useContext,
  useEffect,
  useMemo,
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
import { buscarItem, listaDe, uid } from './helpers';
import {
  seedEtiquetas,
  seedInsumos,
  seedInsumosInternos,
  seedMateriaPrima,
  seedProductos,
} from '../data/seed';

const STORAGE_KEY = 'somos-setas-stock:v1';

function seedState(): DBState {
  return {
    productos: structuredClone(seedProductos),
    insumos: structuredClone(seedInsumos),
    insumosInternos: structuredClone(seedInsumosInternos),
    etiquetas: structuredClone(seedEtiquetas),
    materiaPrima: structuredClone(seedMateriaPrima),
    movimientos: [],
  };
}

function loadState(): DBState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as DBState;
  } catch {
    /* ignore */
  }
  return seedState();
}

export interface VentaResultado {
  ok: boolean;
  mensaje: string;
  producto?: Producto;
  componentes: ComponenteMovido[];
  alertas: string[];
}

interface StoreCtx {
  state: DBState;
  vender: (codigoProducto: string, cantidad: number, nota?: string) => VentaResultado;
  producir: (codigoProducto: string, cantidad: number, nota?: string) => VentaResultado;
  ingreso: (categoria: Categoria, codigo: string, cantidad: number) => void;
  ajustar: (categoria: Categoria, codigo: string, nuevoActual: number) => void;
  upsertProducto: (p: Producto, codigoOriginal?: string) => void;
  upsertItem: (categoria: Categoria, item: any, codigoOriginal?: string) => void;
  eliminarItem: (categoria: Categoria, codigo: string) => void;
  resetDatos: () => void;
}

const Ctx = createContext<StoreCtx | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<DBState>(loadState);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }, [state]);

  const api = useMemo<StoreCtx>(() => {
    /** Aplica el descuento de la receta y registra el movimiento */
    function aplicarReceta(
      prev: DBState,
      producto: Producto,
      cantidad: number,
      tipoMov: 'venta' | 'produccion'
    ): { next: DBState; res: VentaResultado } {
      const next: DBState = structuredClone(prev);
      const componentes: ComponenteMovido[] = [];
      const alertas: string[] = [];

      // El producto: venta descuenta, producción suma
      const prod = next.productos.find((p) => p.codigo === producto.codigo)!;
      if (tipoMov === 'venta') prod.actual -= cantidad;
      else prod.actual += cantidad;

      // Componentes de la receta siempre se consumen (se descuentan)
      for (const linea of producto.bom) {
        const lista = listaDe(next, linea.categoria);
        const comp = lista.find((x) => x.codigo === linea.codigo);
        const consumido = linea.cantidad * cantidad;
        if (!comp) {
          componentes.push({
            categoria: linea.categoria,
            codigo: linea.codigo,
            nombre: '(no encontrado)',
            cantidad: consumido,
            resultante: 0,
            faltante: true,
          });
          alertas.push(`Componente ${linea.codigo} no existe en stock.`);
          continue;
        }
        comp.actual -= consumido;
        const faltante = comp.actual < 0;
        componentes.push({
          categoria: linea.categoria,
          codigo: comp.codigo,
          nombre: comp.nombre,
          cantidad: consumido,
          resultante: comp.actual,
          faltante,
        });
        if (faltante) {
          alertas.push(
            `${comp.nombre} (${comp.codigo}) quedó en negativo: faltan ${Math.abs(
              comp.actual
            )}.`
          );
        } else if (comp.actual < comp.minimo) {
          alertas.push(
            `${comp.nombre} (${comp.codigo}) por debajo del mínimo (${comp.actual}/${comp.minimo}).`
          );
        }
      }

      const mov: Movimiento = {
        id: uid(),
        fecha: new Date().toISOString(),
        tipo: tipoMov,
        categoria: 'producto',
        codigo: producto.codigo,
        nombre: producto.nombre,
        cantidad,
        componentes,
      };
      next.movimientos = [mov, ...next.movimientos];

      return {
        next,
        res: {
          ok: true,
          mensaje:
            tipoMov === 'venta'
              ? `Venta registrada: ${cantidad} × ${producto.nombre}`
              : `Producción registrada: ${cantidad} × ${producto.nombre}`,
          producto: prod,
          componentes,
          alertas,
        },
      };
    }

    return {
      state,
      vender(codigoProducto, cantidad, _nota) {
        let result: VentaResultado = {
          ok: false,
          mensaje: 'Producto no encontrado',
          componentes: [],
          alertas: [],
        };
        setState((prev) => {
          const producto = prev.productos.find((p) => p.codigo === codigoProducto);
          if (!producto) return prev;
          const { next, res } = aplicarReceta(prev, producto, cantidad, 'venta');
          result = res;
          return next;
        });
        return result;
      },
      producir(codigoProducto, cantidad, _nota) {
        let result: VentaResultado = {
          ok: false,
          mensaje: 'Producto no encontrado',
          componentes: [],
          alertas: [],
        };
        setState((prev) => {
          const producto = prev.productos.find((p) => p.codigo === codigoProducto);
          if (!producto) return prev;
          const { next, res } = aplicarReceta(prev, producto, cantidad, 'produccion');
          result = res;
          return next;
        });
        return result;
      },
      ingreso(categoria, codigo, cantidad) {
        setState((prev) => {
          const next = structuredClone(prev);
          const item = buscarItem(next, categoria, codigo);
          if (!item) return prev;
          item.actual += cantidad;
          next.movimientos = [
            {
              id: uid(),
              fecha: new Date().toISOString(),
              tipo: 'ingreso',
              categoria,
              codigo,
              nombre: item.nombre,
              cantidad,
            },
            ...next.movimientos,
          ];
          return next;
        });
      },
      ajustar(categoria, codigo, nuevoActual) {
        setState((prev) => {
          const next = structuredClone(prev);
          const item = buscarItem(next, categoria, codigo);
          if (!item) return prev;
          const delta = nuevoActual - item.actual;
          item.actual = nuevoActual;
          next.movimientos = [
            {
              id: uid(),
              fecha: new Date().toISOString(),
              tipo: 'ajuste',
              categoria,
              codigo,
              nombre: item.nombre,
              cantidad: delta,
              nota: `Ajuste manual a ${nuevoActual}`,
            },
            ...next.movimientos,
          ];
          return next;
        });
      },
      upsertProducto(p, codigoOriginal) {
        setState((prev) => {
          const next = structuredClone(prev);
          const key = codigoOriginal ?? p.codigo;
          const idx = next.productos.findIndex((x) => x.codigo === key);
          if (idx >= 0) next.productos[idx] = p;
          else next.productos.unshift(p);
          return next;
        });
      },
      upsertItem(categoria, item, codigoOriginal) {
        setState((prev) => {
          const next = structuredClone(prev);
          const lista = listaDe(next, categoria) as any[];
          const key = codigoOriginal ?? item.codigo;
          const idx = lista.findIndex((x) => x.codigo === key);
          if (idx >= 0) lista[idx] = item;
          else lista.unshift(item);
          return next;
        });
      },
      eliminarItem(categoria, codigo) {
        setState((prev) => {
          const next = structuredClone(prev);
          const lista = listaDe(next, categoria) as any[];
          const idx = lista.findIndex((x) => x.codigo === codigo);
          if (idx >= 0) lista.splice(idx, 1);
          return next;
        });
      },
      resetDatos() {
        setState(seedState());
      },
    };
  }, [state]);

  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

export function useStore(): StoreCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useStore debe usarse dentro de StoreProvider');
  return ctx;
}

export type { Producto, Insumo, Etiqueta, MateriaPrima };
