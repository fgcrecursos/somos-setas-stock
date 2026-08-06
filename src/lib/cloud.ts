// =====================================================================
// Capa de datos: traduce entre el estado que usa la app (DBState) y las
// tablas st_items / st_movimientos de Supabase.
//
// Cada ítem se guarda con sus campos "vivos" en columnas (nombre, actual,
// mínimo) y el resto de la ficha —tipo, presentación, receta, lote…— en la
// columna `data`. Así la base puede sumar y restar stock sin tener que
// entender la forma de cada categoría.
// =====================================================================
import { sb } from './supabase';
import type {
  Categoria,
  DBState,
  Etiqueta,
  Insumo,
  MateriaPrima,
  Movimiento,
  Producto,
} from './types';

const PAGINA = 1000; // límite por consulta de Supabase

export const CATEGORIAS: Categoria[] = [
  'producto',
  'insumo',
  'insumo_interno',
  'etiqueta',
  'materia_prima',
];

interface ItemRow {
  categoria: Categoria;
  codigo: string;
  nombre: string;
  actual: number | string;
  minimo: number | string;
  data: Record<string, unknown>;
}

export function estadoVacio(): DBState {
  return {
    productos: [],
    insumos: [],
    insumosInternos: [],
    etiquetas: [],
    materiaPrima: [],
    movimientos: [],
  };
}

/** Dónde vive cada categoría dentro del estado */
function bucket(state: DBState, categoria: Categoria): any[] {
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

function toRow(categoria: Categoria, item: any): ItemRow {
  const { codigo, nombre, actual, minimo, ...resto } = item;
  return {
    categoria,
    codigo: String(codigo),
    nombre: nombre ?? '',
    actual: Number(actual) || 0,
    minimo: Number(minimo) || 0,
    data: resto,
  };
}

function fromRow(row: ItemRow): any {
  return {
    ...(row.data ?? {}),
    codigo: row.codigo,
    nombre: row.nombre ?? '',
    actual: Number(row.actual) || 0,
    minimo: Number(row.minimo) || 0,
  };
}

function movFromRow(row: any): Movimiento {
  return {
    id: row.id,
    fecha: row.fecha,
    tipo: row.tipo,
    categoria: row.categoria,
    codigo: row.codigo,
    nombre: row.nombre ?? '',
    cantidad: Number(row.cantidad) || 0,
    nota: row.nota ?? undefined,
    componentes: row.componentes ?? [],
    usuario: row.usuario ?? undefined,
  };
}

/** Trae de la nube todo el inventario y el historial. */
export async function traerTodo(): Promise<DBState> {
  const state = estadoVacio();

  // Inventario (paginado: son cientos de filas y podrían pasar el tope de 1000)
  for (let desde = 0; ; desde += PAGINA) {
    const { data, error } = await sb
      .from('st_items')
      .select('*')
      .order('categoria')
      .order('codigo')
      .range(desde, desde + PAGINA - 1);
    if (error) throw new Error(error.message);
    const filas = (data ?? []) as ItemRow[];
    for (const fila of filas) bucket(state, fila.categoria).push(fromRow(fila));
    if (filas.length < PAGINA) break;
  }

  // Historial, del más nuevo al más viejo
  for (let desde = 0; ; desde += PAGINA) {
    const { data, error } = await sb
      .from('st_movimientos')
      .select('*')
      .order('fecha', { ascending: false })
      .range(desde, desde + PAGINA - 1);
    if (error) throw new Error(error.message);
    const filas = data ?? [];
    for (const fila of filas) state.movimientos.push(movFromRow(fila));
    if (filas.length < PAGINA) break;
  }

  return state;
}

/** ¿Hay algo cargado en la nube? (para saber si hace falta la carga inicial) */
export async function contarItems(): Promise<number> {
  const { count, error } = await sb
    .from('st_items')
    .select('codigo', { count: 'exact', head: true });
  if (error) throw new Error(error.message);
  return count ?? 0;
}

/** Sube el estado completo: la carga inicial de la base. */
export async function subirTodo(state: DBState): Promise<void> {
  const filas: ItemRow[] = [];
  for (const categoria of CATEGORIAS) {
    for (const item of bucket(state, categoria)) filas.push(toRow(categoria, item));
  }

  for (let i = 0; i < filas.length; i += 200) {
    const { error } = await sb
      .from('st_items')
      .upsert(filas.slice(i, i + 200), { onConflict: 'categoria,codigo' });
    if (error) throw new Error(error.message);
  }

  const movs = state.movimientos.map((m) => ({
    id: m.id,
    fecha: m.fecha,
    tipo: m.tipo,
    categoria: m.categoria,
    codigo: m.codigo,
    nombre: m.nombre,
    cantidad: m.cantidad,
    nota: m.nota ?? null,
    componentes: m.componentes ?? [],
  }));
  for (let i = 0; i < movs.length; i += 200) {
    const { error } = await sb
      .from('st_movimientos')
      .upsert(movs.slice(i, i + 200), { onConflict: 'id' });
    if (error) throw new Error(error.message);
  }
}

export async function guardarItem(
  categoria: Categoria,
  item: any,
  codigoOriginal?: string
): Promise<void> {
  // Si le cambiaron el código, la fila vieja ya no corresponde a nadie.
  if (codigoOriginal && codigoOriginal !== item.codigo) {
    await borrarItem(categoria, codigoOriginal);
  }
  const { error } = await sb
    .from('st_items')
    .upsert(toRow(categoria, item), { onConflict: 'categoria,codigo' });
  if (error) throw new Error(error.message);
}

export async function borrarItem(categoria: Categoria, codigo: string): Promise<void> {
  const { error } = await sb
    .from('st_items')
    .delete()
    .eq('categoria', categoria)
    .eq('codigo', codigo);
  if (error) throw new Error(error.message);
}

export interface Delta {
  categoria: Categoria;
  codigo: string;
  /** Cuánto sumar (negativo para descontar) */
  delta?: number;
  /** O el valor exacto al que hay que dejarlo (conteo físico) */
  set?: number;
}

export interface Resultante {
  categoria: Categoria;
  codigo: string;
  anterior: number;
  actual: number;
}

/**
 * Aplica los descuentos en la base y registra el movimiento, todo junto.
 * La base hace `actual = actual + delta` sobre la fila bloqueada, así que si
 * dos personas venden al mismo tiempo cada descuento se aplica sobre el stock
 * real del momento y no sobre la copia que tenía cargada cada navegador.
 */
export async function aplicarMovimiento(
  deltas: Delta[],
  mov: Movimiento | null
): Promise<{ resultantes: Resultante[]; movimiento: Movimiento | null }> {
  const { data, error } = await sb.rpc('st_aplicar', {
    p_deltas: deltas,
    p_mov: mov
      ? {
          id: mov.id,
          fecha: mov.fecha,
          tipo: mov.tipo,
          categoria: mov.categoria,
          codigo: mov.codigo,
          nombre: mov.nombre,
          cantidad: mov.cantidad,
          nota: mov.nota ?? null,
          componentes: mov.componentes ?? [],
        }
      : null,
  });
  if (error) throw new Error(error.message);
  const res = (data ?? {}) as any;
  return {
    resultantes: ((res.resultantes ?? []) as any[]).map((r) => ({
      categoria: r.categoria,
      codigo: r.codigo,
      anterior: Number(r.anterior) || 0,
      actual: Number(r.actual) || 0,
    })),
    // El movimiento se arma con lo que devolvió la base: los componentes traen
    // el stock real que quedó y, en un ajuste, la cantidad es la diferencia
    // efectiva contra lo que había en la base.
    movimiento: mov
      ? {
          ...mov,
          cantidad: res.cantidad != null ? Number(res.cantidad) : mov.cantidad,
          componentes: res.componentes ?? mov.componentes ?? [],
          usuario: res.usuario ?? mov.usuario,
        }
      : null,
  };
}

/** Borra TODO el inventario (no el historial). Solo para restablecer. */
export async function vaciarItems(): Promise<void> {
  const { error } = await sb.from('st_items').delete().in('categoria', CATEGORIAS);
  if (error) throw new Error(error.message);
}

export type { Producto, Insumo, Etiqueta, MateriaPrima };
