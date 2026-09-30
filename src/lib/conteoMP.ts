// =====================================================================
// CONTEO DE MATERIA PRIMA EN GRAMOS
//
// La materia prima se contaba por envase (bolsas de 1 o 5 kg, bidones) y las
// recetas pedían "1" por cada unidad producida: cada frasco se llevaba una
// bolsa entera. Pasar a gramos es contar y corregir las recetas JUNTOS, una
// materia prima por vez: si se cuenta en gramos pero la receta sigue pidiendo
// 1, cada frasco descuenta 1 g; si se cambia la receta pero el stock sigue en
// bolsas, cada frasco descuenta 30 bolsas.
//
// Las sugerencias salen sólo de datos que ya existen (el contenido neto de la
// presentación, "60 cápsulas × 500 mg" de la tienda). Extractos, aceites,
// geles y mezclas no tienen sugerencia: los gramos los da producción.
//
// Todo se carga directo en la plataforma (sin planilla intermedia): pasar los
// datos por un Excel era cargar dos veces la misma información.
// =====================================================================
import { abrevUnidad, formatNum, normalizarBusqueda } from './helpers';
import { leerTamano } from './revision';
import type { DBState, MateriaPrima, Producto, SkuMap } from './types';

export type UnidadConteo = 'g' | 'ml' | 'u';

export const UNIDADES_CONTEO: { valor: UnidadConteo; label: string; largo: string }[] = [
  { valor: 'g', label: 'Gramos (g)', largo: 'gramos' },
  { valor: 'ml', label: 'Mililitros (ml)', largo: 'mililitros' },
  { valor: 'u', label: 'Unidades (u)', largo: 'unidades' },
];

export interface Sugerencia {
  cantidad: number;
  /** De dónde sale el número, para que se pueda verificar */
  porque: string;
}

export interface UsoEnReceta {
  producto: Producto;
  /** Lo que la receta descuenta hoy de esta materia prima (sumando líneas repetidas) */
  cantidadHoy: number;
  /** Cuántas líneas de la receta la nombran (más de una = repetida) */
  lineas: number;
  sugerido: Sugerencia | null;
}

/** La cápsula vacía (MP-04) se cuenta por unidad, no por peso */
export function esCapsulaVacia(mp: { nombre?: string | null }): boolean {
  return /^\s*c[aá]psulas?\s*$/i.test(String(mp.nombre ?? ''));
}

/** Ya se cuenta en una unidad (se pasó a gramos o se cargó la unidad a mano) */
export function tieneUnidad(mp: MateriaPrima): boolean {
  return !!abrevUnidad(mp.unidad);
}

export function unidadSugerida(mp: MateriaPrima): UnidadConteo {
  const actual = abrevUnidad(mp.unidad);
  if (actual === 'g' || actual === 'ml' || actual === 'u') return actual;
  if (esCapsulaVacia(mp)) return 'u';
  const t = normalizarBusqueda(`${mp.tipo ?? ''} ${mp.presentacion ?? ''}`);
  if (/liquido|bidon|\bml\b|\bcc\b|\d\s*l\b|litro/.test(t)) return 'ml';
  return 'g';
}

/** Cuánto trae un envase según la presentación ("Bolsa 5 kg" → 5000 g) */
function contenidoEnvase(mp: MateriaPrima, unidad: UnidadConteo): number | null {
  const t = leerTamano(mp.presentacion);
  if (!t) return null;
  if ((unidad === 'g' && t.dim === 'g') || (unidad === 'ml' && t.dim === 'ml')) return t.valor;
  return null;
}

/**
 * El mínimo en la unidad nueva. Si el mínimo de hoy parece contado en envases
 * (número chico, "2 bolsas"), se multiplica por lo que trae cada envase. Si ya
 * parece estar en la unidad chica (la cápsula: 50.000) se deja como está.
 */
export function minimoSugerido(mp: MateriaPrima, unidad: UnidadConteo): Sugerencia | null {
  if (!(mp.minimo > 0)) return null;
  if (tieneUnidad(mp) && abrevUnidad(mp.unidad) === unidad)
    return { cantidad: mp.minimo, porque: 'el mínimo que ya tenía' };
  if (unidad === 'u' || mp.minimo >= 1000 || Math.abs(mp.actual) >= 1000)
    return { cantidad: mp.minimo, porque: 'el mínimo de hoy ya parece estar en esa unidad' };
  // Entre 100 y 1000 no se sabe si son envases, kilos o gramos (Creatina: 120)
  if (mp.minimo >= 100) return null;
  const envase = contenidoEnvase(mp, unidad);
  if (!envase) return null;
  return {
    cantidad: mp.minimo * envase,
    porque: `${formatNum(mp.minimo)} × ${mp.presentacion}`,
  };
}

/** "60u × 500 mg", "60 cápsulas × 500 mg", "x 500mg x 60 unidades" → gramos */
function gramosDeCapsulas(texto: string): { n: number; mg: number } | null {
  const a = /(\d+)\s*(?:u|unidades|c[aá]psulas)?\s*[×x]\s*(\d+(?:[.,]\d+)?)\s*mg/i.exec(texto);
  if (a) return { n: Number(a[1]), mg: Number(a[2].replace(',', '.')) };
  const b = /(\d+(?:[.,]\d+)?)\s*mg\s*[×x]\s*(\d+)\s*(?:u|unidades|c[aá]psulas)/i.exec(texto);
  if (b) return { n: Number(b[2]), mg: Number(b[1].replace(',', '.')) };
  return null;
}

/**
 * Cuánto lleva una unidad del producto de esta materia prima, si se puede
 * saber con un dato real. Devuelve null en las mezclas (el reparto entre
 * ingredientes lo sabe producción) y en extractos, aceites y geles.
 */
export function cantidadSugerida(
  state: DBState,
  p: Producto,
  mp: MateriaPrima,
  unidad: UnidadConteo,
  descripcionesTienda: string[]
): Sugerencia | null {
  // La cápsula vacía: tantas como diga la presentación ("Bolsa 60 u")
  if (esCapsulaVacia(mp)) {
    const t = leerTamano(p.presentacion);
    return unidad === 'u' && t?.dim === 'u'
      ? { cantidad: t.valor, porque: `${t.valor} cápsulas por ${p.presentacion}` }
      : null;
  }

  // Mezcla: más de una materia prima de peso, o el nombre lo dice
  const deMateria = new Set(
    (p.bom ?? [])
      .filter((b) => b.categoria === 'materia_prima')
      .map((b) => b.codigo)
      .filter((c) => {
        const it = state.materiaPrima.find((m) => m.codigo === c);
        return !it || !esCapsulaVacia(it);
      })
  );
  if (deMateria.size > 1 || /\+|\bcon\b/i.test(p.nombre)) return null;

  const tipo = normalizarBusqueda(p.tipo);
  if (tipo.includes('capsula')) {
    if (unidad !== 'g') return null;
    for (const d of descripcionesTienda) {
      const c = gramosDeCapsulas(d);
      if (c) {
        const g = (c.n * c.mg) / 1000;
        return { cantidad: g, porque: `${c.n} cápsulas × ${formatNum(c.mg)} mg (según la tienda)` };
      }
    }
    return null;
  }
  if (tipo.includes('extracto') || tipo.includes('aceite') || tipo.includes('gel')) return null;

  const t = leerTamano(p.presentacion);
  if (unidad === 'g' && t?.dim === 'g')
    return { cantidad: t.valor, porque: `contenido neto: ${p.presentacion}` };
  return null;
}

/** Descripciones de la tienda de cada producto del stock (para leer "60u × 500 mg") */
export function descripcionesPorProducto(map: SkuMap[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const m of map) {
    if (!m.activo || m.categoria !== 'producto' || !m.etiqueta) continue;
    out.set(m.codigo, [...(out.get(m.codigo) ?? []), m.etiqueta]);
  }
  return out;
}

/** Los productos que descuentan esta materia prima, con lo que piden hoy */
export function usosDe(
  state: DBState,
  mp: MateriaPrima,
  unidad: UnidadConteo,
  tienda: Map<string, string[]>
): UsoEnReceta[] {
  const out: UsoEnReceta[] = [];
  for (const p of state.productos) {
    const lineas = (p.bom ?? []).filter((b) => b.categoria === 'materia_prima' && b.codigo === mp.codigo);
    if (!lineas.length) continue;
    out.push({
      producto: p,
      cantidadHoy: lineas.reduce((a, b) => a + (Number(b.cantidad) || 0), 0),
      lineas: lineas.length,
      sugerido: cantidadSugerida(state, p, mp, unidad, tienda.get(p.codigo) ?? []),
    });
  }
  return out.sort((a, b) => a.producto.codigo.localeCompare(b.producto.codigo));
}
