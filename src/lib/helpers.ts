import type {
  BaseItem,
  Categoria,
  CategoriaComponente,
  DBState,
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
