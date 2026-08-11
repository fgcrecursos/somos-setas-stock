// =====================================================================
// MOVIMIENTOS — todo lo que entró, salió o cambió, sin excepción.
//
// Acá aparecen las ventas (propias y de la tienda), las producciones, los
// ingresos, los ajustes de conteo, el consumo interno y también las altas,
// ediciones y bajas de ficha. Si algo cambió el inventario, tiene que estar
// en esta lista.
// =====================================================================
import { History, Search, Store, X } from 'lucide-react';
import { Fragment, useMemo, useState } from 'react';
import {
  CATEGORIA_LABEL,
  MOVIMIENTO_COLOR,
  MOVIMIENTO_LABEL,
  deltaMovimiento,
  formatFecha,
  formatNum,
} from '../lib/helpers';
import { useStore } from '../lib/store';
import type { Categoria, TipoMovimiento } from '../lib/types';

const TIPOS: TipoMovimiento[] = [
  'venta',
  'produccion',
  'ingreso',
  'consumo_interno',
  'ajuste',
  'alta',
  'edicion',
  'baja',
];

const CATEGORIAS: Categoria[] = [
  'producto',
  'insumo',
  'insumo_interno',
  'etiqueta',
  'materia_prima',
];

type PeriodoId = 'ult-7' | 'ult-30' | 'mes-actual' | 'anio' | 'todo';

function desdeDe(periodo: PeriodoId): number | null {
  const hoy = new Date();
  switch (periodo) {
    case 'ult-7':
      return Date.now() - 7 * 864e5;
    case 'ult-30':
      return Date.now() - 30 * 864e5;
    case 'mes-actual':
      return new Date(hoy.getFullYear(), hoy.getMonth(), 1).getTime();
    case 'anio':
      return new Date(hoy.getFullYear(), 0, 1).getTime();
    default:
      return null;
  }
}

export function MovimientosView() {
  const { state } = useStore();
  const [abierto, setAbierto] = useState<string | null>(null);
  const [busca, setBusca] = useState('');
  const [tipos, setTipos] = useState<Set<TipoMovimiento>>(new Set());
  const [categoria, setCategoria] = useState<Categoria | ''>('');
  const [periodo, setPeriodo] = useState<PeriodoId>('ult-30');
  const [tope, setTope] = useState(150);

  function toggleTipo(t: TipoMovimiento) {
    setTipos((prev) => {
      const next = new Set(prev);
      if (next.has(t)) next.delete(t);
      else next.add(t);
      return next;
    });
    setTope(150);
  }

  const filtrados = useMemo(() => {
    const desde = desdeDe(periodo);
    const q = busca.trim().toLowerCase();
    return state.movimientos.filter((m) => {
      if (tipos.size && !tipos.has(m.tipo)) return false;
      if (categoria && m.categoria !== categoria) return false;
      if (desde !== null) {
        const t = new Date(m.fecha).getTime();
        if (isNaN(t) || t < desde) return false;
      }
      if (q) {
        const heno = `${m.codigo} ${m.nombre} ${m.nota ?? ''} ${m.usuario ?? ''} ${
          m.referencia ?? ''
        }`.toLowerCase();
        if (!heno.includes(q)) return false;
      }
      return true;
    });
  }, [state.movimientos, tipos, categoria, periodo, busca]);

  // Cuánto entró y cuánto salió en lo que se está viendo
  const resumen = useMemo(() => {
    let entraron = 0;
    let salieron = 0;
    for (const m of filtrados) {
      const d = deltaMovimiento(m);
      if (d > 0) entraron += d;
      else salieron += -d;
    }
    return { entraron, salieron };
  }, [filtrados]);

  const hayFiltro = !!busca || tipos.size > 0 || !!categoria || periodo !== 'todo';

  return (
    <div className="stack">
      {/* Filtros */}
      <div className="toolbar">
        <div className="row" style={{ position: 'relative', flex: '0 1 280px' }}>
          <Search
            size={15}
            className="muted"
            style={{ position: 'absolute', left: 10, pointerEvents: 'none' }}
          />
          <input
            className="input"
            style={{ paddingLeft: 30 }}
            placeholder="Buscar ítem, código, nota, pedido…"
            value={busca}
            onChange={(e) => {
              setBusca(e.target.value);
              setTope(150);
            }}
          />
        </div>
        <select
          className="select"
          style={{ maxWidth: 200 }}
          value={categoria}
          onChange={(e) => setCategoria(e.target.value as Categoria | '')}
        >
          <option value="">Todas las categorías</option>
          {CATEGORIAS.map((c) => (
            <option key={c} value={c}>
              {CATEGORIA_LABEL[c]}
            </option>
          ))}
        </select>
        <div className="toolbar__spacer" />
        <div className="chips">
          {(
            [
              ['ult-7', '7 días'],
              ['ult-30', '30 días'],
              ['mes-actual', 'Este mes'],
              ['anio', 'Este año'],
              ['todo', 'Todo'],
            ] as [PeriodoId, string][]
          ).map(([id, label]) => (
            <button
              key={id}
              className={'chip' + (periodo === id ? ' active' : '')}
              onClick={() => {
                setPeriodo(id);
                setTope(150);
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="toolbar" style={{ marginTop: -6 }}>
        <div className="chips">
          <button
            className={'chip' + (tipos.size === 0 ? ' active' : '')}
            onClick={() => setTipos(new Set())}
          >
            Todos los tipos
          </button>
          {TIPOS.map((t) => (
            <button
              key={t}
              className={'chip' + (tipos.has(t) ? ' active' : '')}
              onClick={() => toggleTipo(t)}
            >
              {MOVIMIENTO_LABEL[t]}
            </button>
          ))}
        </div>
        {hayFiltro && (
          <>
            <div className="toolbar__spacer" />
            <button
              className="btn btn--sm"
              onClick={() => {
                setBusca('');
                setTipos(new Set());
                setCategoria('');
                setPeriodo('todo');
              }}
            >
              <X size={14} /> Limpiar filtros
            </button>
          </>
        )}
      </div>

      <div className="card">
        <div className="card__head">
          <History size={18} />
          <h3>Historial de movimientos</h3>
          <span className="muted" style={{ marginLeft: 12, fontSize: 12.5 }}>
            <span className="diff-pos" style={{ fontWeight: 700 }}>
              +{formatNum(resumen.entraron)}
            </span>{' '}
            entraron ·{' '}
            <span className="diff-neg" style={{ fontWeight: 700 }}>
              −{formatNum(resumen.salieron)}
            </span>{' '}
            salieron
          </span>
          <span className="pill" style={{ marginLeft: 'auto' }}>
            {filtrados.length} de {state.movimientos.length}
          </span>
        </div>
        <div className="table-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th className="no-sort">Fecha</th>
                <th className="no-sort">Tipo</th>
                <th className="no-sort">Categoría</th>
                <th className="no-sort">Ítem</th>
                <th className="num">Cantidad</th>
                <th className="no-sort">Registró</th>
                <th className="no-sort">Detalle</th>
              </tr>
            </thead>
            <tbody>
              {filtrados.slice(0, tope).map((m) => {
                const st = MOVIMIENTO_COLOR[m.tipo] ?? MOVIMIENTO_COLOR.ajuste;
                const open = abierto === m.id;
                const delta = deltaMovimiento(m);
                const tieneDetalle = !!m.componentes?.length;
                return (
                  <Fragment key={m.id}>
                    <tr
                      style={{ cursor: tieneDetalle ? 'pointer' : 'default' }}
                      onClick={() => tieneDetalle && setAbierto(open ? null : m.id)}
                    >
                      <td className="muted" style={{ fontSize: 12 }}>
                        {formatFecha(m.fecha)}
                      </td>
                      <td>
                        <span
                          className="pill"
                          style={{ background: st.bg, color: st.c, borderColor: 'transparent' }}
                        >
                          {MOVIMIENTO_LABEL[m.tipo] ?? m.tipo}
                        </span>
                        {m.origen === 'tienda' && (
                          <span
                            className="pill"
                            title={'Pedido de la tienda ' + (m.referencia ?? '')}
                            style={{ marginLeft: 4, gap: 3 }}
                          >
                            <Store size={11} /> tienda
                          </span>
                        )}
                      </td>
                      <td className="muted" style={{ fontSize: 12 }}>
                        {CATEGORIA_LABEL[m.categoria] ?? m.categoria}
                      </td>
                      <td className="nombre">
                        {m.nombre} <span className="codigo">{m.codigo}</span>
                      </td>
                      <td
                        className={'num ' + (delta < 0 ? 'diff-neg' : delta > 0 ? 'diff-pos' : 'muted')}
                        style={{ fontWeight: 700 }}
                      >
                        {delta > 0 ? '+' : ''}
                        {formatNum(delta)}
                      </td>
                      <td className="muted" style={{ fontSize: 12 }}>
                        {m.usuario ?? '—'}
                      </td>
                      <td className="muted" style={{ fontSize: 12 }}>
                        {tieneDetalle
                          ? `${m.componentes!.length} componentes descontados · ${
                              open ? 'ocultar' : 'ver'
                            }`
                          : (m.nota ?? '—')}
                      </td>
                    </tr>
                    {open &&
                      m.componentes?.map((c) => (
                        <tr key={m.id + c.categoria + c.codigo} style={{ background: 'var(--crema-2)' }}>
                          <td />
                          <td />
                          <td className="muted" style={{ fontSize: 12 }}>
                            {CATEGORIA_LABEL[c.categoria] ?? c.categoria}
                          </td>
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
              {filtrados.length === 0 && (
                <tr>
                  <td colSpan={7}>
                    <div className="empty">
                      <History size={30} />
                      <p>
                        {state.movimientos.length
                          ? 'Ningún movimiento coincide con los filtros.'
                          : 'Sin movimientos registrados aún.'}
                      </p>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {filtrados.length > tope && (
          <div className="card__body" style={{ textAlign: 'center' }}>
            <button className="btn btn--sm" onClick={() => setTope((t) => t + 300)}>
              Ver más ({formatNum(filtrados.length - tope)} restantes)
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
