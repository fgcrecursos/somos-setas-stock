import type {
  BaseItem,
  Categoria,
  CategoriaComponente,
  DBState,
  Movimiento,
  TipoMovimiento,
} from './types';

export type Estado = 'agotado' | 'critico' | 'bajo' | 'ok' | 'sin_minimo';

export interface EstadoInfo {
  estado: Estado;
  label: string;
  /** diferencia = actual - minimo (positivo = sobran, negativo = faltan) */
  diferencia: number;
  faltan: number;
  sobran: number;
}

export function calcEstado(actual: number, minimo: number): EstadoInfo {
  const diferencia = actual - minimo;
  const faltan = Math.max(minimo - actual, 0);
  const sobran = Math.max(actual - minimo, 0);
  let estado: Estado;
  let label: string;
  if (minimo <= 0) {
    estado = actual <= 0 ? 'agotado' : 'sin_minimo';
    label = actual <= 0 ? 'Agotado' : 'Sin mínimo';
  } else if (actual <= 0) {
    estado = 'agotado';
    label = 'Agotado';
  } else if (actual < minimo * 0.5) {
    estado = 'critico';
    label = 'Crítico';
  } else if (actual < minimo) {
    estado = 'bajo';
    label = 'Bajo';
  } else {
    estado = 'ok';
    label = 'OK';
  }
  return { estado, label, diferencia, faltan, sobran };
}

export const CATEGORIA_LABEL: Record<Categoria, string> = {
  producto: 'Producto',
  insumo: 'Insumo',
  insumo_interno: 'Insumo interno',
  etiqueta: 'Etiqueta',
  materia_prima: 'Materia prima',
};

export const CATEGORIA_LABEL_PLURAL: Record<Categoria, string> = {
  producto: 'Productos',
  insumo: 'Insumos de productos',
  insumo_interno: 'Insumos internos',
  etiqueta: 'Etiquetas',
  materia_prima: 'Materia prima',
};

/** Devuelve el array del state que corresponde a una categoría */
export function listaDe(state: DBState, categoria: Categoria): BaseItem[] {
  switch (categoria) {
    case 'producto':
      return state.productos;
    case 'insumo':
      return state.insumos;
    case 'insumo_interno':
      return state.insumosInternos;
    case 'etiqueta':
      return state.etiquetas;
    case 'materia_prima':
      return state.materiaPrima;
  }
}

export function buscarItem(
  state: DBState,
  categoria: Categoria,
  codigo: string
): BaseItem | undefined {
  return listaDe(state, categoria).find((x) => x.codigo === codigo);
}

/** Busca un producto por su código en cualquier categoría (para escaneo) */
export function buscarPorCodigo(
  state: DBState,
  codigo: string
): { categoria: Categoria; item: BaseItem } | undefined {
  const cats: Categoria[] = [
    'producto',
    'insumo',
    'insumo_interno',
    'etiqueta',
    'materia_prima',
  ];
  const clean = codigo.trim().toUpperCase();
  for (const c of cats) {
    const item = listaDe(state, c).find(
      (x) => x.codigo.trim().toUpperCase() === clean
    );
    if (item) return { categoria: c, item };
  }
  return undefined;
}

export const MOVIMIENTO_LABEL: Record<TipoMovimiento, string> = {
  venta: 'Venta',
  produccion: 'Producción',
  ingreso: 'Ingreso',
  ajuste: 'Ajuste',
  consumo_interno: 'Consumo interno',
  alta: 'Alta',
  edicion: 'Edición',
  baja: 'Baja',
};

/** Colores del cartelito de cada tipo de movimiento */
export const MOVIMIENTO_COLOR: Record<TipoMovimiento, { bg: string; c: string }> = {
  venta: { bg: 'var(--naranja-100)', c: 'var(--naranja-600)' },
  produccion: { bg: 'var(--ok-bg)', c: 'var(--ok)' },
  ingreso: { bg: '#e2eef5', c: '#3f6a7a' },
  ajuste: { bg: 'var(--crema-3)', c: 'var(--verde-700)' },
  consumo_interno: { bg: '#efe6f5', c: '#6a4f7a' },
  alta: { bg: '#e6f2ea', c: '#2f6b47' },
  edicion: { bg: 'var(--crema-3)', c: '#7a6a3f' },
  baja: { bg: 'var(--critico-bg)', c: 'var(--critico)' },
};

/**
 * Cuánto movió el stock, con signo. Las ventas y el consumo interno se guardan
 * como "unidades que salieron" (3 = salieron 3), así que en el historial se
 * leen como −3. Cuando un pedido se anula o se corrige hacia abajo, la venta se
 * guarda en negativo (−3 = volvieron 3): ahí el stock sube. Los ingresos,
 * producciones, ajustes y ediciones ya vienen firmados desde la base.
 */
export function deltaMovimiento(m: Pick<Movimiento, 'tipo' | 'cantidad'>): number {
  if (m.tipo === 'venta' || m.tipo === 'consumo_interno') return -m.cantidad;
  return m.cantidad;
}

export const COMPONENTE_LABEL: Record<CategoriaComponente, string> = {
  insumo: 'Insumo',
  insumo_interno: 'Insumo interno',
  etiqueta: 'Etiqueta',
  materia_prima: 'Materia prima',
};

export function formatNum(n: number): string {
  if (Number.isInteger(n)) return n.toLocaleString('es-AR');
  return n.toLocaleString('es-AR', { maximumFractionDigits: 2 });
}

export function formatFecha(iso?: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return String(iso);
  return d.toLocaleString('es-AR', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function uid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

/** Cómo se llama cada campo de la ficha cuando se cuenta qué cambió */
const ETIQUETA_CAMPO: Record<string, string> = {
  codigo: 'código',
  nombre: 'nombre',
  actual: 'stock',
  minimo: 'mínimo',
  tipo: 'tipo',
  presentacion: 'presentación',
  lote: 'lote',
  vencimiento: 'vencimiento',
  ubicacion: 'ubicación',
  observaciones: 'observaciones',
  proveedor: 'proveedor',
  cantidadPorPack: 'unidades por pack',
  packDeCompra: 'pack de compra',
  unidadCompra: 'unidad de compra',
  stockUnidad: 'stock por unidad',
  fecha: 'fecha',
};

function valorLegible(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'number') return formatNum(v);
  return String(v);
}

/**
 * Qué cambió entre dos versiones de una ficha, en castellano.
 * Es lo que después queda escrito en el movimiento de tipo "edición", para que
 * el historial diga qué se tocó y no sólo que alguien tocó algo.
 */
export function describirCambios(antes: any, despues: any): string[] {
  const campos = new Set([...Object.keys(antes ?? {}), ...Object.keys(despues ?? {})]);
  const cambios: string[] = [];
  for (const campo of campos) {
    if (campo === 'bom') {
      const a = JSON.stringify(antes?.bom ?? []);
      const b = JSON.stringify(despues?.bom ?? []);
      if (a !== b) {
        const na = (antes?.bom ?? []).length;
        const nb = (despues?.bom ?? []).length;
        cambios.push(na === nb ? 'receta modificada' : `receta: ${na} → ${nb} componentes`);
      }
      continue;
    }
    const a = antes?.[campo] ?? null;
    const b = despues?.[campo] ?? null;
    if (String(a ?? '') === String(b ?? '')) continue;
    cambios.push(`${ETIQUETA_CAMPO[campo] ?? campo}: ${valorLegible(a)} → ${valorLegible(b)}`);
  }
  return cambios;
}
