// Modelo de datos de la plataforma de stock de Somos Setas

export type Categoria =
  | 'producto'
  | 'insumo'
  | 'insumo_interno'
  | 'etiqueta'
  | 'materia_prima';

// Categorías que pueden ser componentes de una receta (todo menos producto final)
export type CategoriaComponente = Exclude<Categoria, 'producto'>;

/** Una línea de receta: qué consume un producto de otra categoría al fabricarse/venderse */
export interface BomItem {
  categoria: CategoriaComponente;
  codigo: string;
  cantidad: number;
}

export interface BaseItem {
  codigo: string;
  nombre: string;
  actual: number;
  minimo: number;
}

export interface Producto extends BaseItem {
  tipo: string;
  presentacion: string;
  fecha?: string | null;
  lote?: string | null;
  vencimiento?: string | null;
  ubicacion?: string | null;
  observaciones?: string | null;
  /** Receta: componentes que se descuentan al vender/producir */
  bom: BomItem[];
}

export interface Insumo extends BaseItem {
  cantidadPorPack?: number | null;
  packDeCompra?: number | null;
  unidadCompra?: string | null;
  lote?: string | null;
  vencimiento?: string | null;
  ubicacion?: string | null;
}

export interface Etiqueta extends BaseItem {
  tipo: string;
  presentacion: string;
  fecha?: string | null;
}

export interface MateriaPrima extends BaseItem {
  tipo: string;
  presentacion: string;
  stockUnidad?: number | null;
  cantidadPorPack?: number | null;
  ubicacion?: string | null;
  proveedor?: string | null;
}

export type TipoMovimiento = 'venta' | 'produccion' | 'ingreso' | 'ajuste';

export interface ComponenteMovido {
  categoria: Categoria;
  codigo: string;
  nombre: string;
  cantidad: number;
  resultante: number;
  faltante: boolean;
}

export interface Movimiento {
  id: string;
  fecha: string; // ISO
  tipo: TipoMovimiento;
  categoria: Categoria;
  codigo: string;
  nombre: string;
  cantidad: number;
  nota?: string;
  componentes?: ComponenteMovido[];
}

export interface DBState {
  productos: Producto[];
  insumos: Insumo[];
  insumosInternos: Insumo[];
  etiquetas: Etiqueta[];
  materiaPrima: MateriaPrima[];
  movimientos: Movimiento[];
}
