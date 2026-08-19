// =====================================================================
// REPOSICIÓN — qué hay que producir y qué hay que comprar para poder hacerlo.
//
// El dashboard ya avisa qué está por debajo del mínimo, pero avisa ítem por
// ítem: dice "faltan 40 cápsulas de Melena" y por otro lado "faltan etiquetas
// de Melena", sin conectar las dos cosas. Acá se hace el cruce que importa:
// se toma cuánto falta producir de cada producto, se explota su receta y se
// compara la demanda total contra el stock real de cada componente. De ahí
// salen las dos listas que se usan en el día a día: qué se puede fabricar ya
// y qué hay que comprar antes de poder fabricar el resto.
// =====================================================================
import { buscarItem, calcEstado, listaDe } from './helpers';
import type { CategoriaComponente, DBState } from './types';

/** Una línea de receta ya resuelta contra el inventario */
export interface ComponenteResuelto {
  categoria: CategoriaComponente;
  codigo: string;
  nombre: string;
  /** Cuánto consume UNA unidad del producto */
  porUnidad: number;
  /** Cuánto se necesita para cubrir todo lo que falta producir */
  necesita: number;
  /** Stock del componente hoy */
  actual: number;
  /** Cuántas unidades del producto alcanza a cubrir este componente */
  alcanzaPara: number;
  /** La receta apunta a un código que no existe en el inventario */
  huerfano: boolean;
}

export interface ProductoAProducir {
  codigo: string;
  nombre: string;
  tipo: string;
  presentacion: string;
  actual: number;
  minimo: number;
  /** Unidades que faltan para volver al mínimo */
  faltan: number;
  estado: ReturnType<typeof calcEstado>;
  componentes: ComponenteResuelto[];
  /** Cuántas unidades se pueden fabricar YA con lo que hay en el depósito */
  posibles: number;
  /** El componente que primero se queda corto, si no alcanza para todo */
  cuelloBotella: ComponenteResuelto | null;
  /** El producto no tiene receta cargada: producirlo no descuenta nada */
  sinReceta: boolean;
}

export interface ComponenteAComprar {
  categoria: CategoriaComponente;
  codigo: string;
  nombre: string;
  actual: number;
  minimo: number;
  /** Total que pide la producción pendiente de todos los productos */
  necesita: number;
  /** Lo que falta para llegar al mínimo propio del ítem */
  faltaMinimo: number;
  /** Lo que falta para cubrir la producción pendiente */
  faltaProduccion: number;
  /** Cuánto conviene comprar: el mayor de los dos faltantes */
  comprar: number;
  /** Qué productos lo consumen y cuánto le pide cada uno */
  usadoEn: { codigo: string; nombre: string; necesita: number }[];
  /** Aparece en alguna receta pero no existe como ítem del inventario */
  huerfano: boolean;
}

/** Una receta que apunta a un ítem inexistente: al producir no se descuenta */
export interface RecetaRota {
  producto: string;
  productoNombre: string;
  categoria: CategoriaComponente;
  codigo: string;
}

export interface Reposicion {
  producir: ProductoAProducir[];
  comprar: ComponenteAComprar[];
  /** Productos con stock bajo el mínimo y sin receta cargada */
  sinReceta: ProductoAProducir[];
  /** Líneas de receta que apuntan a códigos que no existen */
  recetasRotas: RecetaRota[];
}

const clave = (categoria: string, codigo: string) => `${categoria}::${codigo}`;

/**
 * Cuántas unidades del producto se pueden fabricar con el stock de un
 * componente. Una línea de receta con cantidad 0 (o negativa, por un error de
 * carga) no limita nada: no consume, así que alcanza para infinitas.
 */
function alcanzaPara(actual: number, porUnidad: number): number {
  if (!(porUnidad > 0)) return Infinity;
  return Math.floor(actual / porUnidad);
}

export function calcularReposicion(state: DBState): Reposicion {
  const recetasRotas: RecetaRota[] = [];

  // 1) Qué falta producir de cada producto, con su receta resuelta
  const producir: ProductoAProducir[] = [];
  const sinRecetaList: ProductoAProducir[] = [];

  for (const p of state.productos) {
    const estado = calcEstado(p.actual, p.minimo);
    if (estado.faltan <= 0) continue;

    const componentes: ComponenteResuelto[] = (p.bom ?? []).map((linea) => {
      const item = buscarItem(state, linea.categoria, linea.codigo);
      const huerfano = !item;
      if (huerfano) {
        recetasRotas.push({
          producto: p.codigo,
          productoNombre: p.nombre,
          categoria: linea.categoria,
          codigo: linea.codigo,
        });
      }
      const actual = item?.actual ?? 0;
      return {
        categoria: linea.categoria,
        codigo: linea.codigo,
        nombre: item?.nombre ?? '(no existe en el inventario)',
        porUnidad: linea.cantidad,
        necesita: linea.cantidad * estado.faltan,
        actual,
        alcanzaPara: alcanzaPara(actual, linea.cantidad),
        huerfano,
      };
    });

    const sinReceta = componentes.length === 0;
    // Con receta vacía no hay límite de insumos: el tope es lo que falta.
    const posibles = sinReceta
      ? estado.faltan
      : Math.min(...componentes.map((c) => c.alcanzaPara));
    const cuelloBotella = sinReceta
      ? null
      : componentes.reduce<ComponenteResuelto | null>(
          (peor, c) => (peor === null || c.alcanzaPara < peor.alcanzaPara ? c : peor),
          null
        );

    const fila: ProductoAProducir = {
      codigo: p.codigo,
      nombre: p.nombre,
      tipo: p.tipo,
      presentacion: p.presentacion,
      actual: p.actual,
      minimo: p.minimo,
      faltan: estado.faltan,
      estado,
      componentes,
      posibles: Number.isFinite(posibles) ? posibles : estado.faltan,
      cuelloBotella: cuelloBotella && cuelloBotella.alcanzaPara < estado.faltan ? cuelloBotella : null,
      sinReceta,
    };
    producir.push(fila);
    if (sinReceta) sinRecetaList.push(fila);
  }

  // Primero lo más urgente: agotados arriba, después por cantidad faltante
  producir.sort((a, b) => {
    const aa = a.actual <= 0 ? 1 : 0;
    const bb = b.actual <= 0 ? 1 : 0;
    if (aa !== bb) return bb - aa;
    return b.faltan - a.faltan;
  });

  // 2) Demanda total de cada componente, sumando la de todos los productos
  const demanda = new Map<string, ComponenteAComprar>();

  function fila(categoria: CategoriaComponente, codigo: string): ComponenteAComprar {
    const k = clave(categoria, codigo);
    let f = demanda.get(k);
    if (!f) {
      const item = buscarItem(state, categoria, codigo);
      f = {
        categoria,
        codigo,
        nombre: item?.nombre ?? '(no existe en el inventario)',
        actual: item?.actual ?? 0,
        minimo: item?.minimo ?? 0,
        necesita: 0,
        faltaMinimo: 0,
        faltaProduccion: 0,
        comprar: 0,
        usadoEn: [],
        huerfano: !item,
      };
      demanda.set(k, f);
    }
    return f;
  }

  for (const p of producir) {
    for (const c of p.componentes) {
      const f = fila(c.categoria, c.codigo);
      f.necesita += c.necesita;
      f.usadoEn.push({ codigo: p.codigo, nombre: p.nombre, necesita: c.necesita });
    }
  }

  // 3) Todo componente por debajo de SU mínimo también entra a la lista de
  //    compra, aunque ningún producto pendiente lo pida ahora mismo.
  const CATS_COMP: CategoriaComponente[] = [
    'insumo',
    'etiqueta',
    'materia_prima',
    'insumo_interno',
  ];
  for (const cat of CATS_COMP) {
    for (const it of listaDe(state, cat)) {
      if (calcEstado(it.actual, it.minimo).faltan > 0) fila(cat, it.codigo);
    }
  }

  const comprar: ComponenteAComprar[] = [];
  for (const f of demanda.values()) {
    f.faltaMinimo = Math.max(f.minimo - f.actual, 0);
    f.faltaProduccion = Math.max(f.necesita - f.actual, 0);
    // Se compra lo mayor de los dos: cubrir la producción pendiente sin quedar
    // por debajo del mínimo. No se suman, porque el mínimo ya es un colchón.
    f.comprar = Math.max(f.faltaMinimo, f.faltaProduccion);
    f.usadoEn.sort((a, b) => b.necesita - a.necesita);
    if (f.comprar > 0) comprar.push(f);
  }

  comprar.sort((a, b) => {
    // Lo que frena una producción va primero; después, lo más agotado
    if ((b.faltaProduccion > 0 ? 1 : 0) !== (a.faltaProduccion > 0 ? 1 : 0))
      return (b.faltaProduccion > 0 ? 1 : 0) - (a.faltaProduccion > 0 ? 1 : 0);
    const aa = a.actual <= 0 ? 1 : 0;
    const bb = b.actual <= 0 ? 1 : 0;
    if (aa !== bb) return bb - aa;
    return b.comprar - a.comprar;
  });

  return { producir, comprar, sinReceta: sinRecetaList, recetasRotas };
}
