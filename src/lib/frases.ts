// =====================================================================
// EL HISTORIAL EN PALABRAS
//
// La tabla de movimientos sirve para revisar; para el día a día del
// laboratorio cada movimiento se cuenta como una frase: "Matías produjo 20",
// "Se vendió 1 por la tienda web", "Mayra contó el estante: faltaban 5".
// También arma la historia de un componente, que además de sus propios
// movimientos incluye cada producción que lo gastó.
// =====================================================================
import { abrevUnidad, buscarItem, deltaMovimiento, formatNum } from './helpers';
import type { BaseItem, Categoria, DBState, Movimiento } from './types';

/** Cómo se llama cada persona en las frases */
const NOMBRES: Record<string, string> = {
  'fngc279@gmail.com': 'Franco',
  'mayra.santi@somossetas.com.ar': 'Mayra',
  'matias.aurieme@somossetas.com.ar': 'Matías',
};

export function nombreDe(email?: string | null): string {
  const e = String(email ?? '').toLowerCase();
  if (!e) return 'Alguien';
  if (NOMBRES[e]) return NOMBRES[e];
  if (!e.includes('@')) return e.charAt(0).toUpperCase() + e.slice(1);
  const base = e.split('@')[0].split(/[._-]/)[0];
  return base.charAt(0).toUpperCase() + base.slice(1);
}

/** Cuánto hay, con signo: "-43 unidades" si el sistema quedó en negativo */
export function hay(n: number, item?: { unidad?: string | null }): string {
  const u = abrevUnidad(item?.unidad);
  if (u) return `${formatNum(n)} ${u}`;
  return `${formatNum(n)} ${Math.abs(n) === 1 ? 'unidad' : 'unidades'}`;
}

/** "1 unidad", "20 unidades", "1.200 g" (siempre en positivo: es una cantidad movida) */
export function cuanto(n: number, item?: Pick<BaseItem, 'codigo'> & { unidad?: string | null }): string {
  const abs = Math.abs(n);
  const u = abrevUnidad(item?.unidad);
  if (u) return `${formatNum(abs)} ${u}`;
  return `${formatNum(abs)} ${abs === 1 ? 'unidad' : 'unidades'}`;
}

export interface Frase {
  id: string;
  fecha: string;
  /** La oración principal, con las partes a resaltar entre ** ** */
  titulo: string;
  detalle?: string;
  /** Stock del ítem antes y después, si se sabe */
  antes?: number;
  despues?: number;
  /** Cuánto cambió el stock del ítem (con signo) */
  cambio: number;
  /** Para resaltar: un conteo que no coincidió */
  diferencia?: boolean;
  /** El movimiento original, para abrir el detalle */
  mov: Movimiento;
}

function lista(partes: string[]): string {
  if (partes.length <= 1) return partes.join('');
  return partes.slice(0, -1).join(', ') + ' y ' + partes[partes.length - 1];
}

/** Un movimiento del propio ítem, contado en una frase */
export function fraseDe(m: Movimiento, state: DBState): Frase {
  const quien = nombreDe(m.usuario);
  const item = buscarItem(state, m.categoria, m.codigo) as any;
  const cambio = deltaMovimiento(m);
  const n = cuanto(m.cantidad, item);
  const base = { id: m.id, fecha: m.fecha, antes: m.anterior, despues: m.resultante, cambio, mov: m };
  const tienda = m.origen === 'tienda';

  switch (m.tipo) {
    case 'produccion': {
      const usados = (m.componentes ?? []).map((c) => {
        const comp = buscarItem(state, c.categoria, c.codigo) as any;
        return `${cuanto(c.cantidad, comp)} de ${c.nombre || c.codigo}`;
      });
      return {
        ...base,
        titulo: `**${quien}** produjo **${n}**`,
        detalle: usados.length
          ? `Se usaron ${lista(usados)}`
          : 'Este producto no tenía receta: no se descontó nada más',
      };
    }
    case 'venta':
      if (tienda)
        return {
          ...base,
          titulo: cambio > 0 ? `Volvió **${cuanto(cambio, item)}** por un pedido anulado` : `Se vendió **${cuanto(cambio, item)}** por la tienda`,
          detalle: m.referencia ? `Pedido ${m.referencia} · se descontó solo` : 'Se descontó solo',
        };
      return { ...base, titulo: `**${quien}** registró una venta de **${n}**`, detalle: m.nota || undefined };
    case 'consumo_interno':
      return { ...base, titulo: `**${quien}** sacó **${n}** para uso nuestro`, detalle: m.nota || 'No es venta' };
    case 'ingreso':
      return { ...base, titulo: `**${quien}** cargó una compra: entraron **${n}**`, detalle: m.nota || undefined };
    case 'restablecer':
    case 'ajuste': {
      const antes = m.anterior;
      const dif = cambio;
      const contado = m.resultante;
      const cuenta =
        dif === 0
          ? 'coincidía con el sistema'
          : dif < 0
            ? `faltaban ${cuanto(dif, item)}`
            : `sobraban ${cuanto(dif, item)}`;
      return {
        ...base,
        titulo:
          contado != null
            ? `**${quien}** contó el estante: había **${cuanto(contado, item)}**`
            : `**${quien}** contó el estante`,
        detalle:
          antes != null ? `El sistema decía ${formatNum(antes)}: ${cuenta}` : m.nota || undefined,
        diferencia: dif !== 0,
      };
    }
    case 'alta':
      return { ...base, titulo: `**${quien}** dio de alta la ficha`, detalle: m.nota || undefined };
    case 'edicion':
      // En la versión anterior el número se podía cambiar desde la ficha:
      // esas ediciones se muestran como lo que fueron, un cambio a mano.
      if (cambio !== 0)
        return {
          ...base,
          titulo: `**${quien}** cambió el número a mano desde la ficha: **${cambio > 0 ? '+' : '−'}${cuanto(cambio, item)}**`,
          detalle: m.nota ? `${m.nota} · sin decir si fue producción, venta o conteo` : 'Sin decir si fue producción, venta o conteo',
          diferencia: true,
        };
      return { ...base, titulo: `**${quien}** cambió datos de la ficha`, detalle: m.nota || undefined };
    case 'baja':
      return { ...base, titulo: `**${quien}** dio de baja el ítem`, detalle: m.nota || undefined };
    default:
      return { ...base, titulo: m.nota || m.tipo };
  }
}

/** Una producción de OTRO producto que gastó este componente */
function fraseConsumo(m: Movimiento, categoria: Categoria, codigo: string, state: DBState): Frase | null {
  const c = (m.componentes ?? []).find((x) => x.categoria === categoria && x.codigo === codigo);
  if (!c) return null;
  const item = buscarItem(state, categoria, codigo) as any;
  const producto = buscarItem(state, m.categoria, m.codigo);
  return {
    id: m.id + ':' + codigo,
    fecha: m.fecha,
    titulo: `Se usaron **${cuanto(c.cantidad, item)}** para producir ${formatNum(m.cantidad)} ${producto?.nombre ?? m.nombre}`,
    detalle: `Producción cargada por ${nombreDe(m.usuario)}`,
    antes: c.anterior,
    despues: c.resultante,
    cambio: -c.cantidad,
    mov: m,
  };
}

/** Movimientos que corrigen el número en vez de mover mercadería */
export function esCorreccion(m: Movimiento): boolean {
  return m.tipo === 'ajuste' || m.tipo === 'restablecer' || (m.tipo === 'edicion' && deltaMovimiento(m) !== 0);
}

/** Toda la historia de un ítem, de lo más nuevo a lo más viejo */
export function historiaDe(categoria: Categoria, codigo: string, state: DBState): Frase[] {
  const out: Frase[] = [];
  for (const m of state.movimientos) {
    if (m.categoria === categoria && m.codigo === codigo) out.push(fraseDe(m, state));
    else if (m.tipo === 'produccion' && categoria !== 'producto') {
      const f = fraseConsumo(m, categoria, codigo, state);
      if (f) out.push(f);
    }
  }
  return out.sort((a, b) => b.fecha.localeCompare(a.fecha));
}

/** En qué productos se gastó un componente, sumado, desde una fecha */
export function gastoPorProducto(
  categoria: Categoria,
  codigo: string,
  state: DBState,
  desde?: string
): { codigo: string; nombre: string; producidos: number; usado: number }[] {
  const acc = new Map<string, { codigo: string; nombre: string; producidos: number; usado: number }>();
  for (const m of state.movimientos) {
    if (m.tipo !== 'produccion' || (desde && m.fecha < desde)) continue;
    const c = (m.componentes ?? []).find((x) => x.categoria === categoria && x.codigo === codigo);
    if (!c) continue;
    const prev = acc.get(m.codigo) ?? { codigo: m.codigo, nombre: m.nombre, producidos: 0, usado: 0 };
    prev.producidos += m.cantidad;
    prev.usado += c.cantidad;
    acc.set(m.codigo, prev);
  }
  return [...acc.values()].sort((a, b) => b.usado - a.usado);
}

/** "Hoy, jueves 9 de octubre", "Ayer, …", "Martes 6 de octubre" */
export function etiquetaDia(iso: string): string {
  const d = new Date(iso);
  const hoy = new Date();
  const ayer = new Date();
  ayer.setDate(hoy.getDate() - 1);
  const mismo = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  const largo = d.toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' });
  const cap = largo.charAt(0).toUpperCase() + largo.slice(1);
  if (mismo(d, hoy)) return `Hoy, ${largo}`;
  if (mismo(d, ayer)) return `Ayer, ${largo}`;
  return d.getFullYear() !== hoy.getFullYear() ? `${cap} de ${d.getFullYear()}` : cap;
}

export function hora(iso: string): string {
  return new Date(iso).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
}

/** Parte "**así**" en trozos para resaltar en negrita */
export function trozos(texto: string): { t: string; b: boolean }[] {
  return texto.split('**').map((t, i) => ({ t, b: i % 2 === 1 }));
}
