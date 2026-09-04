// =====================================================================
// CÓDIGOS AUTOMÁTICOS
//
// Cada ítem del inventario se identifica por un código corto que viene del
// Excel original y que hoy se usa para escanear, para armar las recetas y para
// vincular la tienda con el stock. Las series son estas:
//
//   Productos        · por tipo: ACE (aceite), CAP (cápsulas), EXT (extracto),
//                      POL (polvo), ENT (setas enteras)
//   Etiquetas        · ETQ + la serie del producto que etiquetan (ETQ-CAP-31)
//   Insumos          · INS      Insumos internos · INSV      Materia prima · MP
//
// Cargar un ítem nuevo obligaba a ir a mirar la tabla para saber cuál era el
// número libre. Acá se calcula solo: se toma el mayor de la serie y se suma uno.
// El número se busca en TODAS las categorías, no sólo en la propia, porque el
// escaneo resuelve un código sin saber de qué categoría es y dos ítems con el
// mismo código serían ambiguos.
// =====================================================================
import { CATEGORIAS_TODAS, buscarPorCodigo, listaDe, normalizarBusqueda } from './helpers';
import type { Categoria, DBState } from './types';

/** Serie que le corresponde a cada tipo (el tipo se escribe libre: se compara sin tildes) */
const SERIE_POR_TIPO: Record<string, string> = {
  aceite: 'ACE',
  aceites: 'ACE',
  capsula: 'CAP',
  capsulas: 'CAP',
  extracto: 'EXT',
  extractos: 'EXT',
  polvo: 'POL',
  polvos: 'POL',
  seta: 'ENT',
  setas: 'ENT',
  entero: 'ENT',
  entera: 'ENT',
  gel: 'GEL',
};

/** Serie de la categoría, para lo que no se distingue por tipo */
const SERIE_POR_CATEGORIA: Record<Categoria, string> = {
  producto: 'PRD',
  insumo: 'INS',
  insumo_interno: 'INSV',
  etiqueta: 'ETQ',
  materia_prima: 'MP',
};

/**
 * Con qué arranca el código de un ítem nuevo. En productos y etiquetas depende
 * del tipo (un aceite es ACE-07 y su etiqueta ETQ-ACE-07); en el resto alcanza
 * con la categoría.
 */
export function prefijoDe(categoria: Categoria, tipo?: string | null): string {
  const serieTipo = SERIE_POR_TIPO[normalizarBusqueda(tipo).trim()];
  if (categoria === 'producto') return serieTipo ?? SERIE_POR_CATEGORIA.producto;
  if (categoria === 'etiqueta') return serieTipo ? `ETQ-${serieTipo}` : 'ETQ';
  return SERIE_POR_CATEGORIA[categoria];
}

/**
 * Parte un código en "letras iniciales" + "primer número".
 * Los códigos cargados no tienen un separador único (ETQ ACE-01, ETQ.ENT-9,
 * POL- 39, MP-08-2), así que se leen por tokens y no por posición: de MP-08-2
 * sale MP y 8, de ETQ ACE-01 sale ETQACE y 1.
 */
function partesCodigo(codigo: string): { serie: string; numero: number | null } {
  const tokens = String(codigo ?? '').toUpperCase().match(/[A-Z]+|[0-9]+/g) ?? [];
  let serie = '';
  for (const t of tokens) {
    if (/^[0-9]+$/.test(t)) return { serie, numero: serie ? Number(t) : null };
    serie += t;
  }
  return { serie, numero: null };
}

/** Dos dígitos, como toda la base ("07", "41"); de 100 en adelante ya no hace falta */
function formatearNumero(n: number): string {
  return n < 100 ? String(n).padStart(2, '0') : String(n);
}

/**
 * El próximo código libre de la serie que le toca a un ítem nuevo.
 * Devuelve string vacío si no se puede calcular (nunca debería pasar: siempre
 * hay una serie por categoría).
 */
export function siguienteCodigo(
  state: DBState,
  categoria: Categoria,
  tipo?: string | null
): string {
  const prefijo = prefijoDe(categoria, tipo);
  const serie = prefijo.replace(/[^A-Za-z]/g, '').toUpperCase();
  if (!serie) return '';

  let mayor = 0;
  for (const cat of CATEGORIAS_TODAS) {
    for (const it of listaDe(state, cat)) {
      const p = partesCodigo(it.codigo);
      if (p.serie !== serie || p.numero == null) continue;
      if (p.numero > mayor) mayor = p.numero;
    }
  }

  // Si el que sigue ya estuviera ocupado (un código escrito raro que la lectura
  // por tokens no contó), se avanza hasta encontrar uno libre.
  let n = mayor + 1;
  let codigo = `${prefijo}-${formatearNumero(n)}`;
  while (buscarPorCodigo(state, codigo)) {
    n += 1;
    codigo = `${prefijo}-${formatearNumero(n)}`;
  }
  return codigo;
}
