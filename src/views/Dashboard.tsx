import {
  AlertTriangle,
  Boxes,
  CalendarClock,
  FlaskConical,
  PackageX,
  ShoppingBag,
  Tag,
  Wheat,
  TrendingDown,
  ArrowRight,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { DiffCell, StatusBadge, StockBar, VencimientoCell } from '../components/StatusBadge';
import {
  CATEGORIA_LABEL_PLURAL,
  OPCIONES_AVISO,
  alertasVencimiento,
  calcEstado,
  diasAvisoGuardado,
  formatNum,
  guardarDiasAviso,
  listaDe,
} from '../lib/helpers';
import type { Categoria } from '../lib/types';
import { useStore } from '../lib/store';

const CATS: { cat: Categoria; icon: any; color: string }[] = [
  { cat: 'producto', icon: ShoppingBag, color: 'var(--verde-700)' },
  { cat: 'insumo', icon: Boxes, color: '#7a6a3f' },
  { cat: 'etiqueta', icon: Tag, color: '#3f6a7a' },
  { cat: 'materia_prima', icon: Wheat, color: '#8a5a2b' },
  { cat: 'insumo_interno', icon: FlaskConical, color: '#6a4f7a' },
];

export function Dashboard({ onNav }: { onNav: (v: string) => void }) {
  const { state } = useStore();
  const [diasAviso, setDiasAviso] = useState(diasAvisoGuardado);

  const vencimientos = useMemo(
    () => alertasVencimiento(state, diasAviso),
    [state, diasAviso]
  );
  const vencidos = vencimientos.filter((v) => v.info.estado === 'vencido').length;

  function cambiarAviso(dias: number) {
    setDiasAviso(dias);
    guardarDiasAviso(dias);
  }

  const stats = useMemo(() => {
    const perCat = CATS.map(({ cat, icon, color }) => {
      const list = listaDe(state, cat);
      let bajo = 0;
      let agotado = 0;
      for (const it of list) {
        const e = calcEstado(it.actual, it.minimo);
        if (e.estado === 'agotado') agotado++;
        else if (e.estado === 'bajo' || e.estado === 'critico') bajo++;
      }
      return { cat, icon, color, total: list.length, bajo, agotado };
    });

    // Alertas globales (faltantes) ordenadas por urgencia
    const alertas: {
      categoria: Categoria;
      codigo: string;
      nombre: string;
      actual: number;
      minimo: number;
      faltan: number;
    }[] = [];
    for (const { cat } of CATS) {
      for (const it of listaDe(state, cat)) {
        const e = calcEstado(it.actual, it.minimo);
        if (e.faltan > 0) {
          alertas.push({
            categoria: cat,
            codigo: it.codigo,
            nombre: it.nombre,
            actual: it.actual,
            minimo: it.minimo,
            faltan: e.faltan,
          });
        }
      }
    }
    alertas.sort((a, b) => {
      const aa = a.actual <= 0 ? 1 : 0;
      const bb = b.actual <= 0 ? 1 : 0;
      if (aa !== bb) return bb - aa;
      return b.faltan - a.faltan;
    });

    const totalItems = perCat.reduce((s, c) => s + c.total, 0);
    const totalAlertas = alertas.length;
    const totalAgotados = perCat.reduce((s, c) => s + c.agotado, 0);

    // Producción sugerida: productos por debajo del mínimo
    const porProducir = state.productos
      .map((p) => ({ p, e: calcEstado(p.actual, p.minimo) }))
      .filter((x) => x.e.faltan > 0)
      .sort((a, b) => b.e.faltan - a.e.faltan);

    return { perCat, alertas, totalItems, totalAlertas, totalAgotados, porProducir };
  }, [state]);

  return (
    <div className="stack">
      {/* KPIs */}
      <div className="grid grid--kpi">
        <div className="kpi">
          <div className="kpi__icon" style={{ background: 'var(--crema-3)', color: 'var(--verde-700)' }}>
            <Boxes size={20} />
          </div>
          <div className="kpi__value">{formatNum(stats.totalItems)}</div>
          <div className="kpi__label">Ítems en el sistema</div>
          <div className="kpi__foot">{state.productos.length} productos · {state.materiaPrima.length} materias primas</div>
        </div>

        <div className="kpi">
          <div className="kpi__icon" style={{ background: 'var(--bajo-bg)', color: 'var(--bajo)' }}>
            <TrendingDown size={20} />
          </div>
          <div className="kpi__value" style={{ color: 'var(--bajo)' }}>{stats.totalAlertas}</div>
          <div className="kpi__label">Bajo el mínimo</div>
          <div className="kpi__foot">Requieren pedido o producción</div>
        </div>

        <div className="kpi">
          <div className="kpi__icon" style={{ background: 'var(--agotado-bg)', color: 'var(--agotado)' }}>
            <PackageX size={20} />
          </div>
          <div className="kpi__value" style={{ color: 'var(--agotado)' }}>{stats.totalAgotados}</div>
          <div className="kpi__label">Agotados</div>
          <div className="kpi__foot">Sin stock disponible</div>
        </div>

        <div className="kpi">
          <div className="kpi__icon" style={{ background: 'var(--naranja-100)', color: 'var(--naranja)' }}>
            <FlaskConical size={20} />
          </div>
          <div className="kpi__value">{stats.porProducir.length}</div>
          <div className="kpi__label">Productos a fabricar</div>
          <div className="kpi__foot">Por debajo del stock mínimo</div>
        </div>

        <div className="kpi">
          <div className="kpi__icon" style={{ background: 'var(--critico-bg)', color: 'var(--critico)' }}>
            <CalendarClock size={20} />
          </div>
          <div
            className="kpi__value"
            style={{ color: vencimientos.length ? 'var(--critico)' : undefined }}
          >
            {vencimientos.length}
          </div>
          <div className="kpi__label">Por vencer</div>
          <div className="kpi__foot">
            {vencidos > 0 ? `${vencidos} ya vencido(s)` : `Dentro de ${diasAviso} días`}
          </div>
        </div>
      </div>

      {/* Resumen por categoría */}
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(200px,1fr))' }}>
        {stats.perCat.map((c) => {
          const Icon = c.icon;
          return (
            <button
              key={c.cat}
              className="kpi"
              style={{ textAlign: 'left', cursor: 'pointer' }}
              onClick={() => onNav(c.cat)}
            >
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <div className="kpi__icon" style={{ background: 'var(--crema-3)', color: c.color, marginBottom: 8 }}>
                  <Icon size={18} />
                </div>
                <ArrowRight size={16} className="muted" />
              </div>
              <div style={{ fontFamily: 'var(--font-head)', fontSize: 26 }}>{c.total}</div>
              <div className="kpi__label">{CATEGORIA_LABEL_PLURAL[c.cat]}</div>
              <div className="row" style={{ gap: 6, marginTop: 10 }}>
                {c.bajo > 0 && <span className="badge-estado st-bajo">{c.bajo} bajo</span>}
                {c.agotado > 0 && <span className="badge-estado st-agotado">{c.agotado} agotado</span>}
                {c.bajo === 0 && c.agotado === 0 && <span className="badge-estado st-ok">Todo OK</span>}
              </div>
            </button>
          );
        })}
      </div>

      {/* Vencimientos */}
      <div className="card">
        <div className="card__head">
          <CalendarClock size={18} color="var(--critico)" />
          <h3>Alertas de vencimiento</h3>
          <div className="row" style={{ marginLeft: 'auto', gap: 8 }}>
            <span className="muted" style={{ fontSize: 12 }}>Avisar con</span>
            <select
              className="input"
              style={{ width: 'auto', padding: '5px 8px', fontSize: 12.5 }}
              value={diasAviso}
              onChange={(ev) => cambiarAviso(Number(ev.target.value))}
              title="Cuántos días antes del vencimiento se empieza a avisar"
            >
              {OPCIONES_AVISO.map((d) => (
                <option key={d} value={d}>{d} días</option>
              ))}
            </select>
            <span className="pill">{vencimientos.length} ítems</span>
          </div>
        </div>
        <div className="table-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>Código</th>
                <th>Ítem</th>
                <th className="no-sort">Categoría</th>
                <th>Lote</th>
                <th>Proveedor</th>
                <th className="num">Stock</th>
                <th className="no-sort">Vencimiento</th>
              </tr>
            </thead>
            <tbody>
              {vencimientos.slice(0, 14).map((v) => (
                <tr key={v.categoria + v.codigo}>
                  <td className="codigo">{v.codigo}</td>
                  <td className="nombre">
                    <button
                      className="btn btn--ghost btn--sm"
                      style={{ padding: 0, border: 'none', fontWeight: 600 }}
                      onClick={() => onNav(v.categoria)}
                    >
                      {v.nombre}
                    </button>
                  </td>
                  <td><span className="pill">{CATEGORIA_LABEL_PLURAL[v.categoria]}</span></td>
                  <td>{v.lote || <span className="muted">—</span>}</td>
                  <td>{v.proveedor || <span className="muted">—</span>}</td>
                  <td className="num">{formatNum(v.actual)}</td>
                  <td><VencimientoCell vencimiento={v.vencimiento} diasAviso={diasAviso} /></td>
                </tr>
              ))}
              {vencimientos.length === 0 && (
                <tr>
                  <td colSpan={7}>
                    <div className="empty">
                      Nada vencido ni por vencer en los próximos {diasAviso} días. 🍄
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {vencimientos.length > 14 && (
          <div className="card__body" style={{ paddingTop: 0 }}>
            <p className="hlp" style={{ margin: 0 }}>
              Se muestran los 14 más urgentes de {vencimientos.length}. El resto está en cada
              categoría, con el filtro <strong>Por vencer</strong>.
            </p>
          </div>
        )}
      </div>

      {/* Alertas */}
      <div className="card">
        <div className="card__head">
          <AlertTriangle size={18} color="var(--critico)" />
          <h3>Alertas de reposición</h3>
          <span className="pill" style={{ marginLeft: 'auto' }}>{stats.alertas.length} ítems</span>
        </div>
        <div className="table-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>Código</th>
                <th>Ítem</th>
                <th className="no-sort">Categoría</th>
                <th className="num">Actual</th>
                <th className="num">Mínimo</th>
                <th className="num">Diferencia</th>
                <th className="no-sort">Nivel</th>
                <th className="no-sort">Estado</th>
              </tr>
            </thead>
            <tbody>
              {stats.alertas.slice(0, 14).map((a) => (
                <tr key={a.categoria + a.codigo}>
                  <td className="codigo">{a.codigo}</td>
                  <td className="nombre">{a.nombre}</td>
                  <td><span className="pill">{CATEGORIA_LABEL_PLURAL[a.categoria]}</span></td>
                  <td className="num">{formatNum(a.actual)}</td>
                  <td className="num">{formatNum(a.minimo)}</td>
                  <td className="num"><DiffCell actual={a.actual} minimo={a.minimo} /></td>
                  <td style={{ width: 90 }}><StockBar actual={a.actual} minimo={a.minimo} /></td>
                  <td><StatusBadge actual={a.actual} minimo={a.minimo} /></td>
                </tr>
              ))}
              {stats.alertas.length === 0 && (
                <tr><td colSpan={8}><div className="empty">¡Todo el stock está por encima del mínimo! 🍄</div></td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
