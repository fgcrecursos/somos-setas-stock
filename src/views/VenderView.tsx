import {
  AlertTriangle,
  ArrowRight,
  Boxes,
  Check,
  FlaskConical,
  Minus,
  Plus,
  ShoppingCart,
  Tag,
  Trash2,
  Wheat,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { BarcodeScanner } from '../components/BarcodeScanner';
import { useToast } from '../components/Toast';
import {
  CATEGORIA_LABEL,
  buscarItem,
  buscarPorCodigo,
  calcEstado,
  formatFecha,
  formatNum,
} from '../lib/helpers';
import { useStore } from '../lib/store';
import type { Categoria, Producto } from '../lib/types';

const COMP_ICON: Record<Categoria, any> = {
  producto: ShoppingCart,
  insumo: Boxes,
  insumo_interno: FlaskConical,
  etiqueta: Tag,
  materia_prima: Wheat,
};

export function VenderView() {
  const { state, vender, producir } = useStore();
  const toast = useToast();
  const [modo, setModo] = useState<'venta' | 'produccion'>('venta');
  const [sel, setSel] = useState<Producto | null>(null);
  const [cant, setCant] = useState(1);
  const [ultima, setUltima] = useState<any>(null);

  function resolver(code: string) {
    const hit = buscarPorCodigo(state, code);
    if (!hit) {
      toast(`Código "${code}" no encontrado`, true);
      return;
    }
    if (hit.categoria !== 'producto') {
      toast(`${code} es ${CATEGORIA_LABEL[hit.categoria]}: ${hit.item.nombre}`);
      return;
    }
    setSel(hit.item as Producto);
    setCant(1);
    toast(`Cargado: ${hit.item.nombre}`);
  }

  const preview = useMemo(() => {
    if (!sel) return [];
    return sel.bom.map((b) => {
      const it = buscarItem(state, b.categoria, b.codigo);
      const consumo = b.cantidad * cant;
      const actual = it?.actual ?? 0;
      const resultante = actual - consumo;
      return {
        ...b,
        nombre: it?.nombre ?? '(no encontrado)',
        actual,
        minimo: it?.minimo ?? 0,
        consumo,
        resultante,
        existe: !!it,
      };
    });
  }, [sel, cant, state]);

  function confirmar() {
    if (!sel) return;
    const fn = modo === 'venta' ? vender : producir;
    const res = fn(sel.codigo, cant);
    if (!res.ok) {
      toast(res.mensaje, true);
      return;
    }
    setUltima({ ...res, modo, cant, nombre: sel.nombre, codigo: sel.codigo });
    if (res.alertas.length) {
      toast(`${res.mensaje}. ${res.alertas.length} alerta(s) de stock`, true);
    } else {
      toast(res.mensaje);
    }
    setSel(null);
    setCant(1);
  }

  const selEstado = sel ? calcEstado(sel.actual, sel.minimo) : null;

  return (
    <div className="grid" style={{ gridTemplateColumns: '380px 1fr', gap: 20, alignItems: 'start' }}>
      {/* Escáner */}
      <div className="stack">
        <div className="card">
          <div className="card__head">
            <ShoppingCart size={18} />
            <h3>Escanear código</h3>
          </div>
          <div className="card__body">
            <BarcodeScanner onDetected={resolver} />
          </div>
        </div>

        {ultima && (
          <div className="card">
            <div className="card__head">
              <Check size={18} color="var(--ok)" />
              <h3>Último movimiento</h3>
            </div>
            <div className="card__body">
              <p style={{ margin: '0 0 10px', fontWeight: 600 }}>
                {ultima.modo === 'venta' ? 'Venta' : 'Producción'}: {ultima.cant} × {ultima.nombre}
              </p>
              {ultima.componentes.map((c: any) => (
                <div key={c.codigo} className="comp-row">
                  <span className="codigo">{c.codigo}</span>
                  <span style={{ flex: 1 }}>{c.nombre}</span>
                  <span className={c.faltante ? 'diff-neg' : 'muted'}>
                    −{formatNum(c.cantidad)} → {formatNum(c.resultante)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Panel de venta */}
      <div className="stack">
        <div className="toolbar" style={{ margin: 0 }}>
          <div className="chips">
            <button className={'chip' + (modo === 'venta' ? ' active' : '')} onClick={() => setModo('venta')}>
              Venta (descuenta)
            </button>
            <button className={'chip' + (modo === 'produccion' ? ' active' : '')} onClick={() => setModo('produccion')}>
              Producción (suma producto)
            </button>
          </div>
          <div className="toolbar__spacer" />
          <select
            className="select"
            style={{ maxWidth: 320 }}
            value={sel?.codigo ?? ''}
            onChange={(e) => {
              const p = state.productos.find((x) => x.codigo === e.target.value) ?? null;
              setSel(p);
              setCant(1);
            }}
          >
            <option value="">Elegí un producto…</option>
            {state.productos.map((p) => (
              <option key={p.codigo} value={p.codigo}>
                {p.codigo} — {p.nombre} ({p.presentacion})
              </option>
            ))}
          </select>
        </div>

        {!sel ? (
          <div className="card">
            <div className="empty">
              <ShoppingCart size={34} />
              <p>Escaneá un producto o elegilo de la lista para registrar {modo === 'venta' ? 'una venta' : 'una producción'}.</p>
            </div>
          </div>
        ) : (
          <div className="card">
            <div className="card__head">
              <div>
                <div className="row" style={{ gap: 8 }}>
                  <span className="codigo" style={{ fontSize: 14 }}>{sel.codigo}</span>
                  <span className="pill">{sel.tipo}</span>
                </div>
                <h3 style={{ marginTop: 4 }}>{sel.nombre}</h3>
              </div>
              <div style={{ marginLeft: 'auto', textAlign: 'right' }}>
                <div className="muted" style={{ fontSize: 12 }}>Stock actual</div>
                <div style={{ fontFamily: 'var(--font-head)', fontSize: 24 }}>
                  {formatNum(sel.actual)} <span className="muted" style={{ fontSize: 13 }}>/ mín {sel.minimo}</span>
                </div>
              </div>
            </div>

            <div className="card__body">
              <div className="row" style={{ justifyContent: 'space-between', marginBottom: 18 }}>
                <div>
                  <div className="section-title" style={{ margin: 0 }}>Cantidad</div>
                  <div className="row" style={{ marginTop: 8 }}>
                    <button className="btn btn--sm" onClick={() => setCant((c) => Math.max(1, c - 1))}>
                      <Minus size={15} />
                    </button>
                    <input
                      className="input"
                      style={{ width: 90, textAlign: 'center', fontFamily: 'var(--font-head)', fontSize: 18 }}
                      type="number"
                      min={1}
                      value={cant}
                      onChange={(e) => setCant(Math.max(1, parseInt(e.target.value) || 1))}
                    />
                    <button className="btn btn--sm" onClick={() => setCant((c) => c + 1)}>
                      <Plus size={15} />
                    </button>
                  </div>
                </div>
                {modo === 'venta' && selEstado && (
                  <div style={{ textAlign: 'right' }}>
                    <div className="muted" style={{ fontSize: 12 }}>Producto luego de la venta</div>
                    <div
                      style={{ fontFamily: 'var(--font-head)', fontSize: 22 }}
                      className={sel.actual - cant < 0 ? 'diff-neg' : sel.actual - cant < sel.minimo ? '' : 'diff-pos'}
                    >
                      {formatNum(sel.actual - cant)}
                    </div>
                  </div>
                )}
              </div>

              <div className="section-title">
                Receta — se {modo === 'venta' ? 'descuenta' : 'consume'} automáticamente
              </div>
              {preview.length === 0 && (
                <p className="hlp">Este producto no tiene receta cargada. Agregá componentes desde Productos.</p>
              )}
              {preview.map((c) => {
                const Icon = COMP_ICON[c.categoria];
                const quedaMal = c.resultante < 0 || c.resultante < c.minimo;
                return (
                  <div key={c.categoria + c.codigo} className="comp-row">
                    <span
                      className="comp-ico"
                      style={{ background: 'var(--crema-3)', color: 'var(--verde-700)' }}
                    >
                      <Icon size={16} />
                    </span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600 }}>{c.nombre}</div>
                      <div className="hlp">
                        {c.codigo} · {CATEGORIA_LABEL[c.categoria]} · {c.cantidad}/u
                      </div>
                    </div>
                    <div style={{ textAlign: 'right', minWidth: 150 }}>
                      <span className="muted">{formatNum(c.actual)}</span>
                      <ArrowRight size={13} style={{ margin: '0 6px', verticalAlign: 'middle' }} className="muted" />
                      <span className={quedaMal ? 'diff-neg' : 'diff-pos'} style={{ fontWeight: 700 }}>
                        {formatNum(c.resultante)}
                      </span>
                      <div className="hlp">−{formatNum(c.consumo)}</div>
                    </div>
                  </div>
                );
              })}

              {preview.some((c) => c.resultante < 0) && (
                <div
                  className="row"
                  style={{
                    marginTop: 12,
                    padding: '10px 12px',
                    background: 'var(--critico-bg)',
                    color: 'var(--critico)',
                    borderRadius: 10,
                    fontSize: 12.5,
                    fontWeight: 600,
                  }}
                >
                  <AlertTriangle size={16} />
                  Algún componente quedaría en negativo. Podés continuar, pero revisá el stock.
                </div>
              )}
            </div>

            <div className="modal__foot" style={{ borderRadius: 0 }}>
              <button className="btn" onClick={() => setSel(null)}>
                <Trash2 size={15} /> Cancelar
              </button>
              <button className="btn btn--primary" onClick={confirmar}>
                <Check size={16} /> Confirmar {modo === 'venta' ? 'venta' : 'producción'} ({cant})
              </button>
            </div>
          </div>
        )}

        {/* Últimos movimientos */}
        <div className="card">
          <div className="card__head">
            <h3>Movimientos recientes</h3>
          </div>
          <div className="table-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th className="no-sort">Fecha</th>
                  <th className="no-sort">Tipo</th>
                  <th className="no-sort">Producto</th>
                  <th className="num">Cant.</th>
                  <th className="no-sort">Componentes</th>
                </tr>
              </thead>
              <tbody>
                {state.movimientos.slice(0, 8).map((m) => (
                  <tr key={m.id}>
                    <td className="muted" style={{ fontSize: 12 }}>{formatFecha(m.fecha)}</td>
                    <td>
                      <span className={'pill'} style={{
                        background: m.tipo === 'venta' ? 'var(--naranja-100)' : 'var(--ok-bg)',
                        color: m.tipo === 'venta' ? 'var(--naranja-600)' : 'var(--ok)',
                        borderColor: 'transparent',
                      }}>{m.tipo}</span>
                    </td>
                    <td className="nombre">{m.nombre} <span className="codigo">{m.codigo}</span></td>
                    <td className="num">{formatNum(m.cantidad)}</td>
                    <td className="muted">{m.componentes?.length ?? 0} descontados</td>
                  </tr>
                ))}
                {state.movimientos.length === 0 && (
                  <tr><td colSpan={5}><div className="empty">Todavía no hay movimientos.</div></td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
