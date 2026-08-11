// =====================================================================
// Backup a Excel: baja TODO lo que hay en la plataforma en un solo archivo
// .xlsx, con una hoja por categoría más el historial y el resumen de ventas.
// Sirve como respaldo y para trabajar los números fuera de la app.
// =====================================================================
import type { DBState, Movimiento, Producto } from './types';
import { CATEGORIA_LABEL, MOVIMIENTO_LABEL, calcEstado, deltaMovimiento } from './helpers';

// SheetJS pesa ~400 kB: se carga recién cuando alguien pide una descarga, para
// no hacer más lento el arranque de la app (que se usa mucho desde el celular).
type Xlsx = typeof import('xlsx');
const cargarXlsx = () => import('xlsx');

function hoja(X: Xlsx, libro: any, nombre: string, filas: any[], anchos: number[]) {
  const ws = X.utils.json_to_sheet(filas);
  ws['!cols'] = anchos.map((w) => ({ wch: w }));
  // Los nombres de hoja de Excel no pueden pasar los 31 caracteres.
  X.utils.book_append_sheet(libro, ws, nombre.slice(0, 31));
}

function fechaLegible(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return isNaN(d.getTime())
    ? String(iso)
    : d.toLocaleString('es-AR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
}

function filaBase(it: any) {
  const e = calcEstado(it.actual, it.minimo);
  return {
    Código: it.codigo,
    Nombre: it.nombre,
    Actual: it.actual,
    Mínimo: it.minimo,
    Diferencia: it.actual - it.minimo,
    Estado: e.label,
  };
}

/** Unidades vendidas por producto en todo el historial */
export function ventasPorProducto(movimientos: Movimiento[], productos: Producto[]) {
  const acc = new Map<string, { nombre: string; unidades: number; operaciones: number; ultima: string }>();
  for (const m of movimientos) {
    if (m.tipo !== 'venta') continue;
    const prev = acc.get(m.codigo) ?? { nombre: m.nombre, unidades: 0, operaciones: 0, ultima: m.fecha };
    prev.unidades += m.cantidad;
    prev.operaciones += 1;
    if (m.fecha > prev.ultima) prev.ultima = m.fecha;
    acc.set(m.codigo, prev);
  }
  return Array.from(acc.entries())
    .map(([codigo, v]) => {
      const p = productos.find((x) => x.codigo === codigo);
      return {
        codigo,
        nombre: v.nombre,
        tipo: p?.tipo ?? '',
        presentacion: p?.presentacion ?? '',
        unidades: v.unidades,
        operaciones: v.operaciones,
        ultima: v.ultima,
        stockActual: p?.actual ?? null,
      };
    })
    .sort((a, b) => b.unidades - a.unidades);
}

/** Una fila del ranking de actividad: qué pasó con un producto en el período */
export interface FilaActividad {
  codigo: string;
  nombre: string;
  tipo: string;
  presentacion: string;
  vendidas: number;
  producidas: number;
  consumo: number;
  ventasTienda: number;
  operaciones: number;
  ultima: string;
  stock: number | null;
}

/**
 * Informe puntual de la sección Actividad: el ranking del período y el detalle
 * de cada operación, sin el resto del inventario.
 */
export async function descargarInforme(
  ranking: FilaActividad[],
  movimientos: Movimiento[],
  titulo: string
) {
  const X = await cargarXlsx();
  const libro = X.utils.book_new();
  const suma = (campo: keyof FilaActividad) =>
    ranking.reduce((s, r) => s + (Number(r[campo]) || 0), 0);
  const totalVendidas = suma('vendidas');
  const totalProducidas = suma('producidas');
  const totalConsumo = suma('consumo');

  hoja(
    X,
    libro,
    'Resumen',
    [
      { Dato: 'Informe', Valor: titulo },
      { Dato: 'Generado', Valor: fechaLegible(new Date().toISOString()) },
      { Dato: 'Unidades vendidas', Valor: totalVendidas },
      { Dato: '· de las cuales por la tienda', Valor: suma('ventasTienda') },
      { Dato: 'Unidades producidas', Valor: totalProducidas },
      { Dato: 'Consumo interno', Valor: totalConsumo },
      { Dato: 'Balance (producido − salidas)', Valor: totalProducidas - totalVendidas - totalConsumo },
      { Dato: 'Productos distintos', Valor: ranking.length },
      { Dato: 'Operaciones', Valor: movimientos.length },
    ],
    [32, 44]
  );

  hoja(
    X,
    libro,
    'Por producto',
    ranking.map((r, i) => ({
      '#': i + 1,
      Código: r.codigo,
      Producto: r.nombre,
      Tipo: r.tipo,
      Presentación: r.presentacion,
      Vendidas: r.vendidas,
      'De la tienda': r.ventasTienda,
      Producidas: r.producidas,
      'Consumo interno': r.consumo,
      Balance: r.producidas - r.vendidas - r.consumo,
      'Participación en ventas %': totalVendidas
        ? Math.round((r.vendidas / totalVendidas) * 1000) / 10
        : 0,
      'Stock actual': r.stock ?? '',
      Última: fechaLegible(r.ultima),
    })),
    [5, 14, 40, 12, 20, 11, 13, 12, 16, 11, 24, 14, 18]
  );

  hoja(
    X,
    libro,
    'Detalle',
    movimientos.map((m) => ({
      Fecha: fechaLegible(m.fecha),
      Tipo: MOVIMIENTO_LABEL[m.tipo] ?? m.tipo,
      Origen: m.origen === 'tienda' ? 'Tienda' : 'Plataforma',
      Pedido: m.referencia ?? '',
      Código: m.codigo,
      Producto: m.nombre,
      Cantidad: m.cantidad,
      Registró: m.usuario ?? '',
      'Componentes descontados': m.componentes?.length ?? 0,
      Nota: m.nota ?? '',
    })),
    [18, 14, 12, 22, 14, 40, 11, 28, 22, 34]
  );

  // Se sacan los acentos antes de armar el nombre del archivo: si no,
  // "Producción" termina como "producci-n".
  const slug = titulo
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  const nombre = `somos-setas-${slug}.xlsx`;
  X.writeFile(libro, nombre);
  return nombre;
}

export async function descargarBackup(state: DBState, quien: string) {
  const X = await cargarXlsx();
  const libro = X.utils.book_new();
  const ahora = new Date();

  // --- Resumen ---
  const ventas = ventasPorProducto(state.movimientos, state.productos);
  const bajoMinimo = (lista: any[]) =>
    lista.filter((it) => calcEstado(it.actual, it.minimo).faltan > 0).length;
  hoja(
    X,
    libro,
    'Resumen',
    [
      { Dato: 'Backup generado', Valor: fechaLegible(ahora.toISOString()) },
      { Dato: 'Generado por', Valor: quien || '—' },
      { Dato: '', Valor: '' },
      { Dato: 'Productos', Valor: state.productos.length },
      { Dato: 'Insumos de productos', Valor: state.insumos.length },
      { Dato: 'Insumos internos', Valor: state.insumosInternos.length },
      { Dato: 'Etiquetas', Valor: state.etiquetas.length },
      { Dato: 'Materia prima', Valor: state.materiaPrima.length },
      { Dato: '', Valor: '' },
      { Dato: 'Ítems bajo el mínimo', Valor:
          bajoMinimo(state.productos) + bajoMinimo(state.insumos) + bajoMinimo(state.insumosInternos) +
          bajoMinimo(state.etiquetas) + bajoMinimo(state.materiaPrima) },
      { Dato: 'Movimientos registrados', Valor: state.movimientos.length },
      { Dato: 'Ventas registradas', Valor: state.movimientos.filter((m) => m.tipo === 'venta').length },
      { Dato: 'Unidades vendidas (histórico)', Valor: ventas.reduce((s, v) => s + v.unidades, 0) },
      {
        Dato: 'Unidades producidas (histórico)',
        Valor: state.movimientos
          .filter((m) => m.tipo === 'produccion')
          .reduce((s, m) => s + m.cantidad, 0),
      },
      {
        Dato: 'Consumo interno (histórico)',
        Valor: state.movimientos
          .filter((m) => m.tipo === 'consumo_interno')
          .reduce((s, m) => s + m.cantidad, 0),
      },
    ],
    [32, 40]
  );

  // --- Inventario ---
  hoja(
    X,
    libro,
    'Productos',
    state.productos.map((p) => ({
      ...filaBase(p),
      Tipo: p.tipo,
      Presentación: p.presentacion,
      Lote: p.lote ?? '',
      Vencimiento: p.vencimiento ?? '',
      Ubicación: p.ubicacion ?? '',
      'Componentes en receta': p.bom?.length ?? 0,
      Observaciones: p.observaciones ?? '',
    })),
    [14, 40, 10, 10, 11, 11, 14, 20, 12, 12, 16, 18, 30]
  );

  hoja(
    X,
    libro,
    'Insumos',
    state.insumos.map((i) => ({
      ...filaBase(i),
      'Cantidad por pack': i.cantidadPorPack ?? '',
      'Packs de compra': i.packDeCompra ?? '',
      'Unidad de compra': i.unidadCompra ?? '',
      Lote: i.lote ?? '',
      Vencimiento: i.vencimiento ?? '',
      Ubicación: i.ubicacion ?? '',
    })),
    [14, 40, 10, 10, 11, 11, 16, 15, 16, 12, 12, 16]
  );

  hoja(
    X,
    libro,
    'Insumos internos',
    state.insumosInternos.map((i) => ({
      ...filaBase(i),
      'Cantidad por pack': i.cantidadPorPack ?? '',
      'Packs de compra': i.packDeCompra ?? '',
      Ubicación: i.ubicacion ?? '',
    })),
    [14, 40, 10, 10, 11, 11, 16, 15, 16]
  );

  hoja(
    X,
    libro,
    'Etiquetas',
    state.etiquetas.map((e) => ({ ...filaBase(e), Tipo: e.tipo, Presentación: e.presentacion })),
    [14, 40, 10, 10, 11, 11, 14, 20]
  );

  hoja(
    X,
    libro,
    'Materia prima',
    state.materiaPrima.map((m) => ({
      ...filaBase(m),
      Tipo: m.tipo,
      Presentación: m.presentacion,
      'Stock por unidad': m.stockUnidad ?? '',
      'Cantidad por pack': m.cantidadPorPack ?? '',
      Proveedor: m.proveedor ?? '',
      Ubicación: m.ubicacion ?? '',
    })),
    [14, 40, 10, 10, 11, 11, 14, 20, 16, 16, 22, 16]
  );

  // --- Recetas: una fila por componente ---
  const recetas: any[] = [];
  for (const p of state.productos) {
    for (const linea of p.bom ?? []) {
      recetas.push({
        'Código producto': p.codigo,
        Producto: p.nombre,
        Presentación: p.presentacion,
        'Categoría componente': CATEGORIA_LABEL[linea.categoria],
        'Código componente': linea.codigo,
        'Cantidad por unidad': linea.cantidad,
      });
    }
  }
  hoja(X, libro, 'Recetas', recetas, [16, 40, 20, 20, 18, 18]);

  // --- Historial ---
  hoja(
    X,
    libro,
    'Movimientos',
    state.movimientos.map((m) => ({
      Fecha: fechaLegible(m.fecha),
      Tipo: MOVIMIENTO_LABEL[m.tipo] ?? m.tipo,
      Categoría: CATEGORIA_LABEL[m.categoria],
      Código: m.codigo,
      Nombre: m.nombre,
      Cantidad: deltaMovimiento(m),
      Origen: m.origen === 'tienda' ? 'Tienda' : 'Plataforma',
      Pedido: m.referencia ?? '',
      Usuario: m.usuario ?? '',
      'Componentes descontados': m.componentes?.length ?? 0,
      Nota: m.nota ?? '',
    })),
    [18, 16, 16, 14, 40, 10, 12, 22, 28, 22, 34]
  );

  const detalle: any[] = [];
  for (const m of state.movimientos) {
    for (const c of m.componentes ?? []) {
      detalle.push({
        Fecha: fechaLegible(m.fecha),
        Tipo: m.tipo,
        'Código producto': m.codigo,
        Producto: m.nombre,
        'Categoría componente': CATEGORIA_LABEL[c.categoria],
        'Código componente': c.codigo,
        'Nombre componente': c.nombre,
        Consumido: c.cantidad,
        'Stock resultante': c.resultante,
      });
    }
  }
  hoja(X, libro, 'Detalle de consumos', detalle, [18, 12, 16, 34, 20, 18, 34, 12, 16]);

  // --- Ventas ---
  hoja(
    X,
    libro,
    'Ventas por producto',
    ventas.map((v) => ({
      Código: v.codigo,
      Producto: v.nombre,
      Tipo: v.tipo,
      Presentación: v.presentacion,
      'Unidades vendidas': v.unidades,
      'Ventas registradas': v.operaciones,
      'Última venta': fechaLegible(v.ultima),
      'Stock actual': v.stockActual ?? '',
    })),
    [14, 40, 12, 20, 18, 18, 18, 14]
  );

  const p2 = (n: number) => String(n).padStart(2, '0');
  const nombre = `somos-setas-stock-${ahora.getFullYear()}-${p2(ahora.getMonth() + 1)}-${p2(
    ahora.getDate()
  )}-${p2(ahora.getHours())}${p2(ahora.getMinutes())}.xlsx`;
  X.writeFile(libro, nombre);
  return nombre;
}
