// =====================================================================
// REVISIÓN DE DATOS — lo que hace que el stock no cierre.
//
// La auditoría del 30/09/2026 encontró que los números no se despegaban por
// un error de cuentas de la base (st_aplicar cierra movimiento a movimiento)
// sino por los DATOS con los que trabaja: recetas que descuentan la etiqueta
// de otro tamaño, materia prima contada por bolsa que la receta descuenta de
// a una bolsa por frasco, productos sin etiqueta o sin envase en la receta,
// códigos repetidos con otro separador. Cada chequeo de acá es uno de esos
// problemas, calculado en vivo: cuando se corrige la ficha, desaparece.
// =====================================================================
import {
  CATEGORIAS_TODAS,
  CATEGORIA_LABEL,
  abrevUnidad,
  buscarItem,
  compactar,
  listaDe,
  normalizarBusqueda,
} from './helpers';
import type { Categoria, DBState, Producto } from './types';

export type Gravedad = 'grave' | 'revisar' | 'info';

export interface FilaRevision {
  categoria: Categoria;
  codigo: string;
  nombre: string;
  detalle: string;
}

export interface GrupoRevision {
  id: string;
  gravedad: Gravedad;
  titulo: string;
  /** Qué pasa si no se corrige, en una o dos oraciones */
  explicacion: string;
  /** Qué hacer para corregirlo */
  comoSeCorrige: string;
  filas: FilaRevision[];
}

// ---------------------------------------------------------------------
// Tamaño de una presentación: "Bolsa 100g", "1000 grs", "Frasco 60cc",
// "60 mL", "Bolsa 60 u", "90 UNI", "1kg". Devuelve null si no se puede leer
// o si trae dos tamaños ("50g/1kg"), que es justamente lo que no se compara.
// ---------------------------------------------------------------------
interface Tamano {
  dim: 'g' | 'ml' | 'u';
  valor: number;
}

export function leerTamano(texto: unknown): Tamano | null {
  const t = String(texto ?? '').toLowerCase().replace(',', '.');
  const re = /(\d+(?:\.\d+)?)\s*(kg|kilos?|gramos|grs?|g|ml|cc|l|litros?|u|un|uni|unidades)\b/g;
  const hallados: Tamano[] = [];
  for (const m of t.matchAll(re)) {
    const n = Number(m[1]);
    const u = m[2];
    if (/^(kg|kilo)/.test(u)) hallados.push({ dim: 'g', valor: n * 1000 });
    else if (/^(g|gr|grs|gramos)$/.test(u)) hallados.push({ dim: 'g', valor: n });
    else if (u === 'ml' || u === 'cc') hallados.push({ dim: 'ml', valor: n });
    else if (u === 'l' || u.startsWith('litro')) hallados.push({ dim: 'ml', valor: n * 1000 });
    else hallados.push({ dim: 'u', valor: n });
  }
  return hallados.length === 1 ? hallados[0] : null;
}

function textoTamano(t: Tamano): string {
  if (t.dim === 'g') return t.valor >= 1000 ? `${t.valor / 1000} kg` : `${t.valor} g`;
  if (t.dim === 'ml') return t.valor >= 1000 ? `${t.valor / 1000} L` : `${t.valor} ml`;
  return `${t.valor} u`;
}

// ---------------------------------------------------------------------
// Etiqueta sugerida: entre las etiquetas del MISMO tamaño que el producto,
// la que más se parece por nombre. Sólo si hay una ganadora clara; con un
// empate no se sugiere nada (mejor que sugerir la equivocada).
// ---------------------------------------------------------------------
const VACIAS = new Set(['de', 'del', 'con', 'la', 'el', 'polvo', 'bolsa', 'capsulas', 'caps', 'extracto', 'frasco', 'grs', 'gr']);

function palabras(texto: unknown): Set<string> {
  const sinParentesis = String(texto ?? '').replace(/\(.*?\)/g, ' ');
  return new Set(
    normalizarBusqueda(sinParentesis)
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length >= 3 && !VACIAS.has(w) && !/^\d/.test(w))
  );
}

function parecido(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let comunes = 0;
  for (const w of a) if (b.has(w)) comunes++;
  return comunes / (a.size + b.size - comunes);
}

function etiquetaSugerida(state: DBState, p: Producto, tp: Tamano): any | null {
  const pp = palabras(p.nombre);
  const puntajes = (state.etiquetas as any[])
    .map((e) => {
      const te = leerTamano(e.presentacion) ?? leerTamano(e.nombre);
      if (!te || te.dim !== tp.dim || te.valor !== tp.valor) return null;
      return { e, puntaje: parecido(pp, palabras(e.nombre)) };
    })
    // Al menos la mitad de las palabras en común: "Citrato de Potasio" no
    // puede sugerir "Citrato de Magnesio" sólo porque es la única de 500 g.
    .filter((x): x is { e: any; puntaje: number } => !!x && x.puntaje >= 0.5)
    .sort((a, b) => b.puntaje - a.puntaje);
  if (!puntajes.length) return null;
  if (puntajes.length > 1 && puntajes[1].puntaje === puntajes[0].puntaje) return null;
  return puntajes[0].e;
}

const fila = (categoria: Categoria, it: { codigo: string; nombre: string }, detalle: string): FilaRevision => ({
  categoria,
  codigo: it.codigo,
  nombre: it.nombre,
  detalle,
});

export function revisarDatos(state: DBState): GrupoRevision[] {
  const grupos: GrupoRevision[] = [];
  const productos = state.productos as Producto[];

  // ---------- 1. Etiqueta de otro tamaño ----------
  const otroTamano: FilaRevision[] = [];
  for (const p of productos) {
    const tp = leerTamano(p.presentacion);
    if (!tp) continue;
    for (const b of p.bom ?? []) {
      if (b.categoria !== 'etiqueta') continue;
      const e = buscarItem(state, 'etiqueta', b.codigo) as any;
      if (!e) continue;
      const te = leerTamano(e.presentacion) ?? leerTamano(e.nombre);
      if (!te || te.dim !== tp.dim || te.valor === tp.valor) continue;
      const sugerida = etiquetaSugerida(state, p, tp);
      otroTamano.push(
        fila(
          'producto',
          p,
          `Es de ${textoTamano(tp)} y descuenta la etiqueta ${e.codigo} "${e.nombre}" de ${textoTamano(te)}` +
            (sugerida
              ? ` → la de su tamaño parece ser ${sugerida.codigo} "${sugerida.nombre}" (${sugerida.presentacion}, stock ${sugerida.actual})`
              : ` → no hay ninguna etiqueta de ${textoTamano(tp)} con ese nombre`)
        )
      );
    }
  }
  grupos.push({
    id: 'etiqueta-otro-tamano',
    gravedad: 'grave',
    titulo: 'La receta descuenta la etiqueta de otro tamaño',
    explicacion:
      'Cada producción baja la etiqueta equivocada y la correcta nunca se mueve: por eso el conteo de etiquetas no coincide con el estante.',
    comoSeCorrige:
      'Editá el producto y en la receta elegí la etiqueta de su tamaño. Si esa etiqueta no existe, dala de alta en Etiquetas.',
    filas: otroTamano,
  });

  // ---------- 2. Materia prima descontada de a bolsa entera ----------
  const porBolsa = new Map<string, { mp: any; usan: string[] }>();
  for (const p of productos) {
    for (const b of p.bom ?? []) {
      if (b.categoria !== 'materia_prima' || !(Number(b.cantidad) >= 1)) continue;
      const mp = buscarItem(state, 'materia_prima', b.codigo) as any;
      if (!mp || abrevUnidad(mp.unidad)) continue;
      // Contada por bolsa/kilo: el stock es chico (5, 12, -31) y la
      // presentación habla de bolsas o kilos. Las cápsulas (186.860) no entran.
      if (Math.abs(Number(mp.actual) || 0) >= 1000) continue;
      if (!/kg|kilo|bolsa|bid[oó]n|\bl\b|entero|polvo/i.test(String(mp.presentacion ?? ''))) continue;
      const g = porBolsa.get(mp.codigo) ?? { mp, usan: [] };
      g.usan.push(p.codigo);
      porBolsa.set(mp.codigo, g);
    }
  }
  grupos.push({
    id: 'mp-por-bolsa',
    gravedad: 'grave',
    titulo: 'Materia prima que la receta descuenta de a una bolsa entera',
    explicacion:
      'El stock está contado en bolsas o kilos, pero la receta pide "1" por cada frasco o bolsita producida: producir 30 cápsulas de Ashwagandha descuenta 30 bolsas de 5 kg. Por eso la materia prima vive en negativo.',
    comoSeCorrige:
      'Definir en qué unidad se cuenta cada materia prima (conviene gramos), cargar ese conteo y poner en cada receta cuántos gramos lleva una unidad del producto.',
    filas: [...porBolsa.values()]
      .sort((a, b) => b.usan.length - a.usan.length)
      .map(({ mp, usan }) =>
        fila(
          'materia_prima',
          mp,
          `${mp.presentacion || 'sin presentación'} · stock ${Number(mp.actual)} · la usan ${usan.length} producto(s): ${usan.slice(0, 6).join(', ')}${usan.length > 6 ? '…' : ''}`
        )
      ),
  });

  // ---------- 3. Ítems en negativo ----------
  const negativos: FilaRevision[] = [];
  for (const categoria of CATEGORIAS_TODAS)
    for (const it of listaDe(state, categoria))
      if (it.actual < 0)
        negativos.push(fila(categoria, it, `${CATEGORIA_LABEL[categoria]} · stock ${it.actual}`));
  grupos.push({
    id: 'negativos',
    gravedad: 'grave',
    titulo: 'Stock en negativo',
    explicacion:
      'No puede haber menos que cero en el estante: o se vendió/produjo algo que no se había cargado, o la receta descuenta de más.',
    comoSeCorrige:
      'Contar lo que hay y cargarlo como "Corrección por conteo físico". Si vuelve a quedar negativo, revisar la receta o el vínculo con la tienda.',
    filas: negativos,
  });

  // ---------- 4. Recetas incompletas ----------
  const sinReceta: FilaRevision[] = [];
  const sinEtiqueta: FilaRevision[] = [];
  const sinEnvase: FilaRevision[] = [];
  const sinMP: FilaRevision[] = [];
  const repetidas: FilaRevision[] = [];
  const rotas: FilaRevision[] = [];
  for (const p of productos) {
    const bom = p.bom ?? [];
    if (!bom.length) {
      sinReceta.push(fila('producto', p, p.presentacion || 'sin presentación'));
      continue;
    }
    const cats = new Set(bom.map((b) => b.categoria));
    if (!cats.has('etiqueta')) sinEtiqueta.push(fila('producto', p, p.presentacion || ''));
    if (!cats.has('insumo')) sinEnvase.push(fila('producto', p, p.presentacion || ''));
    if (!cats.has('materia_prima')) sinMP.push(fila('producto', p, p.presentacion || ''));
    const vistos = new Set<string>();
    for (const b of bom) {
      const k = `${b.categoria}|${b.codigo}`;
      if (vistos.has(k)) repetidas.push(fila('producto', p, `${b.codigo} aparece más de una vez`));
      vistos.add(k);
      if (!buscarItem(state, b.categoria, b.codigo))
        rotas.push(fila('producto', p, `${CATEGORIA_LABEL[b.categoria]} ${b.codigo} no existe en el inventario`));
    }
  }
  grupos.push({
    id: 'receta-rota',
    gravedad: 'grave',
    titulo: 'La receta apunta a un ítem que no existe',
    explicacion: 'Al producir, esa línea no descuenta nada.',
    comoSeCorrige: 'Editá el producto y elegí el componente de la lista.',
    filas: rotas,
  });
  grupos.push({
    id: 'sin-receta',
    gravedad: 'grave',
    titulo: 'Productos sin receta',
    explicacion: 'Producirlos suma stock pero no descuenta etiqueta, envase ni materia prima.',
    comoSeCorrige: 'Editá el producto y cargá su receta.',
    filas: sinReceta,
  });
  grupos.push({
    id: 'sin-etiqueta',
    gravedad: 'revisar',
    titulo: 'Recetas sin etiqueta',
    explicacion: 'Si el producto lleva etiqueta, producirlo no la descuenta.',
    comoSeCorrige: 'Sumá la etiqueta a la receta (si existe en Etiquetas) o dala de alta.',
    filas: sinEtiqueta,
  });
  grupos.push({
    id: 'sin-envase',
    gravedad: 'revisar',
    titulo: 'Recetas sin envase',
    explicacion: 'No descuentan ninguna bolsa, frasco o caja al producir.',
    comoSeCorrige: 'Sumá el envase (Insumos de productos) a la receta.',
    filas: sinEnvase,
  });
  grupos.push({
    id: 'sin-mp',
    gravedad: 'revisar',
    titulo: 'Recetas sin materia prima',
    explicacion: 'Producirlas no descuenta ningún hongo, polvo ni base.',
    comoSeCorrige: 'Sumá la materia prima que corresponde (o las de la mezcla).',
    filas: sinMP,
  });
  grupos.push({
    id: 'linea-repetida',
    gravedad: 'revisar',
    titulo: 'Componentes repetidos en la receta',
    explicacion: 'El mismo ítem está en dos líneas: se descuenta dos veces.',
    comoSeCorrige: 'Dejalo en una sola línea con la cantidad total.',
    filas: repetidas,
  });

  // ---------- 5. Una etiqueta para varios productos ----------
  const usoEtq = new Map<string, Producto[]>();
  for (const p of productos)
    for (const b of p.bom ?? [])
      if (b.categoria === 'etiqueta') usoEtq.set(b.codigo, [...(usoEtq.get(b.codigo) ?? []), p]);
  const compartidas: FilaRevision[] = [];
  for (const [codigo, ps] of usoEtq) {
    if (ps.length < 2) continue;
    const e = buscarItem(state, 'etiqueta', codigo);
    if (!e) continue;
    compartidas.push(
      fila('etiqueta', e, `La descuentan ${ps.length} productos: ${ps.map((p) => `${p.codigo} ${p.nombre} (${p.presentacion || '—'})`).join(' · ')}`)
    );
  }
  grupos.push({
    id: 'etiqueta-compartida',
    gravedad: 'revisar',
    titulo: 'Una misma etiqueta en varias recetas',
    explicacion:
      'Puede estar bien (una etiqueta genérica), pero casi siempre es un producto que quedó con la etiqueta de otro.',
    comoSeCorrige: 'Revisá cada producto de la lista y dejale la etiqueta que lleva de verdad.',
    filas: compartidas,
  });

  // ---------- 6. Códigos que se leen igual o con espacios ----------
  const porCompacto = new Map<string, { categoria: Categoria; it: any }[]>();
  const irregulares: FilaRevision[] = [];
  for (const categoria of CATEGORIAS_TODAS)
    for (const it of listaDe(state, categoria)) {
      const k = compactar(it.codigo);
      porCompacto.set(k, [...(porCompacto.get(k) ?? []), { categoria, it }]);
      if (/\s/.test(it.codigo))
        irregulares.push(fila(categoria, it, `"${it.codigo}" tiene espacios: el escáner y el buscador lo confunden`));
    }
  for (const lista of porCompacto.values())
    if (lista.length > 1)
      for (const { categoria, it } of lista)
        irregulares.push(
          fila(
            categoria,
            it,
            `Se lee igual que ${lista.filter((x) => x.it !== it).map((x) => `${x.it.codigo} (${x.it.nombre})`).join(', ')}`
          )
        );
  grupos.push({
    id: 'codigos',
    gravedad: 'revisar',
    titulo: 'Códigos con espacios o que se confunden',
    explicacion:
      '"MP-30" es Reishi y "MP- 30" es Bisglicinato: al escanear o buscar se leen igual. Los códigos con espacios se cargaron a mano.',
    comoSeCorrige:
      'Editá el ítem y cambiale el código por uno sin espacios. Las recetas y los vínculos con la tienda se actualizan solos.',
    filas: irregulares,
  });

  // ---------- 7. Sin stock mínimo ----------
  grupos.push({
    id: 'sin-minimo',
    gravedad: 'info',
    titulo: 'Productos sin stock mínimo',
    explicacion: 'Nunca aparecen en Reposición ni en las alertas, aunque se agoten.',
    comoSeCorrige: 'Cargá el mínimo en la ficha (o dejalo en 0 si no se repone más).',
    filas: productos.filter((p) => !(p.minimo > 0)).map((p) => fila('producto', p, `stock ${p.actual}`)),
  });

  // ---------- 8. Componentes que ninguna receta usa ----------
  const usados = new Set<string>();
  for (const p of productos) for (const b of p.bom ?? []) usados.add(`${b.categoria}|${b.codigo}`);
  const sinUso: FilaRevision[] = [];
  for (const categoria of ['etiqueta', 'insumo', 'materia_prima'] as Categoria[])
    for (const it of listaDe(state, categoria))
      if (!usados.has(`${categoria}|${it.codigo}`))
        sinUso.push(fila(categoria, it, `${CATEGORIA_LABEL[categoria]} · stock ${it.actual}`));
  grupos.push({
    id: 'sin-uso',
    gravedad: 'info',
    titulo: 'Etiquetas, insumos y materia prima que ninguna receta descuenta',
    explicacion:
      'Su stock sólo baja a mano. Algunos está bien (cajas de envío, bolsas camiseta); otros son la etiqueta o el envase correcto de un producto que descuenta otro.',
    comoSeCorrige: 'Si se usa para fabricar algo, sumalo a la receta de ese producto.',
    filas: sinUso,
  });

  return grupos;
}

export const GRAVEDAD_LABEL: Record<Gravedad, string> = {
  grave: 'Afecta el stock hoy',
  revisar: 'Revisar',
  info: 'Para tener en cuenta',
};
