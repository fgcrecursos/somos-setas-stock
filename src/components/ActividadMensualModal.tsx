// =====================================================================
// ACTIVIDAD MES A MES — producción y ventas de cada mes, de toda la historia.
//
// Se abre desde Ventas y producción: tocando las tarjetas de unidades
// vendidas / producidas (todos los productos) o una fila de la tabla (un solo
// producto). No respeta el filtro de período de la pantalla a propósito: la
// idea es ver la serie completa y comparar meses.
//
// En la vista general, tocar un mes despliega qué productos se produjeron y
// vendieron ese mes.
// =====================================================================
import { CalendarDays, ChevronDown, ChevronRight, Store } from 'lucide-react';
import { Fragment, useMemo, useState } from 'react';
import { coincideBusqueda, formatNum } from '../lib/helpers';
import type { Movimiento } from '../lib/types';
import { Modal } from './Modal';

const MESES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];

export type FocoActividad = 'venta' | 'produccion';

interface Props {
  movimientos: Movimiento[];
  /** Qué tarjeta se tocó: define el orden de las columnas y del detalle */
  foco: FocoActividad;
  /** Si viene, la serie es sólo de ese producto */
  producto?: { codigo: string; nombre: string; presentacion?: string };
  onClose: () => void;
  /** Llevar la pantalla al mes elegido (AAAA-MM) */
  onVerMes?: (ym: string) => void;
}

interface Cifras {
  producidas: number;
  vendidas: number;
  tienda: number;
  consumo: number;
}

interface FilaMes extends Cifras {
  ym: string;
  productos: Map<string, Cifras & { nombre: string }>;
}

const vacio = (): Cifras => ({ producidas: 0, vendidas: 0, tienda: 0, consumo: 0 });

const claveMes = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

function etiquetaMes(ym: string) {
  const [a, m] = ym.split('-');
  return `${MESES[Number(m) - 1]} ${a}`;
}

function sumar(c: Cifras, m: Movimiento) {
  if (m.tipo === 'venta') {
    c.vendidas += m.cantidad;
    if (m.origen === 'tienda') c.tienda += m.cantidad;
  } else if (m.tipo === 'produccion') c.producidas += m.cantidad;
  else if (m.tipo === 'consumo_interno') c.consumo += m.cantidad;
}

export function ActividadMensualModal({ movimientos, foco, producto, onClose, onVerMes }: Props) {
  const [abierto, setAbierto] = useState<string | null>(null);
  const [q, setQ] = useState('');

  const meses = useMemo<FilaMes[]>(() => {
    const acc = new Map<string, FilaMes>();
    for (const m of movimientos) {
      if (m.tipo !== 'venta' && m.tipo !== 'produccion' && m.tipo !== 'consumo_interno') continue;
      if (producto && m.codigo !== producto.codigo) continue;
      const d = new Date(m.fecha);
      if (isNaN(d.getTime())) continue;
      const ym = claveMes(d);
      const fila = acc.get(ym) ?? { ym, ...vacio(), productos: new Map() };
      sumar(fila, m);
      const p = fila.productos.get(m.codigo) ?? { nombre: m.nombre, ...vacio() };
      sumar(p, m);
      fila.productos.set(m.codigo, p);
      acc.set(ym, fila);
    }
    if (!acc.size) return [];
    // Se completan los meses sin movimiento entre el primero y hoy: un mes
    // sin producir también es un dato, y saltearlo engaña al comparar.
    const claves = Array.from(acc.keys()).sort();
    const [a0, m0] = claves[0].split('-').map(Number);
    const ultimo = [claveMes(new Date()), claves[claves.length - 1]].sort()[1];
    const salida: FilaMes[] = [];
    for (let d = new Date(a0, m0 - 1, 1); claveMes(d) <= ultimo; d.setMonth(d.getMonth() + 1)) {
      const ym = claveMes(d);
      salida.push(acc.get(ym) ?? { ym, ...vacio(), productos: new Map() });
    }
    return salida.reverse();
  }, [movimientos, producto]);

  const total = useMemo(() => {
    const t = vacio();
    for (const f of meses) {
      t.producidas += f.producidas;
      t.vendidas += f.vendidas;
      t.tienda += f.tienda;
      t.consumo += f.consumo;
    }
    return t;
  }, [meses]);

  const conDatos = meses.filter((f) => f.producidas || f.vendidas || f.consumo).length;
  const promedio = (n: number) => (conDatos ? n / meses.length : 0);
  const maximo = Math.max(1, ...meses.map((f) => Math.max(f.producidas, f.vendidas)));

  // Gráfico: de más viejo a más nuevo, los últimos 12 meses
  const grafico = meses.slice(0, 12).reverse();

  const columnas: { id: FocoActividad; label: string }[] =
    foco === 'produccion'
      ? [{ id: 'produccion', label: 'Producidas' }, { id: 'venta', label: 'Vendidas' }]
      : [{ id: 'venta', label: 'Vendidas' }, { id: 'produccion', label: 'Producidas' }];

  const valor = (c: Cifras, id: FocoActividad) => (id === 'venta' ? c.vendidas : c.producidas);

  const titulo = producto
    ? `${producto.nombre} · mes a mes`
    : foco === 'produccion'
      ? 'Producción mensual'
      : 'Ventas mensuales';

  return (
    <Modal title={titulo} icon={<CalendarDays size={20} />} wide onClose={onClose}>
      <div className="stack" style={{ gap: 16 }}>
        {producto && (
          <p className="hlp" style={{ margin: 0 }}>
            <span className="codigo">{producto.codigo}</span>
            {producto.presentacion ? ` · ${producto.presentacion}` : ''} — toda la historia, sin
            importar el período elegido en la pantalla.
          </p>
        )}

        {meses.length === 0 ? (
          <div className="empty">Todavía no hay ventas ni producción registradas.</div>
        ) : (
          <>
            <div className="act-mes__resumen">
              <Dato label="Producidas en total" valor={total.producidas} color="var(--ok)" />
              <Dato label="Vendidas en total" valor={total.vendidas} color="var(--naranja)"
                pie={total.tienda ? `${formatNum(total.tienda)} por la tienda` : undefined} />
              <Dato label="Producción promedio por mes" valor={Math.round(promedio(total.producidas))} />
              <Dato label="Venta promedio por mes" valor={Math.round(promedio(total.vendidas))} />
            </div>

            <div className="act-mes__grafico" role="img"
              aria-label="Unidades producidas y vendidas en los últimos 12 meses">
              {grafico.map((f) => (
                <div key={f.ym} className="act-mes__col"
                  title={`${etiquetaMes(f.ym)}\nProducidas: ${formatNum(f.producidas)}\nVendidas: ${formatNum(f.vendidas)}`}>
                  <div className="act-mes__barras">
                    <span style={{ height: `${Math.max(0, (f.producidas / maximo) * 100)}%`, background: 'var(--ok)' }} />
                    <span style={{ height: `${Math.max(0, (f.vendidas / maximo) * 100)}%`, background: 'var(--naranja)' }} />
                  </div>
                  <small>{MESES[Number(f.ym.slice(5)) - 1].slice(0, 3)}</small>
                </div>
              ))}
            </div>
            <div className="act-mes__leyenda">
              <span><i style={{ background: 'var(--ok)' }} /> Producidas</span>
              <span><i style={{ background: 'var(--naranja)' }} /> Vendidas</span>
            </div>

            <div className="table-wrap">
              <table className="tbl tbl--m-actmes">
                <thead>
                  <tr>
                    <th className="no-sort">Mes</th>
                    {columnas.map((c) => <th key={c.id} className="num">{c.label}</th>)}
                    <th className="num">Consumo</th>
                    <th className="num">Balance</th>
                    {onVerMes && <th className="no-sort" />}
                  </tr>
                </thead>
                <tbody>
                  {meses.map((f) => {
                    const bal = f.producidas - f.vendidas - f.consumo;
                    const desplegable = !producto && f.productos.size > 0;
                    const esAbierto = abierto === f.ym;
                    const vacioMes = !f.producidas && !f.vendidas && !f.consumo;
                    return (
                      <Fragment key={f.ym}>
                        <tr
                          className={vacioMes ? 'muted' : undefined}
                          style={desplegable ? { cursor: 'pointer' } : undefined}
                          onClick={desplegable ? () => { setAbierto(esAbierto ? null : f.ym); setQ(''); } : undefined}
                          title={desplegable ? 'Ver los productos de este mes' : undefined}
                        >
                          <td className="nombre">
                            {desplegable && (esAbierto
                              ? <ChevronDown size={14} style={{ verticalAlign: 'middle', marginRight: 4 }} />
                              : <ChevronRight size={14} style={{ verticalAlign: 'middle', marginRight: 4 }} />)}
                            <span className="act-mes__largo">{etiquetaMes(f.ym)}</span>
                            <span className="act-mes__corto">{etiquetaMes(f.ym).slice(0, 3)} {f.ym.slice(2, 4)}</span>
                          </td>
                          {columnas.map((c, i) => (
                            <td key={c.id} className="num" style={{ fontWeight: i === 0 ? 700 : 500 }}>
                              {formatNum(valor(f, c.id))}
                              {c.id === 'venta' && f.tienda > 0 && (
                                <div className="hlp"><Store size={10} /> {formatNum(f.tienda)} tienda</div>
                              )}
                            </td>
                          ))}
                          <td className="num muted">{f.consumo ? formatNum(f.consumo) : '—'}</td>
                          <td className={'num ' + (bal < 0 ? 'diff-neg' : bal > 0 ? 'diff-pos' : 'muted')}>
                            {bal > 0 ? '+' : ''}{formatNum(bal)}
                          </td>
                          {onVerMes && (
                            <td className="num">
                              {!vacioMes && (
                                <button className="btn btn--sm btn--ghost"
                                  onClick={(e) => { e.stopPropagation(); onVerMes(f.ym); }}>
                                  Ver<span className="act-mes__largo"> mes</span>
                                </button>
                              )}
                            </td>
                          )}
                        </tr>
                        {esAbierto && (
                          <tr className="act-mes__detalle">
                            <td colSpan={onVerMes ? 6 : 5}>
                              <DetalleMes fila={f} foco={foco} q={q} setQ={setQ} />
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="hlp" style={{ margin: 0 }}>
              Las ventas incluyen los pedidos confirmados de la tienda. El balance es producidas
              menos vendidas menos consumo interno.
            </p>
          </>
        )}
      </div>
    </Modal>
  );
}

function DetalleMes({
  fila, foco, q, setQ,
}: { fila: FilaMes; foco: FocoActividad; q: string; setQ: (v: string) => void }) {
  const productos = Array.from(fila.productos.entries())
    .filter(([codigo, p]) => coincideBusqueda(q, codigo, p.nombre))
    .sort((a, b) =>
      foco === 'produccion'
        ? b[1].producidas - a[1].producidas || b[1].vendidas - a[1].vendidas
        : b[1].vendidas - a[1].vendidas || b[1].producidas - a[1].producidas
    );
  return (
    <div className="act-mes__productos">
      <div className="act-mes__productos-head">
        <strong>{formatNum(fila.productos.size)} productos con movimiento en {etiquetaMes(fila.ym).toLowerCase()}</strong>
        {fila.productos.size > 6 && (
          <input className="input" placeholder="Buscar producto…" value={q}
            onClick={(e) => e.stopPropagation()} onChange={(e) => setQ(e.target.value)} />
        )}
      </div>
      <table className="tbl">
        <thead>
          <tr>
            <th className="no-sort">Producto</th>
            <th className="num">Producidas</th>
            <th className="num">Vendidas</th>
          </tr>
        </thead>
        <tbody>
          {productos.map(([codigo, p]) => (
            <tr key={codigo}>
              <td className="nombre">{p.nombre} <span className="codigo">{codigo}</span></td>
              <td className="num" style={{ fontWeight: foco === 'produccion' ? 700 : 500 }}>
                {p.producidas ? formatNum(p.producidas) : '—'}
              </td>
              <td className="num" style={{ fontWeight: foco === 'venta' ? 700 : 500 }}>
                {p.vendidas ? formatNum(p.vendidas) : '—'}
                {p.tienda > 0 && <div className="hlp">{formatNum(p.tienda)} tienda</div>}
              </td>
            </tr>
          ))}
          {productos.length === 0 && (
            <tr><td colSpan={3}><div className="empty">Ningún producto coincide.</div></td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function Dato({ label, valor, color, pie }: { label: string; valor: number; color?: string; pie?: string }) {
  return (
    <div className="act-mes__dato">
      <div className="act-mes__valor" style={color ? { color } : undefined}>{formatNum(valor)}</div>
      <div className="act-mes__label">{label}</div>
      {pie && <div className="hlp">{pie}</div>}
    </div>
  );
}
