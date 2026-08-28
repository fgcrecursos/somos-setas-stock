// =====================================================================
// MOVIMIENTOS — todo lo que entró, salió o cambió, sin excepción.
//
// Acá aparecen las ventas (propias y de la tienda), las producciones, los
// ingresos, los ajustes de conteo, el consumo interno y también las altas,
// ediciones y bajas de ficha. Si algo cambió el inventario, tiene que estar
// en esta lista.
// =====================================================================
import { AlertTriangle, History, Store } from 'lucide-react';
import { Fragment, useMemo, useState } from 'react';
import { BarraFiltros, GrupoFiltro } from '../components/BarraFiltros';
import {
  CATEGORIA_LABEL,
  coincideBusqueda,
  MOVIMIENTO_COLOR,
  MOVIMIENTO_LABEL,
  deltaMovimiento,
  formatFecha,
  formatNum,
} from '../lib/helpers';
import { useStore } from '../lib/store';
import type { Categoria, TipoMovimiento } from '../lib/types';

const PERIODO_LABEL: Record<string, string> = {
  'ult-7': 'Últimos 7 días',
  'ult-30': 'Últimos 30 días',
  'mes-actual': 'Este mes',
  anio: 'Este año',
  todo: 'Todo',
};

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
    return state.movimientos.filter((m) => {
      if (tipos.size && !tipos.has(m.tipo)) return false;
      if (categoria && m.categoria !== categoria) return false;
      if (desde !== null) {
        const t = new Date(m.fecha).getTime();
        if (isNaN(t) || t < desde) return false;
      }
      return coincideBusqueda(
        busca,
        m.codigo,
        m.nombre,
        m.nota,
        m.usuario,
        m.referencia,
        m.origen,
        CATEGORIA_LABEL[m.categoria],
        MOVIMIENTO_LABEL[m.tipo]
      );
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

  return (
    <div className="stack">
      {/* Filtros */}
      <div className="toolbar">
        <BarraFiltros
          q={busca}
          setQ={(v) => {
            setBusca(v);
            setTope(150);
          }}
          placeholder="Buscar ítem, código, nota, pedido…"
          activos={[
            ...(periodo !== 'todo' ? [PERIODO_LABEL[periodo]] : []),
            ...(categoria ? [CATEGORIA_LABEL[categoria]] : []),
            ...Array.from(tipos).map((t) => MOVIMIENTO_LABEL[t]),
          ]}
          onLimpiar={() => {
            setTipos(new Set());
            setCategoria('');
            setPeriodo('todo');
            setTope(150);
          }}
        >
          <GrupoFiltro titulo="Período">
            {(['ult-7', 'ult-30', 'mes-actual', 'anio', 'todo'] as PeriodoId[]).map((id) => (
              <button
                key={id}
                className={'chip' + (periodo === id ? ' active' : '')}
                onClick={() => {
                  setPeriodo(id);
                  setTope(150);
                }}
              >
                {PERIODO_LABEL[id]}
              </button>
            ))}
          </GrupoFiltro>

          <GrupoFiltro titulo="Categoría">
            <button className={'chip' + (!categoria ? ' active' : '')} onClick={() => setCategoria('')}>
              Todas
            </button>
            {CATEGORIAS.map((c) => (
              <button
                key={c}
                className={'chip' + (categoria === c ? ' active' : '')}
                onClick={() => setCategoria(c)}
              >
                {CATEGORIA_LABEL[c]}
              </button>
            ))}
          </GrupoFiltro>

          <GrupoFiltro titulo="Tipo de movimiento" ayuda="Se pueden marcar varios a la vez.">
            <button
              className={'chip' + (tipos.size === 0 ? ' active' : '')}
              onClick={() => setTipos(new Set())}
            >
              Todos
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
          </GrupoFiltro>
        </BarraFiltros>
        <div className="toolbar__spacer" />
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
                const hayIncidencia =
                  !!m.incidencia || !!m.componentes?.some((c) => c.inexistente);
                const tieneStock = m.resultante != null;
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
                        {hayIncidencia && (
                          <span
                            className="pill"
                            title={m.incidencia ?? 'Un componente de la receta no se pudo descontar'}
                            style={{
                              marginLeft: 4,
                              gap: 3,
                              background: 'var(--critico-bg)',
                              color: 'var(--critico)',
                              borderColor: 'transparent',
                            }}
                          >
                            <AlertTriangle size={11} /> receta
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
                        {tieneStock && (
                          <div className="muted" style={{ fontSize: 11, fontWeight: 400 }}>
                            {m.anterior != null
                              ? `${formatNum(m.anterior)} → ${formatNum(m.resultante!)}`
                              : `quedó ${formatNum(m.resultante!)}`}
                          </div>
                        )}
                      </td>
                      <td className="muted" style={{ fontSize: 12 }}>
                        {m.usuario ?? '—'}
                      </td>
                      <td className="muted" style={{ fontSize: 12 }}>
                        {m.incidencia ? (
                          <span className="diff-neg" style={{ fontWeight: 600 }}>
                            {m.incidencia}
                          </span>
                        ) : tieneDetalle ? (
                          `${
                            m.origen === 'tienda'
                              ? m.componentes!.length === 1
                                ? '1 ítem'
                                : `${m.componentes!.length} ítems`
                              : `${m.componentes!.length} componentes`
                          } · ${open ? 'ocultar' : 'ver'}`
                        ) : (
                          (m.nota ?? '—')
                        )}
                      </td>
                    </tr>
                    {open &&
                      m.componentes?.map((c) => {
                        // Signo real: si el componente terminó con más stock que
                        // antes (pedido anulado / corregido a la baja) fue una
                        // devolución (+); si no, un descuento (−).
                        const devuelto =
                          c.anterior != null && c.resultante > c.anterior;
                        return (
                          <tr
                            key={m.id + c.categoria + c.codigo}
                            style={{ background: 'var(--crema-2)' }}
                          >
                            <td />
                            <td />
                            <td className="muted" style={{ fontSize: 12 }}>
                              {CATEGORIA_LABEL[c.categoria] ?? c.categoria}
                            </td>
                            <td colSpan={2} style={{ paddingLeft: 24 }}>
                              <span className="codigo">{c.codigo}</span> {c.nombre}
                            </td>
                            <td colSpan={2} className={c.faltante ? 'diff-neg' : 'muted'}>
                              {c.inexistente ? (
                                'no está en el inventario · no se descontó'
                              ) : c.anterior != null ? (
                                <>
                                  {formatNum(c.anterior)} → {formatNum(c.resultante)} (
                                  {devuelto ? '+' : '−'}
                                  {formatNum(c.cantidad)})
                                </>
                              ) : (
                                <>
                                  −{formatNum(c.cantidad)} → queda {formatNum(c.resultante)}
                                </>
                              )}
                            </td>
                          </tr>
                        );
                      })}
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
