// =====================================================================
// ACTIVIDAD — qué se vendió, qué se produjo y qué se consumió puertas adentro.
//
// Las tres cosas se miran juntas: producir sin vender infla el stock y vender
// sin producir lo vacía, así que tenerlas en la misma tabla es lo que permite
// leer el movimiento real del período.
//
// Las ventas cuentan lo registrado en esta plataforma MÁS los pedidos de la
// tienda que ya se confirmaron (llegan solos, marcados con el cartelito
// "tienda"). Lo que se factura en el panel de la tienda se mira allá.
// =====================================================================
import {
  Download,
  FlaskConical,
  PackageSearch,
  Scale,
  Search,
  ShoppingCart,
  Store,
  TrendingUp,
  Users,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { BarraFiltros, GrupoFiltro } from '../components/BarraFiltros';
import { MovimientoModal } from '../components/MovimientoModal';
import { CalendarioDia } from '../components/CalendarioDia';
import { useToast } from '../components/Toast';
import { descargarInforme, type FilaActividad } from '../lib/backup';
import {
  MOVIMIENTO_COLOR,
  coincideBusqueda,
  MOVIMIENTO_LABEL,
  formatFecha,
  formatNum,
} from '../lib/helpers';
import { useStore } from '../lib/store';
import type { Movimiento, TipoMovimiento } from '../lib/types';

const MESES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];

/** Los tres tipos que cuentan como actividad de producto */
const TIPOS_ACTIVIDAD: TipoMovimiento[] = ['venta', 'produccion', 'consumo_interno'];

const anchoBarra = (valor: number, maximo: number) =>
  Math.min(100, Math.max(0, (valor / maximo) * 100));

type PeriodoId = 'mes-actual' | 'mes-anterior' | 'ult-30' | 'anio' | 'todo' | string;

/** Un período de un solo día, elegido en el mini calendario: AAAA-MM-DD */
const esDia = (periodo: PeriodoId) => /^\d{4}-\d{2}-\d{2}$/.test(periodo);

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
  if (esDia(periodo)) {
    const [aa, mm, dd] = periodo.split('-').map(Number);
    return {
      desde: new Date(aa, mm - 1, dd).getTime(),
      hasta: new Date(aa, mm - 1, dd + 1).getTime() - 1,
    };
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
  if (esDia(periodo)) {
    const [aa, mm, dd] = periodo.split('-').map(Number);
    return `${dd} de ${MESES[mm - 1].toLowerCase()} de ${aa}`;
  }
  return '';
}

export function VentasView() {
  const { state } = useStore();
  const toast = useToast();
  const [periodo, setPeriodo] = useState<PeriodoId>('mes-actual');
  const [detalle, setDetalle] = useState<TipoMovimiento | 'todo'>('todo');
  // Movimiento abierto en el modal de detalle (se guarda el id, no el objeto)
  const [movAbierto, setMovAbierto] = useState<string | null>(null);
  const [q, setQ] = useState('');

  const movimientoAbierto = useMemo(
    () => (movAbierto ? (state.movimientos.find((m) => m.id === movAbierto) ?? null) : null),
    [movAbierto, state.movimientos]
  );

  const mesesConDatos = useMemo(() => {
    const set = new Set<string>();
    for (const m of state.movimientos) {
      if (!TIPOS_ACTIVIDAD.includes(m.tipo)) continue;
      const d = new Date(m.fecha);
      if (isNaN(d.getTime())) continue;
      set.add(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    }
    return Array.from(set).sort().reverse();
  }, [state.movimientos]);

  /** Todos los movimientos de actividad del período, sin separar por tipo */
  const movimientos = useMemo(() => {
    const lim = limites(periodo);
    return state.movimientos.filter((m) => {
      if (!TIPOS_ACTIVIDAD.includes(m.tipo)) return false;
      if (!lim) return true;
      const t = new Date(m.fecha).getTime();
      return t >= lim.desde && t <= lim.hasta;
    });
  }, [state.movimientos, periodo]);

  const ranking = useMemo<FilaActividad[]>(() => {
    const acc = new Map<string, FilaActividad>();
    for (const m of movimientos) {
      const fila =
        acc.get(m.codigo) ??
        ({
          codigo: m.codigo,
          nombre: m.nombre,
          tipo: '—',
          presentacion: '',
          vendidas: 0,
          producidas: 0,
          consumo: 0,
          ventasTienda: 0,
          operaciones: 0,
          ultima: m.fecha,
          stock: null,
        } as FilaActividad);
      if (m.tipo === 'venta') {
        fila.vendidas += m.cantidad;
        if (m.origen === 'tienda') fila.ventasTienda += m.cantidad;
      } else if (m.tipo === 'produccion') fila.producidas += m.cantidad;
      else fila.consumo += m.cantidad;
      fila.operaciones += 1;
      if (m.fecha > fila.ultima) fila.ultima = m.fecha;
      acc.set(m.codigo, fila);
    }
    return Array.from(acc.values())
      .map((fila) => {
        const p = state.productos.find((x) => x.codigo === fila.codigo);
        return {
          ...fila,
          tipo: p?.tipo ?? '—',
          presentacion: p?.presentacion ?? '',
          stock: p?.actual ?? null,
        };
      })
      .sort((a, b) => b.vendidas + b.producidas - (a.vendidas + a.producidas));
  }, [movimientos, state.productos]);

  /**
   * Lo que se ve en la tabla. El buscador filtra SÓLO la tabla: los totales y
   * los gráficos de arriba siguen mostrando el período completo, porque son la
   * foto del negocio y no del término buscado. El número de puesto se calcula
   * antes de filtrar, así "#7" sigue queriendo decir séptimo del período.
   */
  const rankingFiltrado = useMemo(() => {
    const conPuesto = ranking.map((r, i) => ({ ...r, puesto: i + 1 }));
    return conPuesto.filter((r) =>
      coincideBusqueda(q, r.codigo, r.nombre, r.tipo, r.presentacion)
    );
  }, [ranking, q]);

  const total = useMemo(() => {
    const t = { vendidas: 0, producidas: 0, consumo: 0, tienda: 0, ops: 0 };
    for (const r of ranking) {
      t.vendidas += r.vendidas;
      t.producidas += r.producidas;
      t.consumo += r.consumo;
      t.tienda += r.ventasTienda;
      t.ops += r.operaciones;
    }
    return t;
  }, [ranking]);

  const maxBarra = Math.max(1, ...ranking.map((r) => Math.max(r.vendidas, r.producidas)));

  const porTipo = useMemo(() => {
    const acc = new Map<string, { vendidas: number; producidas: number; consumo: number }>();
    for (const r of ranking) {
      const prev = acc.get(r.tipo) ?? { vendidas: 0, producidas: 0, consumo: 0 };
      prev.vendidas += r.vendidas;
      prev.producidas += r.producidas;
      prev.consumo += r.consumo;
      acc.set(r.tipo, prev);
    }
    return Array.from(acc.entries()).sort((a, b) => b[1].vendidas - a[1].vendidas);
  }, [ranking]);

  const masVendido = useMemo(
    () => [...ranking].sort((a, b) => b.vendidas - a.vendidas)[0],
    [ranking]
  );

  const detalleFiltrado = useMemo(
    () => (detalle === 'todo' ? movimientos : movimientos.filter((m) => m.tipo === detalle)),
    [movimientos, detalle]
  );

  async function exportar() {
    const nombre = await descargarInforme(
      ranking,
      movimientos,
      `Actividad · ${etiquetaPeriodo(periodo)}`
    );
    toast(`Informe descargado: ${nombre}`);
  }

  const balance = total.producidas - total.vendidas - total.consumo;

  return (
    <div className="stack">
      {/* Período */}
      <div className="toolbar">
        <BarraFiltros
          activos={periodo === 'mes-actual' ? [] : [etiquetaPeriodo(periodo)]}
          onLimpiar={() => setPeriodo('mes-actual')}
        >
          <GrupoFiltro titulo="Período">
            {(
              [
                ['mes-actual', 'Este mes'],
                ['mes-anterior', 'Mes anterior'],
                ['ult-30', 'Últimos 30 días'],
                ['anio', 'Este año'],
                ['todo', 'Todo'],
              ] as [PeriodoId, string][]
            ).map(([id, label]) => (
              <button
                key={id}
                className={'chip' + (periodo === id ? ' active' : '')}
                onClick={() => setPeriodo(id)}
              >
                {label}
              </button>
            ))}
          </GrupoFiltro>

          <GrupoFiltro titulo="Un día concreto">
            <CalendarioDia
              value={esDia(periodo) ? periodo : null}
              onChange={(dia) => setPeriodo(dia ?? 'mes-actual')}
            />
          </GrupoFiltro>

          {mesesConDatos.length > 0 && (
            <GrupoFiltro titulo="Mes" ayuda="Los últimos meses con movimiento.">
              {mesesConDatos.slice(0, 12).map((ym) => (
                <button
                  key={ym}
                  className={'chip' + (periodo === ym ? ' active' : '')}
                  onClick={() => setPeriodo(ym)}
                >
                  {etiquetaMes(ym)}
                </button>
              ))}
            </GrupoFiltro>
          )}
        </BarraFiltros>
        <span className="pill">{etiquetaPeriodo(periodo)}</span>
        <div className="toolbar__spacer" />
        <button className="btn btn--sm" onClick={exportar} disabled={!movimientos.length}>
          <Download size={14} /> Descargar informe
        </button>
      </div>

      {/* KPIs: las tres puntas de la actividad, más el balance */}
      <div className="grid grid--kpi">
        <Kpi
          icon={<ShoppingCart size={19} />}
          color="var(--naranja)"
          bg="var(--naranja-100)"
          valor={formatNum(total.vendidas)}
          label="Unidades vendidas"
          foot={
            total.tienda
              ? `${formatNum(total.tienda)} de la tienda · ${formatNum(
                  total.vendidas - total.tienda
                )} cargadas acá`
              : etiquetaPeriodo(periodo)
          }
        />
        <Kpi
          icon={<FlaskConical size={19} />}
          color="var(--ok)"
          bg="var(--ok-bg)"
          valor={formatNum(total.producidas)}
          label="Unidades producidas"
          foot={etiquetaPeriodo(periodo)}
        />
        <Kpi
          icon={<Users size={19} />}
          color="#6a4f7a"
          bg="#efe6f5"
          valor={formatNum(total.consumo)}
          label="Consumo interno"
          foot="Salidas sin venta"
        />
        <Kpi
          icon={<Scale size={19} />}
          color={balance < 0 ? 'var(--bajo)' : 'var(--verde-700)'}
          bg={balance < 0 ? 'var(--bajo-bg)' : 'var(--crema-3)'}
          valor={(balance > 0 ? '+' : '') + formatNum(balance)}
          label="Balance del período"
          foot={
            balance < 0
              ? 'Salió más de lo que se produjo'
              : balance > 0
                ? 'Se produjo más de lo que salió'
                : 'Producción y salidas empatadas'
          }
        />
      </div>

      {/* Ranking combinado */}
      <div className="card">
        <div className="card__head">
          <TrendingUp size={18} />
          <h3>Actividad por producto</h3>
          <span className="muted" style={{ marginLeft: 12, fontSize: 12.5 }}>
            {q.trim()
              ? `${formatNum(rankingFiltrado.length)} de ${formatNum(ranking.length)} productos`
              : `${formatNum(ranking.length)} productos con movimiento · ${formatNum(total.ops)} operaciones`}
          </span>
          <div className="searchbox" style={{ marginLeft: 'auto' }}>
            <Search size={16} />
            <input
              className="input"
              placeholder="Buscar producto o código…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          <span className="pill">{etiquetaPeriodo(periodo)}</span>
        </div>
        <div className="table-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th className="no-sort" style={{ width: 40 }}>#</th>
                <th className="no-sort">Producto</th>
                <th className="no-sort">Tipo</th>
                <th className="num">Vendidas</th>
                <th className="num">Producidas</th>
                <th className="num">Consumo</th>
                <th className="no-sort" style={{ width: '18%' }}>Vendido vs. producido</th>
                <th className="num">Balance</th>
                <th className="num">Stock</th>
                <th className="no-sort">Última</th>
              </tr>
            </thead>
            <tbody>
              {rankingFiltrado.map((r) => {
                const bal = r.producidas - r.vendidas - r.consumo;
                return (
                  <tr key={r.codigo}>
                    <td className="muted">{r.puesto}</td>
                    <td className="nombre">
                      {r.nombre} <span className="codigo">{r.codigo}</span>
                      {r.presentacion && <div className="hlp">{r.presentacion}</div>}
                    </td>
                    <td><span className="pill">{r.tipo}</span></td>
                    <td className="num" style={{ fontWeight: 700 }}>
                      {formatNum(r.vendidas)}
                      {r.ventasTienda > 0 && (
                        <div className="hlp" title="Vendidas por la tienda online">
                          {formatNum(r.ventasTienda)} tienda
                        </div>
                      )}
                    </td>
                    <td className="num" style={{ fontWeight: 700 }}>{formatNum(r.producidas)}</td>
                    <td className="num muted">{r.consumo ? formatNum(r.consumo) : '—'}</td>
                    <td>
                      {/* Dos barras: naranja lo que salió vendido, verde lo producido.
                          Se recorta a 0-100%: un producto puede quedar en negativo
                          si se anularon más pedidos de los que se vendieron en el
                          período, y una barra no puede medir menos que nada. */}
                      <div className="barra" title={`Vendidas: ${r.vendidas}`}>
                        <div className="barra__fill" style={{ width: `${anchoBarra(r.vendidas, maxBarra)}%` }} />
                      </div>
                      <div className="barra" style={{ marginTop: 3 }} title={`Producidas: ${r.producidas}`}>
                        <div
                          className="barra__fill"
                          style={{ width: `${anchoBarra(r.producidas, maxBarra)}%`, background: 'var(--ok)' }}
                        />
                      </div>
                    </td>
                    <td
                      className={'num ' + (bal < 0 ? 'diff-neg' : bal > 0 ? 'diff-pos' : 'muted')}
                      style={{ fontWeight: 600 }}
                    >
                      {bal > 0 ? '+' : ''}
                      {formatNum(bal)}
                    </td>
                    <td className="num muted">{r.stock === null ? '—' : formatNum(r.stock)}</td>
                    <td className="muted" style={{ fontSize: 12 }}>{formatFecha(r.ultima)}</td>
                  </tr>
                );
              })}
              {rankingFiltrado.length === 0 && (
                <tr>
                  <td colSpan={10}>
                    <div className="empty">
                      <ShoppingCart size={30} />
                      <p>
                        {q.trim()
                          ? `Ningún producto coincide con “${q.trim()}”.`
                          : `No hay ventas ni producción en ${
                              esDia(periodo) ? 'el ' : ''
                            }${etiquetaPeriodo(periodo).toLowerCase()}.`}
                      </p>
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
                  <th className="num">Vendidas</th>
                  <th className="num">Producidas</th>
                  <th className="num">Consumo</th>
                </tr>
              </thead>
              <tbody>
                {porTipo.map(([t, v]) => (
                  <tr key={t}>
                    <td>{t}</td>
                    <td className="num" style={{ fontWeight: 600 }}>{formatNum(v.vendidas)}</td>
                    <td className="num" style={{ fontWeight: 600 }}>{formatNum(v.producidas)}</td>
                    <td className="num muted">{v.consumo ? formatNum(v.consumo) : '—'}</td>
                  </tr>
                ))}
                {porTipo.length === 0 && (
                  <tr><td colSpan={4}><div className="empty">Sin datos.</div></td></tr>
                )}
              </tbody>
            </table>
          </div>
          {masVendido && masVendido.vendidas > 0 && (
            <div className="card__body" style={{ borderTop: '1px solid var(--linea)' }}>
              <div className="muted" style={{ fontSize: 11.5 }}>Más vendido del período</div>
              <div style={{ fontWeight: 700, marginTop: 2 }}>{masVendido.nombre}</div>
              <div className="hlp">{formatNum(masVendido.vendidas)} unidades</div>
            </div>
          )}
        </div>

        {/* Detalle operación por operación */}
        <div className="card">
          <div className="card__head">
            <h3>Detalle</h3>
            <div className="chips" style={{ marginLeft: 12 }}>
              {(
                [
                  ['todo', 'Todo'],
                  ['venta', 'Ventas'],
                  ['produccion', 'Producción'],
                  ['consumo_interno', 'Consumo interno'],
                ] as [TipoMovimiento | 'todo', string][]
              ).map(([id, label]) => (
                <button
                  key={id}
                  className={'chip' + (detalle === id ? ' active' : '')}
                  onClick={() => setDetalle(id)}
                >
                  {label}
                </button>
              ))}
            </div>
            <span className="pill" style={{ marginLeft: 'auto' }}>{detalleFiltrado.length}</span>
          </div>
          <div className="table-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th className="no-sort">Fecha</th>
                  <th className="no-sort">Tipo</th>
                  <th className="no-sort">Producto</th>
                  <th className="num">Cant.</th>
                  <th className="no-sort">Registró</th>
                  <th className="no-sort">Consumos</th>
                </tr>
              </thead>
              <tbody>
                {detalleFiltrado.slice(0, 120).map((m: Movimiento) => {
                  const st = MOVIMIENTO_COLOR[m.tipo];
                  return (
                    <tr
                      key={m.id}
                      style={{ cursor: 'pointer' }}
                      onClick={() => setMovAbierto(m.id)}
                      title="Ver el detalle del movimiento"
                    >
                      <td className="muted" style={{ fontSize: 12 }}>{formatFecha(m.fecha)}</td>
                      <td>
                        <span
                          className="pill"
                          style={{ background: st.bg, color: st.c, borderColor: 'transparent' }}
                        >
                          {MOVIMIENTO_LABEL[m.tipo]}
                        </span>
                        {m.origen === 'tienda' && (
                          <span className="pill" style={{ marginLeft: 4, gap: 3 }} title={m.referencia}>
                            <Store size={11} /> tienda
                          </span>
                        )}
                      </td>
                      <td className="nombre">{m.nombre} <span className="codigo">{m.codigo}</span></td>
                      <td className="num" style={{ fontWeight: 700 }}>{formatNum(m.cantidad)}</td>
                      <td className="muted" style={{ fontSize: 12 }}>{m.usuario ?? '—'}</td>
                      <td className="muted">
                        {m.componentes?.length
                          ? `${m.componentes.length} · ver`
                          : (m.nota ?? 'ver')}
                      </td>
                    </tr>
                  );
                })}
                {detalleFiltrado.length === 0 && (
                  <tr><td colSpan={6}><div className="empty">Sin movimientos en el período.</div></td></tr>
                )}
              </tbody>
            </table>
          </div>
          {detalleFiltrado.length > 120 && (
            <div className="card__body">
              <p className="hlp" style={{ margin: 0 }}>
                Se muestran los 120 más recientes. El resto está en Movimientos y en el informe
                descargable.
              </p>
            </div>
          )}
        </div>
      </div>

      <p className="hlp" style={{ margin: '0 4px' }}>
        <PackageSearch size={13} style={{ verticalAlign: 'middle' }} /> Las ventas incluyen los
        pedidos de la tienda ya confirmados. La facturación se sigue mirando en el panel de la
        tienda: acá se cuentan unidades, no plata.
      </p>

      {movimientoAbierto && (
        <MovimientoModal
          movimiento={movimientoAbierto}
          onClose={() => setMovAbierto(null)}
          onIr={setMovAbierto}
        />
      )}
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
