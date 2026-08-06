// =====================================================================
// VENTAS — cuánto se vendió, de qué y cuándo.
//
// Cuenta lo que se registró EN ESTA PLATAFORMA (ventas por escaneo o carga
// manual). Las ventas de la tienda online se cuentan aparte, en el panel de
// somossetas.com.ar, porque son canales distintos.
// =====================================================================
import { Download, PackageSearch, Receipt, ShoppingCart, TrendingUp } from 'lucide-react';
import { Fragment, useMemo, useState } from 'react';
import { useToast } from '../components/Toast';
import { descargarInforme } from '../lib/backup';
import { formatFecha, formatNum } from '../lib/helpers';
import { useStore } from '../lib/store';
import type { Movimiento } from '../lib/types';

const MESES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];

type PeriodoId = 'mes-actual' | 'mes-anterior' | 'ult-30' | 'anio' | 'todo' | string;

function limites(periodo: PeriodoId): { desde: number; hasta: number } | null {
  const hoy = new Date();
  const a = hoy.getFullYear();
  const m = hoy.getMonth();
  if (periodo === 'todo') return null;
  if (periodo === 'mes-actual')
    return { desde: new Date(a, m, 1).getTime(), hasta: new Date(a, m + 1, 1).getTime() - 1 };
  if (periodo === 'mes-anterior')
    return { desde: new Date(a, m - 1, 1).getTime(), hasta: new Date(a, m, 1).getTime() - 1 };
  if (periodo === 'ult-30') return { desde: Date.now() - 30 * 864e5, hasta: Date.now() };
  if (periodo === 'anio')
    return { desde: new Date(a, 0, 1).getTime(), hasta: new Date(a + 1, 0, 1).getTime() - 1 };
  if (/^\d{4}-\d{2}$/.test(periodo)) {
    const [aa, mm] = periodo.split('-').map(Number);
    return { desde: new Date(aa, mm - 1, 1).getTime(), hasta: new Date(aa, mm, 1).getTime() - 1 };
  }
  return null;
}

function etiquetaMes(ym: string) {
  const [a, m] = ym.split('-');
  return `${MESES[Number(m) - 1]} ${a}`;
}

function etiquetaPeriodo(periodo: PeriodoId) {
  if (periodo === 'todo') return 'Histórico completo';
  if (periodo === 'mes-actual') return 'Mes en curso';
  if (periodo === 'mes-anterior') return 'Mes anterior';
  if (periodo === 'ult-30') return 'Últimos 30 días';
  if (periodo === 'anio') return 'Año en curso';
  if (/^\d{4}-\d{2}$/.test(periodo)) return etiquetaMes(periodo);
  return '';
}

export function VentasView() {
  const { state } = useStore();
  const toast = useToast();
  const [periodo, setPeriodo] = useState<PeriodoId>('mes-actual');
  const [tipo, setTipo] = useState<'venta' | 'produccion'>('venta');
  const [abierto, setAbierto] = useState<string | null>(null);

  const mesesConDatos = useMemo(() => {
    const set = new Set<string>();
    for (const m of state.movimientos) {
      if (m.tipo !== 'venta' && m.tipo !== 'produccion') continue;
      const d = new Date(m.fecha);
      if (isNaN(d.getTime())) continue;
      set.add(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    }
    return Array.from(set).sort().reverse();
  }, [state.movimientos]);

  const movimientos = useMemo(() => {
    const lim = limites(periodo);
    return state.movimientos.filter((m) => {
      if (m.tipo !== tipo) return false;
      if (!lim) return true;
      const t = new Date(m.fecha).getTime();
      return t >= lim.desde && t <= lim.hasta;
    });
  }, [state.movimientos, periodo, tipo]);

  const ranking = useMemo(() => {
    const acc = new Map<string, { nombre: string; unidades: number; operaciones: number; ultima: string }>();
    for (const m of movimientos) {
      const prev = acc.get(m.codigo) ?? {
        nombre: m.nombre,
        unidades: 0,
        operaciones: 0,
        ultima: m.fecha,
      };
      prev.unidades += m.cantidad;
      prev.operaciones += 1;
      if (m.fecha > prev.ultima) prev.ultima = m.fecha;
      acc.set(m.codigo, prev);
    }
    return Array.from(acc.entries())
      .map(([codigo, v]) => {
        const p = state.productos.find((x) => x.codigo === codigo);
        return { codigo, ...v, tipo: p?.tipo ?? '—', presentacion: p?.presentacion ?? '', stock: p?.actual ?? null };
      })
      .sort((a, b) => b.unidades - a.unidades);
  }, [movimientos, state.productos]);

  const totalUnidades = ranking.reduce((s, r) => s + r.unidades, 0);
  const maxUnidades = ranking[0]?.unidades ?? 0;

  const porTipo = useMemo(() => {
    const acc = new Map<string, number>();
    for (const r of ranking) acc.set(r.tipo, (acc.get(r.tipo) ?? 0) + r.unidades);
    return Array.from(acc.entries()).sort((a, b) => b[1] - a[1]);
  }, [ranking]);

  const esVenta = tipo === 'venta';
  const palabra = esVenta ? 'venta' : 'producción';
  const palabraPl = esVenta ? 'ventas' : 'producciones';

  async function exportar() {
    const nombre = await descargarInforme(
      ranking,
      movimientos,
      `${esVenta ? 'Ventas' : 'Producción'} · ${etiquetaPeriodo(periodo)}`
    );
    toast(`Informe descargado: ${nombre}`);
  }

  return (
    <div className="stack">
      {/* Filtros */}
      <div className="toolbar">
        <div className="chips">
          <button className={'chip' + (tipo === 'venta' ? ' active' : '')} onClick={() => setTipo('venta')}>
            Ventas
          </button>
          <button className={'chip' + (tipo === 'produccion' ? ' active' : '')} onClick={() => setTipo('produccion')}>
            Producción
          </button>
        </div>
        <div className="toolbar__spacer" />
        <button className="btn btn--sm" onClick={exportar} disabled={!movimientos.length}>
          <Download size={14} /> Descargar informe
        </button>
      </div>

      <div className="toolbar" style={{ marginTop: -6 }}>
        <span className="muted" style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase' }}>
          Período
        </span>
        <div className="chips">
          {(
            [
              ['mes-actual', 'Este mes'],
              ['mes-anterior', 'Mes anterior'],
              ['ult-30', 'Últimos 30 días'],
              ['anio', 'Este año'],
              ['todo', 'Todo'],
            ] as [PeriodoId, string][]
          ).map(([id, label]) => (
            <button key={id} className={'chip' + (periodo === id ? ' active' : '')} onClick={() => setPeriodo(id)}>
              {label}
            </button>
          ))}
          {mesesConDatos.slice(0, 6).map((ym) => (
            <button key={ym} className={'chip' + (periodo === ym ? ' active' : '')} onClick={() => setPeriodo(ym)}>
              {etiquetaMes(ym)}
            </button>
          ))}
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid--kpi">
        <Kpi
          icon={<ShoppingCart size={19} />}
          color="var(--naranja)"
          bg="var(--naranja-100)"
          valor={formatNum(totalUnidades)}
          label={esVenta ? 'Unidades vendidas' : 'Unidades producidas'}
          foot={etiquetaPeriodo(periodo)}
        />
        <Kpi
          icon={<PackageSearch size={19} />}
          color="var(--verde-700)"
          bg="var(--crema-3)"
          valor={formatNum(ranking.length)}
          label="Productos distintos"
          foot={`de ${state.productos.length} del catálogo`}
        />
        <Kpi
          icon={<Receipt size={19} />}
          color="var(--ok)"
          bg="var(--ok-bg)"
          valor={formatNum(movimientos.length)}
          label={`${palabraPl.charAt(0).toUpperCase() + palabraPl.slice(1)} registradas`}
          foot={
            movimientos.length
              ? `promedio ${formatNum(Math.round((totalUnidades / movimientos.length) * 10) / 10)} u por ${palabra}`
              : 'sin movimientos'
          }
        />
        <Kpi
          icon={<TrendingUp size={19} />}
          color="var(--bajo)"
          bg="var(--bajo-bg)"
          valor={ranking[0] ? formatNum(ranking[0].unidades) : '—'}
          label={esVenta ? 'Más vendido' : 'Más producido'}
          foot={ranking[0]?.nombre ?? 'sin datos'}
        />
      </div>

      {/* Ranking */}
      <div className="card">
        <div className="card__head">
          <TrendingUp size={18} />
          <h3>Ranking de productos</h3>
          <span className="pill" style={{ marginLeft: 'auto' }}>{etiquetaPeriodo(periodo)}</span>
        </div>
        <div className="table-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th className="no-sort" style={{ width: 40 }}>#</th>
                <th className="no-sort">Producto</th>
                <th className="no-sort">Tipo</th>
                <th className="num">Unidades</th>
                <th className="no-sort" style={{ width: '22%' }}>Participación</th>
                <th className="num">{esVenta ? 'Ventas' : 'Lotes'}</th>
                <th className="num">Stock actual</th>
                <th className="no-sort">Última</th>
              </tr>
            </thead>
            <tbody>
              {ranking.map((r, i) => (
                <tr key={r.codigo}>
                  <td className="muted">{i + 1}</td>
                  <td className="nombre">
                    {r.nombre} <span className="codigo">{r.codigo}</span>
                    {r.presentacion && <div className="hlp">{r.presentacion}</div>}
                  </td>
                  <td><span className="pill">{r.tipo}</span></td>
                  <td className="num" style={{ fontWeight: 700 }}>{formatNum(r.unidades)}</td>
                  <td>
                    <div className="barra">
                      <div
                        className="barra__fill"
                        style={{ width: `${maxUnidades ? (r.unidades / maxUnidades) * 100 : 0}%` }}
                      />
                    </div>
                    <span className="hlp">
                      {totalUnidades ? Math.round((r.unidades / totalUnidades) * 1000) / 10 : 0}%
                    </span>
                  </td>
                  <td className="num muted">{formatNum(r.operaciones)}</td>
                  <td className="num muted">{r.stock === null ? '—' : formatNum(r.stock)}</td>
                  <td className="muted" style={{ fontSize: 12 }}>{formatFecha(r.ultima)}</td>
                </tr>
              ))}
              {ranking.length === 0 && (
                <tr>
                  <td colSpan={8}>
                    <div className="empty">
                      <ShoppingCart size={30} />
                      <p>No hay {palabraPl} registradas en {etiquetaPeriodo(periodo).toLowerCase()}.</p>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid" style={{ gridTemplateColumns: '1fr 2fr', alignItems: 'start' }}>
        {/* Por tipo de producto */}
        <div className="card">
          <div className="card__head"><h3>Por tipo de producto</h3></div>
          <div className="table-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th className="no-sort">Tipo</th>
                  <th className="num">Unidades</th>
                  <th className="num">%</th>
                </tr>
              </thead>
              <tbody>
                {porTipo.map(([t, u]) => (
                  <tr key={t}>
                    <td>{t}</td>
                    <td className="num" style={{ fontWeight: 600 }}>{formatNum(u)}</td>
                    <td className="num muted">
                      {totalUnidades ? Math.round((u / totalUnidades) * 1000) / 10 : 0}%
                    </td>
                  </tr>
                ))}
                {porTipo.length === 0 && (
                  <tr><td colSpan={3}><div className="empty">Sin datos.</div></td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Detalle */}
        <div className="card">
          <div className="card__head">
            <h3>Detalle de {palabraPl}</h3>
            <span className="pill" style={{ marginLeft: 'auto' }}>{movimientos.length}</span>
          </div>
          <div className="table-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th className="no-sort">Fecha</th>
                  <th className="no-sort">Producto</th>
                  <th className="num">Cant.</th>
                  <th className="no-sort">Registró</th>
                  <th className="no-sort">Consumos</th>
                </tr>
              </thead>
              <tbody>
                {movimientos.map((m: Movimiento) => {
                  const open = abierto === m.id;
                  return (
                    <Fragment key={m.id}>
                      <tr
                        style={{ cursor: m.componentes?.length ? 'pointer' : 'default' }}
                        onClick={() => m.componentes?.length && setAbierto(open ? null : m.id)}
                      >
                        <td className="muted" style={{ fontSize: 12 }}>{formatFecha(m.fecha)}</td>
                        <td className="nombre">{m.nombre} <span className="codigo">{m.codigo}</span></td>
                        <td className="num" style={{ fontWeight: 700 }}>{formatNum(m.cantidad)}</td>
                        <td className="muted" style={{ fontSize: 12 }}>{m.usuario ?? '—'}</td>
                        <td className="muted">
                          {m.componentes?.length
                            ? `${m.componentes.length} · ${open ? 'ocultar' : 'ver'}`
                            : '—'}
                        </td>
                      </tr>
                      {open &&
                        m.componentes?.map((c) => (
                          <tr key={m.id + c.categoria + c.codigo} style={{ background: 'var(--crema-2)' }}>
                            <td />
                            <td colSpan={2} style={{ paddingLeft: 24 }}>
                              <span className="codigo">{c.codigo}</span> {c.nombre}
                            </td>
                            <td colSpan={2} className={c.faltante ? 'diff-neg' : 'muted'}>
                              −{formatNum(c.cantidad)} → queda {formatNum(c.resultante)}
                            </td>
                          </tr>
                        ))}
                    </Fragment>
                  );
                })}
                {movimientos.length === 0 && (
                  <tr><td colSpan={5}><div className="empty">Sin movimientos en el período.</div></td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

function Kpi({
  icon, color, bg, valor, label, foot,
}: {
  icon: React.ReactNode; color: string; bg: string; valor: string; label: string; foot?: string;
}) {
  return (
    <div className="kpi">
      <div className="kpi__icon" style={{ background: bg, color }}>{icon}</div>
      <div className="kpi__value">{valor}</div>
      <div className="kpi__label">{label}</div>
      {foot && <div className="kpi__foot">{foot}</div>}
    </div>
  );
}
