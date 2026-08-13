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
  lote?: string | null;
  /** Fecha de vencimiento (aaaa-mm-dd): dispara las alertas de vencimiento */
  vencimiento?: string | null;
}

export type TipoMovimiento =
  | 'venta'            // salió vendido
  | 'produccion'       // se fabricó: suma producto y descuenta la receta
  | 'ingreso'          // entró stock (compra, reposición)
  | 'ajuste'           // conteo físico o corrección
  | 'consumo_interno'  // lo usó el equipo, no se vendió
  | 'alta'             // se creó el ítem
  | 'edicion'          // se modificó la ficha del ítem
  | 'baja';            // se eliminó el ítem del sistema

/** De dónde salió el movimiento: cargado a mano acá, o un pedido de la tienda */
export type OrigenMovimiento = 'plataforma' | 'tienda';

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
  /** Email de quien lo registró (lo completa la base) */
  usuario?: string;
  origen?: OrigenMovimiento;
  /** Id del pedido de la tienda que lo generó, si vino de ahí */
  referencia?: string;
}

/** Vínculo entre una presentación de la tienda y un ítem del inventario */
export interface SkuMap {
  producto_id: string;
  pres_id: string;
  categoria: Categoria;
  codigo: string;
  /** Unidades de inventario que consume una unidad vendida (packs) */
  unidades: number;
  activo: boolean;
  /** La presentación de la web y la del inventario no coinciden: revisar */
  revisar: boolean;
  etiqueta?: string | null;
}

/** Una línea que no se pudo descontar de un pedido */
export interface LineaSinMapear {
  producto_id?: string;
  pres_id?: string;
  descripcion: string;
  cantidad: number;
  motivo: string;
}

/** Un pedido de la tienda y qué pasó con el stock */
export interface PedidoTienda {
  order_id: string;
  fecha: string;
  cliente: string;
  total: number;
  estado: string;
  interno: boolean;
  /** ¿Está descontado del stock ahora mismo? */
  aplicado: boolean;
  /** Se descontó a mano en su momento: no tocarlo */
  ignorar: boolean;
  lineas: { categoria: Categoria; codigo: string; cantidad: number }[];
  sinMapear: LineaSinMapear[];
  aplicadoAt?: string | null;
  nota?: string | null;
  /** Ítems del pedido tal como los guardó la tienda */
  items: { productId?: string; presId?: string; productName?: string; qty: number }[];
}

/** admin edita todo · invitado solo mira */
export type Rol = 'admin' | 'invitado';

export interface UsuarioStock {
  email: string;
  nombre: string | null;
  rol: Rol;
  activo: boolean;
  notas?: string | null;
  created_at?: string;
}

export interface DBState {
  productos: Producto[];
  insumos: Insumo[];
  insumosInternos: Insumo[];
  etiquetas: Etiqueta[];
  materiaPrima: MateriaPrima[];
  movimientos: Movimiento[];
}
