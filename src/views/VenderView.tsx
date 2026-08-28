// =====================================================================
// VENDER / PRODUCIR / CONSUMO INTERNO
//
// Tres cosas distintas que mueven el mismo stock:
//   · Vender          → sale el producto terminado (la receta ya se gastó al producirlo)
//   · Producir        → entra el producto terminado y se consume la receta
//   · Consumo interno → sale algo (producto, insumo, bolsa, materia prima) que
//                       usamos nosotros: no es venta, no factura, pero el stock
//                       baja igual y tiene que quedar registrado.
// =====================================================================
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
  Users,
  Wheat,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { BarcodeScanner } from '../components/BarcodeScanner';
import { useToast } from '../components/Toast';
import {
  CATEGORIA_LABEL,
  CATEGORIA_LABEL_PLURAL,
  MOVIMIENTO_COLOR,
  MOVIMIENTO_LABEL,
  buscarItem,
  buscarPorCodigo,
  calcEstado,
  formatFecha,
  formatNum,
  listaDe,
} from '../lib/helpers';
import { useStore } from '../lib/store';
import type { BaseItem, Categoria, Producto } from '../lib/types';

const COMP_ICON: Record<Categoria, any> = {
  producto: ShoppingCart,
  insumo: Boxes,
  insumo_interno: FlaskConical,
  etiqueta: Tag,
  materia_prima: Wheat,
};

const CATEGORIAS: Categoria[] = [
  'producto',
  'insumo',
  'insumo_interno',
  'etiqueta',
  'materia_prima',
];

type Modo = 'venta' | 'produccion' | 'consumo_interno';

interface Seleccion {
  categoria: Categoria;
  item: BaseItem;
}

export function VenderView() {
  const { state, vender, producir, consumoInterno, guardando } = useStore();
  const toast = useToast();
  const [modo, setModo] = useState<Modo>('venta');
  const [sel, setSel] = useState<Seleccion | null>(null);
  const [cant, setCant] = useState(1);
  const [nota, setNota] = useState('');
  const [ultima, setUltima] = useState<any>(null);

  const esConsumo = modo === 'consumo_interno';
  const producto = sel?.categoria === 'producto' ? (sel.item as Producto) : null;

  function resolver(code: string) {
    const hit = buscarPorCodigo(state, code);
    if (!hit) {
      toast(`Código "${code}" no encontrado`, true);
      return;
    }
    // Vender y producir sólo aplican a productos terminados; el consumo interno
    // puede salir de cualquier categoría (bolsas, etiquetas, materia prima…).
    if (!esConsumo && hit.categoria !== 'producto') {
      toast(`${code} es ${CATEGORIA_LABEL[hit.categoria]}: ${hit.item.nombre}`);
      return;
    }
    setSel({ categoria: hit.categoria, item: hit.item });
    setCant(1);
    toast(`Cargado: ${hit.item.nombre}`);
  }

  function cambiarModo(nuevo: Modo) {
    setModo(nuevo);
    // Si se estaba por consumir una etiqueta y se pasa a vender, la selección
    // deja de tener sentido: se limpia en vez de arrastrar algo inválido.
    if (nuevo !== 'consumo_interno' && sel && sel.categoria !== 'producto') setSel(null);
  }

  const preview = useMemo(() => {
    if (!producto) return [];
    return producto.bom.map((b) => {
      const it = buscarItem(state, b.categoria, b.codigo);
      const consumo = b.cantidad * cant;
      const actual = it?.actual ?? 0;
      return {
        ...b,
        nombre: it?.nombre ?? '(no encontrado)',
        actual,
        minimo: it?.minimo ?? 0,
        consumo,
        resultante: actual - consumo,
        existe: !!it,
      };
    });
  }, [producto, cant, state]);

  async function confirmar() {
    if (!sel) return;
    if (esConsumo) {
      const res = await consumoInterno(sel.categoria, sel.item.codigo, cant, nota);
      if (!res.ok) {
        toast(res.error ?? 'No se pudo registrar', true);
        return;
      }
      setUltima({
        modo,
        cant,
        nombre: sel.item.nombre,
        codigo: sel.item.codigo,
        componentes: [],
      });
      toast(`Consumo interno registrado: ${cant} × ${sel.item.nombre}`);
    } else {
      // Producción con receta vacía o con componentes que no están en el
      // inventario: no se bloquea, pero se pide confirmar de nuevo.
      if (modo === 'produccion') {
        const faltan = preview.filter((c) => !c.existe).map((c) => c.codigo);
        if (preview.length === 0) {
          if (
            !window.confirm(
              `${sel.item.nombre} no tiene receta cargada. Se va a registrar la producción ` +
                `pero no se va a descontar ningún insumo. ¿Confirmás igual?`
            )
          )
            return;
        } else if (faltan.length) {
          if (
            !window.confirm(
              `Estos componentes de la receta no están en el inventario y no se van a ` +
                `descontar: ${faltan.join(', ')}. La producción se registra igual. ¿Confirmás?`
            )
          )
            return;
        }
      }
      const fn = modo === 'venta' ? vender : producir;
      const res = await fn(sel.item.codigo, cant);
      if (!res.ok) {
        toast(res.mensaje, true);
        return;
      }
      setUltima({ ...res, modo, cant, nombre: sel.item.nombre, codigo: sel.item.codigo });
      if (res.alertas.length) {
        toast(`${res.mensaje}. ${res.alertas.length} alerta(s) de stock`, true);
      } else {
        toast(res.mensaje);
      }
    }
    setSel(null);
    setCant(1);
    setNota('');
  }

  const selEstado = sel ? calcEstado(sel.item.actual, sel.item.minimo) : null;
  const restante = sel ? sel.item.actual - cant : 0;

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
                {MOVIMIENTO_LABEL[ultima.modo as Modo]}: {ultima.cant} × {ultima.nombre}
              </p>
              {ultima.producto && (
                <div className="comp-row" style={{ fontWeight: 600 }}>
                  <span className="codigo">{ultima.codigo}</span>
                  <span style={{ flex: 1 }}>Stock del producto</span>
                  <span className="muted">quedó {formatNum(ultima.producto.actual)}</span>
                </div>
              )}
              {ultima.componentes.map((c: any) => (
                <div key={c.codigo} className="comp-row">
                  <span className="codigo">{c.codigo}</span>
                  <span style={{ flex: 1 }}>{c.nombre}</span>
                  <span className={c.faltante ? 'diff-neg' : 'muted'}>
                    {c.inexistente
                      ? 'no está en el inventario'
                      : `−${formatNum(c.cantidad)} → ${formatNum(c.resultante)}`}
                  </span>
                </div>
              ))}
              {ultima.alertas?.length > 0 && (
                <div
                  style={{
                    marginTop: 10,
                    padding: '9px 11px',
                    background: 'var(--critico-bg)',
                    color: 'var(--critico)',
                    borderRadius: 10,
                    fontSize: 12,
                    fontWeight: 600,
                  }}
                >
                  {ultima.alertas.map((a: string, i: number) => (
                    <div key={i} className="row" style={{ gap: 6, alignItems: 'flex-start' }}>
                      <AlertTriangle size={13} style={{ marginTop: 2, flexShrink: 0 }} />
                      <span>{a}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Panel de carga */}
      <div className="stack">
        <div className="toolbar" style={{ margin: 0 }}>
          <div className="chips">
            <button
              className={'chip' + (modo === 'venta' ? ' active' : '')}
              onClick={() => cambiarModo('venta')}
            >
              Venta (descuenta)
            </button>
            <button
              className={'chip' + (modo === 'produccion' ? ' active' : '')}
              onClick={() => cambiarModo('produccion')}
            >
              Producción (suma producto)
            </button>
            <button
              className={'chip' + (esConsumo ? ' active' : '')}
              onClick={() => cambiarModo('consumo_interno')}
            >
              Consumo interno (sin venta)
            </button>
          </div>
          <div className="toolbar__spacer" />
          <select
            className="select"
            style={{ maxWidth: 360 }}
            value={sel ? `${sel.categoria}|${sel.item.codigo}` : ''}
            onChange={(e) => {
              const [cat, cod] = e.target.value.split('|');
              const item = cat ? buscarItem(state, cat as Categoria, cod) : undefined;
              setSel(item ? { categoria: cat as Categoria, item } : null);
              setCant(1);
            }}
          >
            <option value="">{esConsumo ? 'Elegí un ítem…' : 'Elegí un producto…'}</option>
            {esConsumo ? (
              CATEGORIAS.map((cat) => (
                <optgroup key={cat} label={CATEGORIA_LABEL_PLURAL[cat]}>
                  {listaDe(state, cat).map((it) => (
                    <option key={cat + it.codigo} value={`${cat}|${it.codigo}`}>
                      {it.codigo} — {it.nombre}
                    </option>
                  ))}
                </optgroup>
              ))
            ) : (
              state.productos.map((p) => (
                <option key={p.codigo} value={`producto|${p.codigo}`}>
                  {p.codigo} — {p.nombre} ({p.presentacion})
                </option>
              ))
            )}
          </select>
        </div>

        {!sel ? (
          <div className="card">
            <div className="empty">
              <ShoppingCart size={34} />
              <p>
                {esConsumo
                  ? 'Escaneá o elegí lo que se usó puertas adentro: productos, insumos, bolsas, etiquetas o materia prima.'
                  : `Escaneá un producto o elegilo de la lista para registrar ${
                      modo === 'venta' ? 'una venta' : 'una producción'
                    }.`}
              </p>
            </div>
          </div>
        ) : (
          <div className="card">
            <div className="card__head">
              <div>
                <div className="row" style={{ gap: 8 }}>
                  <span className="codigo" style={{ fontSize: 14 }}>{sel.item.codigo}</span>
                  <span className="pill">
                    {producto ? producto.tipo : CATEGORIA_LABEL[sel.categoria]}
                  </span>
                </div>
                <h3 style={{ marginTop: 4 }}>{sel.item.nombre}</h3>
              </div>
              <div style={{ marginLeft: 'auto', textAlign: 'right' }}>
                <div className="muted" style={{ fontSize: 12 }}>Stock actual</div>
                <div style={{ fontFamily: 'var(--font-head)', fontSize: 24 }}>
                  {formatNum(sel.item.actual)}{' '}
                  <span className="muted" style={{ fontSize: 13 }}>/ mín {sel.item.minimo}</span>
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
                {(modo === 'venta' || esConsumo) && selEstado && (
                  <div style={{ textAlign: 'right' }}>
                    <div className="muted" style={{ fontSize: 12 }}>
                      Queda después {esConsumo ? 'del consumo' : 'de la venta'}
                    </div>
                    <div
                      style={{ fontFamily: 'var(--font-head)', fontSize: 22 }}
                      className={
                        restante < 0 ? 'diff-neg' : restante < sel.item.minimo ? '' : 'diff-pos'
                      }
                    >
                      {formatNum(restante)}
                    </div>
                  </div>
                )}
              </div>

              {esConsumo && (
                <div className="field" style={{ marginBottom: 4 }}>
                  <label>¿Para qué se usó? (opcional)</label>
                  <input
                    className="input"
                    placeholder="Ej. muestras para la feria, prueba de producción, uso del equipo…"
                    value={nota}
                    onChange={(e) => setNota(e.target.value)}
                  />
                  <p className="hlp" style={{ marginTop: 4 }}>
                    Queda como consumo interno: descuenta el stock pero no cuenta como venta ni
                    suma a la facturación.
                  </p>
                </div>
              )}

              {modo === 'produccion' ? (
                <>
                  <div className="section-title">Receta — se consume automáticamente</div>
                  {preview.length === 0 && (
                    <div
                      className="row"
                      style={{
                        marginBottom: 12,
                        padding: '10px 12px',
                        background: 'var(--critico-bg)',
                        color: 'var(--critico)',
                        borderRadius: 10,
                        fontSize: 12.5,
                        fontWeight: 600,
                      }}
                    >
                      <AlertTriangle size={16} />
                      Este producto no tiene receta cargada: la producción no va a descontar
                      ningún insumo. Cargá la receta desde Productos.
                    </div>
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
                          {c.existe ? (
                            <>
                              <span className="muted">{formatNum(c.actual)}</span>
                              <ArrowRight size={13} style={{ margin: '0 6px', verticalAlign: 'middle' }} className="muted" />
                              <span className={quedaMal ? 'diff-neg' : 'diff-pos'} style={{ fontWeight: 700 }}>
                                {formatNum(c.resultante)}
                              </span>
                              <div className="hlp">−{formatNum(c.consumo)}</div>
                            </>
                          ) : (
                            <span className="diff-neg" style={{ fontWeight: 700, fontSize: 12.5 }}>
                              no está en el inventario
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}

                  {preview.some((c) => !c.existe) && (
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
                      {preview.filter((c) => !c.existe).map((c) => c.codigo).join(', ')} no
                      {preview.filter((c) => !c.existe).length === 1 ? ' está' : ' están'} en el
                      inventario: eso no se va a descontar. Corregí la receta en Productos.
                    </div>
                  )}

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
                </>
              ) : modo === 'venta' ? (
                <p className="hlp">
                  La venta sólo descuenta el producto terminado: la receta ya se consumió cuando se produjo.
                </p>
              ) : null}
            </div>

            <div className="modal__foot" style={{ borderRadius: 0 }}>
              <button className="btn" onClick={() => setSel(null)}>
                <Trash2 size={15} /> Cancelar
              </button>
              <button className="btn btn--primary" onClick={confirmar} disabled={guardando}>
                {esConsumo ? <Users size={16} /> : <Check size={16} />}{' '}
                {guardando
                  ? 'Registrando…'
                  : `Confirmar ${
                      modo === 'venta'
                        ? 'venta'
                        : modo === 'produccion'
                          ? 'producción'
                          : 'consumo interno'
                    } (${cant})`}
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
                  <th className="no-sort">Ítem</th>
                  <th className="num">Cant.</th>
                  <th className="no-sort">Componentes</th>
                </tr>
              </thead>
              <tbody>
                {state.movimientos.slice(0, 8).map((m) => {
                  const st = MOVIMIENTO_COLOR[m.tipo] ?? MOVIMIENTO_COLOR.ajuste;
                  return (
                    <tr key={m.id}>
                      <td className="muted" style={{ fontSize: 12 }}>{formatFecha(m.fecha)}</td>
                      <td>
                        <span
                          className="pill"
                          style={{ background: st.bg, color: st.c, borderColor: 'transparent' }}
                        >
                          {MOVIMIENTO_LABEL[m.tipo] ?? m.tipo}
                        </span>
                      </td>
                      <td className="nombre">{m.nombre} <span className="codigo">{m.codigo}</span></td>
                      <td className="num">{formatNum(m.cantidad)}</td>
                      <td className="muted">{m.componentes?.length ?? 0} descontados</td>
                    </tr>
                  );
                })}
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
