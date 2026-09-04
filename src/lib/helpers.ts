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

export const CATEGORIAS_TODAS: Categoria[] = [
  'producto',
  'insumo',
  'insumo_interno',
  'etiqueta',
  'materia_prima',
];

/** Busca un producto por su código en cualquier categoría (para escaneo) */
export function buscarPorCodigo(
  state: DBState,
  codigo: string
): { categoria: Categoria; item: BaseItem } | undefined {
  const cats = CATEGORIAS_TODAS;
  const clean = codigo.trim().toUpperCase();
  for (const c of cats) {
    const item = listaDe(state, c).find(
      (x) => x.codigo.trim().toUpperCase() === clean
    );
    if (item) return { categoria: c, item };
  }
  return undefined;
}

/**
 * Texto listo para comparar en un buscador: en minúscula y sin tildes ni
 * diéresis, así "capsula" encuentra "Cápsula" y al revés. Al buscar se escribe
 * rápido y sin acentos, pero los nombres del catálogo sí los llevan.
 * La descomposición NFD también separa la virgulilla de la ñ, de modo que
 * "nino" encuentra "Niño": es el mismo criterio, buscar sin diacríticos.
 */
export function normalizarBusqueda(v: unknown): string {
  return (v == null ? '' : String(v))
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

/**
 * ¿Lo escrito en el buscador coincide? La consulta se parte en palabras y
 * todas tienen que aparecer, en cualquier orden y repartidas entre los campos:
 * así "capsulas melena" encuentra la Melena de León de tipo Cápsulas.
 */
export function coincideBusqueda(q: string, ...campos: unknown[]): boolean {
  const partes = normalizarBusqueda(q).split(/\s+/).filter(Boolean);
  if (!partes.length) return true;
  const texto = campos.map(normalizarBusqueda).filter(Boolean).join(' ');
  return partes.every((p) => texto.includes(p));
}

/**
 * Todo lo que identifica a un ítem del inventario. Va junto al buscador para
 * que se pueda llegar por cualquier dato de la ficha —el tipo, la presentación,
 * el lote, el proveedor, dónde está guardado— y no solo por código y nombre.
 * Cada categoría tiene sus campos: los que no existen quedan en undefined.
 */
export function camposBuscables(it: BaseItem): unknown[] {
  const d = it as unknown as Record<string, unknown>;
  return [
    it.codigo,
    it.nombre,
    d.tipo,
    d.presentacion,
    d.lote,
    d.proveedor,
    d.ubicacion,
    d.unidadCompra,
    d.observaciones,
  ];
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

/** Fecha escrita en palabras, con día de la semana: para el detalle de un movimiento */
export function formatFechaLarga(iso?: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return String(iso);
  return d.toLocaleString('es-AR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * "Hace 3 días", "hace 2 horas": ubica un movimiento en el tiempo sin tener
 * que hacer la cuenta mentalmente contra la fecha del calendario.
 */
export function tiempoRelativo(iso?: string | null): string {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  if (isNaN(t)) return '';
  const seg = Math.round((Date.now() - t) / 1000);
  if (seg < 0) return 'en el futuro';
  if (seg < 60) return 'recién';
  const min = Math.round(seg / 60);
  if (min < 60) return min === 1 ? 'hace un minuto' : `hace ${min} minutos`;
  const hs = Math.round(min / 60);
  if (hs < 24) return hs === 1 ? 'hace una hora' : `hace ${hs} horas`;
  const dias = Math.round(hs / 24);
  if (dias < 31) return dias === 1 ? 'ayer' : `hace ${dias} días`;
  const meses = Math.round(dias / 30);
  if (meses < 12) return meses === 1 ? 'hace un mes' : `hace ${meses} meses`;
  const anios = Math.round(meses / 12);
  return anios === 1 ? 'hace un año' : `hace ${anios} años`;
}

/** Sólo el día, sin la hora: para fechas de vencimiento (aaaa-mm-dd) */
export function formatFechaCorta(iso?: string | null): string {
  if (!iso) return '—';
  const d = soloFecha(String(iso));
  if (!d) return String(iso);
  return d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export function uid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

// =====================================================================
// VENCIMIENTOS
// La materia prima (y los productos) llevan fecha de vencimiento. Acá esa
// fecha se traduce a "cuántos días faltan" y a un nivel de alerta, para
// poder avisar antes de que se venza algo que todavía tiene stock.
// =====================================================================

export type EstadoVencimiento = 'vencido' | 'critico' | 'proximo' | 'ok';

export interface VencimientoInfo {
  estado: EstadoVencimiento;
  label: string;
  /** Días que faltan para la fecha (negativo = ya venció) */
  dias: number;
}

/** Cuántos días antes se empieza a avisar (se puede cambiar en el Dashboard) */
export const DIAS_AVISO_DEFAULT = 30;
/** Dentro de esta franja el aviso deja de ser "próximo" y pasa a "crítico" */
export const DIAS_CRITICO = 7;
export const OPCIONES_AVISO = [15, 30, 60, 90];

const CLAVE_AVISO = 'somos-setas-stock:aviso-vencimiento';

export function diasAvisoGuardado(): number {
  try {
    const n = Number(localStorage.getItem(CLAVE_AVISO));
    return Number.isFinite(n) && n > 0 ? n : DIAS_AVISO_DEFAULT;
  } catch {
    return DIAS_AVISO_DEFAULT;
  }
}

export function guardarDiasAviso(dias: number): void {
  try {
    localStorage.setItem(CLAVE_AVISO, String(dias));
  } catch {
    /* modo incógnito o storage bloqueado: se sigue con el valor por defecto */
  }
}

const DIA_MS = 86_400_000;

/**
 * Convierte `aaaa-mm-dd` (o un ISO completo) a medianoche LOCAL.
 * `new Date('2026-09-01')` se interpreta como UTC y en Argentina cae el 31 de
 * agosto a las 21 h: por eso la fecha se arma a mano, componente por componente.
 */
function soloFecha(v: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v.trim());
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function calcVencimiento(
  vencimiento?: string | null,
  diasAviso = DIAS_AVISO_DEFAULT
): VencimientoInfo | null {
  if (!vencimiento) return null;
  const fecha = soloFecha(String(vencimiento));
  if (!fecha) return null;
  const ahora = new Date();
  const hoy = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate());
  const dias = Math.round((fecha.getTime() - hoy.getTime()) / DIA_MS);

  if (dias < 0)
    return {
      estado: 'vencido',
      dias,
      label: dias === -1 ? 'Vencido ayer' : `Vencido hace ${-dias} días`,
    };
  if (dias === 0) return { estado: 'critico', dias, label: 'Vence hoy' };
  const label = dias === 1 ? 'Vence mañana' : `Vence en ${dias} días`;
  if (dias <= Math.min(DIAS_CRITICO, diasAviso)) return { estado: 'critico', dias, label };
  if (dias <= diasAviso) return { estado: 'proximo', dias, label };
  return { estado: 'ok', dias, label };
}

/** El cartelito de vencimiento reusa la paleta de estados de stock */
export const VENCIMIENTO_CLASE: Record<EstadoVencimiento, string> = {
  vencido: 'st-agotado',
  critico: 'st-critico',
  proximo: 'st-bajo',
  ok: 'st-ok',
};

export interface AlertaVencimiento {
  categoria: Categoria;
  codigo: string;
  nombre: string;
  lote: string | null;
  proveedor: string | null;
  actual: number;
  vencimiento: string;
  info: VencimientoInfo;
}

/**
 * Todo lo que está vencido o por vencer dentro de `diasAviso`, de lo más
 * urgente a lo menos. Se ignora lo que ya no tiene stock: si no queda nada en
 * el depósito, la fecha no le importa a nadie.
 */
export function alertasVencimiento(
  state: DBState,
  diasAviso = DIAS_AVISO_DEFAULT
): AlertaVencimiento[] {
  const out: AlertaVencimiento[] = [];
  for (const categoria of CATEGORIAS_TODAS) {
    for (const it of listaDe(state, categoria) as any[]) {
      const info = calcVencimiento(it.vencimiento, diasAviso);
      if (!info || info.estado === 'ok') continue;
      if ((Number(it.actual) || 0) <= 0) continue;
      out.push({
        categoria,
        codigo: it.codigo,
        nombre: it.nombre,
        lote: it.lote ?? null,
        proveedor: it.proveedor ?? null,
        actual: Number(it.actual) || 0,
        vencimiento: String(it.vencimiento),
        info,
      });
    }
  }
  return out.sort((a, b) => a.info.dias - b.info.dias);
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
