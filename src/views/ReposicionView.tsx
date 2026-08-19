// =====================================================================
// REPOSICIÓN — la lista de tareas del depósito.
//
// Dos preguntas, una pantalla: qué hay que fabricar y qué hay que comprar
// para poder fabricarlo. La diferencia con el Dashboard es el cruce: acá no
// se listan ítems bajos sueltos, se explota la receta de cada producto que
// falta y se suma cuánto pide cada componente. Por eso una etiqueta puede
// aparecer en "Comprar" aunque su stock esté por encima del mínimo: alcanza
// para el día a día, pero no para las 300 unidades que hay que producir.
// =====================================================================
import {
  AlertTriangle,
  Boxes,
  ChevronDown,
  ChevronRight,
  FlaskConical,
  PackageCheck,
  Search,
  ShoppingCart,
  Tag,
  Wheat,
} from 'lucide-react';
import { Fragment, useMemo, useState } from 'react';
import { StatusBadge } from '../components/StatusBadge';
import { COMPONENTE_LABEL, formatNum } from '../lib/helpers';
import { calcularReposicion } from '../lib/reposicion';
import { useStore } from '../lib/store';
import type { CategoriaComponente } from '../lib/types';

const ICONO_CAT: Record<CategoriaComponente, any> = {
  insumo: Boxes,
  etiqueta: Tag,
  materia_prima: Wheat,
  insumo_interno: FlaskConical,
};

const CATS_COMP: CategoriaComponente[] = ['insumo', 'etiqueta', 'materia_prima', 'insumo_interno'];

type Tab = 'producir' | 'comprar';

function coincide(q: string, ...campos: (string | undefined)[]): boolean {
  const partes = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!partes.length) return true;
  const texto = campos.filter(Boolean).join(' ').toLowerCase();
  return partes.every((p) => texto.includes(p));
}

export function ReposicionView() {
  const { state } = useStore();
  const [tab, setTab] = useState<Tab>('producir');
  const [q, setQ] = useState('');
  const [cats, setCats] = useState<CategoriaComponente[]>([]);
  const [abierto, setAbierto] = useState<string | null>(null);

  const rep = useMemo(() => calcularReposicion(state), [state]);

  const producir = useMemo(
    () => rep.producir.filter((p) => coincide(q, p.codigo, p.nombre, p.tipo, p.presentacion)),
    [rep.producir, q]
  );

  const comprar = useMemo(
    () =>
      rep.comprar.filter(
        (c) =>
          (cats.length === 0 || cats.includes(c.categoria)) &&
          coincide(q, c.codigo, c.nombre, COMPONENTE_LABEL[c.categoria])
      ),
    [rep.comprar, q, cats]
  );

  const listos = rep.producir.filter((p) => p.posibles >= p.faltan).length;
  const frenados = rep.producir.length - listos;
  const porCat = useMemo(() => {
    const acc = new Map<CategoriaComponente, number>();
    for (const c of rep.comprar) acc.set(c.categoria, (acc.get(c.categoria) ?? 0) + 1);
    return acc;
  }, [rep.comprar]);

  function toggleCat(c: CategoriaComponente) {
    setCats((prev) => (prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]));
  }

  return (
    <div className="stack">
      {/* KPIs */}
      <div className="grid grid--kpi">
        <div className="kpi">
          <div className="kpi__icon" style={{ background: 'var(--naranja-100)', color: 'var(--naranja)' }}>
            <FlaskConical size={20} />
          </div>
          <div className="kpi__value">{formatNum(rep.producir.length)}</div>
          <div className="kpi__label">Productos a fabricar</div>
          <div className="kpi__foot">Por debajo del stock mínimo</div>
        </div>

        <div className="kpi">
          <div className="kpi__icon" style={{ background: 'var(--ok-bg)', color: 'var(--ok)' }}>
            <PackageCheck size={20} />
          </div>
          <div className="kpi__value" style={{ color: 'var(--ok)' }}>{formatNum(listos)}</div>
          <div className="kpi__label">Se pueden fabricar ya</div>
          <div className="kpi__foot">Alcanza la receta completa</div>
        </div>

        <div className="kpi">
          <div className="kpi__icon" style={{ background: 'var(--bajo-bg)', color: 'var(--bajo)' }}>
            <AlertTriangle size={20} />
          </div>
          <div className="kpi__value" style={{ color: frenados ? 'var(--bajo)' : undefined }}>
            {formatNum(frenados)}
          </div>
          <div className="kpi__label">Frenados por faltantes</div>
          <div className="kpi__foot">No alcanza algún componente</div>
        </div>

        <div className="kpi">
          <div className="kpi__icon" style={{ background: 'var(--crema-3)', color: 'var(--verde-700)' }}>
            <ShoppingCart size={20} />
          </div>
          <div className="kpi__value">{formatNum(rep.comprar.length)}</div>
          <div className="kpi__label">Componentes a comprar</div>
          <div className="kpi__foot">Insumos, etiquetas y materia prima</div>
        </div>
      </div>

      {/* Recetas que apuntan a ítems inexistentes: al producir no descuentan nada */}
      {rep.recetasRotas.length > 0 && (
        <div className="card">
          <div className="card__head">
            <AlertTriangle size={18} color="var(--agotado)" />
            <h3>Recetas con componentes que no existen</h3>
          </div>
          <div style={{ padding: '0 18px 16px' }}>
            <p className="hlp" style={{ marginBottom: 10 }}>
              Estas líneas de receta apuntan a un código que no está en el inventario. Al producir
              esos productos, ese componente <strong>no se descuenta</strong>. Hay que corregir la
              receta o dar de alta el ítem.
            </p>
            {rep.recetasRotas.map((r, i) => (
              <div key={i} className="hlp" style={{ color: 'var(--texto-2)' }}>
                <strong>{r.productoNombre}</strong> ({r.producto}) → {COMPONENTE_LABEL[r.categoria]}{' '}
                <code>{r.codigo}</code>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Productos bajo el mínimo y sin receta cargada */}
      {rep.sinReceta.length > 0 && (
        <div className="card">
          <div className="card__head">
            <AlertTriangle size={18} color="var(--bajo)" />
            <h3>Productos a fabricar sin receta cargada</h3>
          </div>
          <div style={{ padding: '0 18px 16px' }}>
            <p className="hlp" style={{ marginBottom: 10 }}>
              Producir estos productos suma stock pero no descuenta ni etiquetas ni insumos, porque
              todavía no tienen receta.
            </p>
            <div className="hlp" style={{ color: 'var(--texto-2)' }}>
              {rep.sinReceta.map((p) => `${p.nombre} (${p.codigo})`).join(' · ')}
            </div>
          </div>
        </div>
      )}

      {/* Selector de lista + buscador */}
      <div className="toolbar">
        <div className="chips">
          <button
            className={'chip' + (tab === 'producir' ? ' active' : '')}
            onClick={() => setTab('producir')}
          >
            A producir ({formatNum(rep.producir.length)})
          </button>
          <button
            className={'chip' + (tab === 'comprar' ? ' active' : '')}
            onClick={() => setTab('comprar')}
          >
            A comprar ({formatNum(rep.comprar.length)})
          </button>
        </div>

        {tab === 'comprar' && (
          <div className="chips" style={{ marginLeft: 8 }}>
            {CATS_COMP.map((c) => {
              const n = porCat.get(c) ?? 0;
              const Icono = ICONO_CAT[c];
              return (
                <button
                  key={c}
                  className={'chip' + (cats.includes(c) ? ' active' : '')}
                  onClick={() => toggleCat(c)}
                  disabled={n === 0}
                  style={n === 0 ? { opacity: 0.45 } : undefined}
                >
                  <Icono size={13} style={{ verticalAlign: 'middle', marginRight: 5 }} />
                  {COMPONENTE_LABEL[c]} ({formatNum(n)})
                </button>
              );
            })}
            {cats.length > 0 && (
              <button className="chip" onClick={() => setCats([])}>
                Ver todo
              </button>
            )}
          </div>
        )}

        <div className="toolbar__spacer" />
        <div className="searchbox">
          <Search size={16} />
          <input
            className="input"
            placeholder={tab === 'producir' ? 'Buscar producto o código…' : 'Buscar componente…'}
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
      </div>

      {/* ---------- A PRODUCIR ---------- */}
      {tab === 'producir' && (
        <div className="card">
          <div className="card__head">
            <FlaskConical size={18} />
            <h3>Necesitan producción</h3>
            <span className="muted" style={{ marginLeft: 12, fontSize: 12.5 }}>
              Tocá una fila para ver la receta y qué la frena
            </span>
          </div>
          <div className="table-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th className="no-sort" style={{ width: 28 }} />
                  <th className="no-sort">Producto</th>
                  <th className="no-sort">Estado</th>
                  <th className="num">Stock</th>
                  <th className="num">Mínimo</th>
                  <th className="num">A producir</th>
                  <th className="num">Alcanza para</th>
                  <th className="no-sort">Lo que frena</th>
                </tr>
              </thead>
              <tbody>
                {producir.map((p) => {
                  const open = abierto === p.codigo;
                  const alcanza = p.posibles >= p.faltan;
                  return (
                    <Fragment key={p.codigo}>
                      <tr
                        style={{ cursor: 'pointer' }}
                        onClick={() => setAbierto(open ? null : p.codigo)}
                      >
                        <td className="muted">
                          {open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                        </td>
                        <td className="nombre">
                          {p.nombre} <span className="codigo">{p.codigo}</span>
                          {p.presentacion && <div className="hlp">{p.presentacion}</div>}
                        </td>
                        <td><StatusBadge actual={p.actual} minimo={p.minimo} /></td>
                        <td className="num">{formatNum(p.actual)}</td>
                        <td className="num muted">{formatNum(p.minimo)}</td>
                        <td className="num" style={{ fontWeight: 700 }}>{formatNum(p.faltan)}</td>
                        <td className={'num ' + (alcanza ? 'diff-pos' : 'diff-neg')} style={{ fontWeight: 600 }}>
                          {p.sinReceta ? '—' : formatNum(p.posibles)}
                        </td>
                        <td>
                          {p.sinReceta ? (
                            <span className="muted">Sin receta</span>
                          ) : alcanza ? (
                            <span className="diff-pos">Alcanza todo</span>
                          ) : (
                            <span className="diff-neg">
                              {p.cuelloBotella?.nombre}
                              <div className="hlp">
                                {COMPONENTE_LABEL[p.cuelloBotella!.categoria]} ·{' '}
                                {formatNum(p.cuelloBotella!.actual)} en stock
                              </div>
                            </span>
                          )}
                        </td>
                      </tr>

                      {open && (
                        <tr className="row-detalle">
                          <td colSpan={8}>
                            {p.sinReceta ? (
                              <p className="hlp" style={{ margin: '6px 0' }}>
                                Este producto no tiene receta cargada: al producirlo no se descuenta
                                ningún insumo ni etiqueta.
                              </p>
                            ) : (
                              <table className="tbl tbl--anidada">
                                <thead>
                                  <tr>
                                    <th className="no-sort">Componente</th>
                                    <th className="no-sort">Categoría</th>
                                    <th className="num">Por unidad</th>
                                    <th className="num">Necesita</th>
                                    <th className="num">En stock</th>
                                    <th className="num">Alcanza para</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {p.componentes.map((c) => {
                                    const falta = c.necesita > c.actual;
                                    return (
                                      <tr key={`${c.categoria}-${c.codigo}`}>
                                        <td className="nombre">
                                          {c.nombre} <span className="codigo">{c.codigo}</span>
                                          {c.huerfano && (
                                            <div className="hlp diff-neg">No existe en el inventario</div>
                                          )}
                                        </td>
                                        <td><span className="pill">{COMPONENTE_LABEL[c.categoria]}</span></td>
                                        <td className="num muted">{formatNum(c.porUnidad)}</td>
                                        <td className="num" style={{ fontWeight: 600 }}>{formatNum(c.necesita)}</td>
                                        <td className={'num ' + (falta ? 'diff-neg' : '')}>
                                          {formatNum(c.actual)}
                                        </td>
                                        <td className="num muted">
                                          {Number.isFinite(c.alcanzaPara) ? formatNum(c.alcanzaPara) : '∞'}
                                        </td>
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                            )}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}

                {producir.length === 0 && (
                  <tr>
                    <td colSpan={8}>
                      <div className="empty">
                        <PackageCheck size={30} />
                        <p>
                          {q.trim()
                            ? `Ningún producto coincide con “${q.trim()}”.`
                            : 'Todos los productos están en o por encima del mínimo.'}
                        </p>
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ---------- A COMPRAR ---------- */}
      {tab === 'comprar' && (
        <div className="card">
          <div className="card__head">
            <ShoppingCart size={18} />
            <h3>Faltan comprar</h3>
            <span className="muted" style={{ marginLeft: 12, fontSize: 12.5 }}>
              Lo que falta para el mínimo o para cubrir la producción pendiente
            </span>
          </div>
          <div className="table-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th className="no-sort">Componente</th>
                  <th className="no-sort">Categoría</th>
                  <th className="no-sort">Estado</th>
                  <th className="num">Stock</th>
                  <th className="num">Mínimo</th>
                  <th className="num">Pide la producción</th>
                  <th className="num">Comprar</th>
                  <th className="no-sort">Para producir</th>
                </tr>
              </thead>
              <tbody>
                {comprar.map((c) => {
                  const Icono = ICONO_CAT[c.categoria];
                  return (
                    <tr key={`${c.categoria}-${c.codigo}`}>
                      <td className="nombre">
                        {c.nombre} <span className="codigo">{c.codigo}</span>
                        {c.huerfano && <div className="hlp diff-neg">No existe en el inventario</div>}
                      </td>
                      <td>
                        <span className="pill">
                          <Icono size={12} style={{ verticalAlign: 'middle', marginRight: 4 }} />
                          {COMPONENTE_LABEL[c.categoria]}
                        </span>
                      </td>
                      <td><StatusBadge actual={c.actual} minimo={c.minimo} /></td>
                      <td className="num">{formatNum(c.actual)}</td>
                      <td className="num muted">{formatNum(c.minimo)}</td>
                      <td className={'num ' + (c.faltaProduccion > 0 ? 'diff-neg' : 'muted')}>
                        {c.necesita > 0 ? formatNum(c.necesita) : '—'}
                      </td>
                      <td className="num" style={{ fontWeight: 700, color: 'var(--naranja-600)' }}>
                        {formatNum(c.comprar)}
                      </td>
                      <td className="muted" style={{ fontSize: 12 }}>
                        {c.usadoEn.length
                          ? c.usadoEn.slice(0, 3).map((u) => u.nombre).join(', ') +
                            (c.usadoEn.length > 3 ? ` +${c.usadoEn.length - 3}` : '')
                          : '—'}
                      </td>
                    </tr>
                  );
                })}

                {comprar.length === 0 && (
                  <tr>
                    <td colSpan={8}>
                      <div className="empty">
                        <PackageCheck size={30} />
                        <p>
                          {q.trim() || cats.length
                            ? 'Nada coincide con el filtro.'
                            : 'No falta comprar nada: alcanza para el mínimo y para la producción pendiente.'}
                        </p>
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
