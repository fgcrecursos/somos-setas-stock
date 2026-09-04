// =====================================================================
// DETALLE DE UN MOVIMIENTO
//
// Lo que en la tabla entra en una fila, acá se cuenta entero: qué pasó,
// cuánto se movió el stock (antes → después), quién lo hizo y cuándo, qué
// se descontó de la receta o qué traía el pedido de la tienda, y cómo viene
// la historia reciente de ese ítem. La idea es no tener que salir a otra
// pantalla para entender un movimiento raro.
// =====================================================================
import {
  AlertTriangle,
  ArrowRight,
  Factory,
  History,
  PackagePlus,
  Pencil,
  PlusCircle,
  Search,
  ShoppingCart,
  SlidersHorizontal,
  Store,
  Trash2,
  Users,
} from 'lucide-react';
import { useMemo } from 'react';
import {
  CATEGORIA_LABEL,
  MOVIMIENTO_COLOR,
  MOVIMIENTO_LABEL,
  buscarItem,
  deltaMovimiento,
  formatFecha,
  formatFechaLarga,
  formatNum,
  tiempoRelativo,
} from '../lib/helpers';
import { useStore } from '../lib/store';
import type { Movimiento, TipoMovimiento } from '../lib/types';
import { Modal } from './Modal';
import { StatusBadge } from './StatusBadge';

const ICONO: Record<TipoMovimiento, React.ReactNode> = {
  venta: <ShoppingCart size={20} />,
  produccion: <Factory size={20} />,
  ingreso: <PackagePlus size={20} />,
  ajuste: <SlidersHorizontal size={20} />,
  consumo_interno: <Users size={20} />,
  alta: <PlusCircle size={20} />,
  edicion: <Pencil size={20} />,
  baja: <Trash2 size={20} />,
};

/** Cómo se lee cada tipo de movimiento, en una línea */
const EXPLICACION: Record<TipoMovimiento, string> = {
  venta: 'Salió vendido. No toca la receta: sólo baja el producto terminado.',
  produccion:
    'Se fabricó: suma el producto y descuenta la receta (etiqueta, insumos, materia prima).',
  ingreso: 'Entró stock por compra o reposición.',
  ajuste: 'Corrección de conteo físico: fija el stock en un número, sin tocar la receta.',
  consumo_interno: 'Lo usó el equipo. Descuenta stock pero no cuenta como venta.',
  alta: 'Se creó la ficha del ítem en el sistema.',
  edicion: 'Se modificó la ficha del ítem.',
  baja: 'Se eliminó el ítem del sistema.',
};

/** Cuántos movimientos vecinos del mismo ítem se listan */
const HISTORIAL = 8;
const DIAS_RESUMEN = 30;

interface Props {
  movimiento: Movimiento;
  onClose: () => void;
  /** Saltar a otro movimiento del mismo ítem sin cerrar el modal */
  onIr?: (id: string) => void;
  /** Filtrar el historial por este ítem (cierra el modal) */
  onVerHistorial?: (codigo: string) => void;
}

export function MovimientoModal({ movimiento: m, onClose, onIr, onVerHistorial }: Props) {
  const { state } = useStore();
  const st = MOVIMIENTO_COLOR[m.tipo] ?? MOVIMIENTO_COLOR.ajuste;
  const delta = deltaMovimiento(m);
  const tieneStock = m.resultante != null;
  const item = buscarItem(state, m.categoria, m.codigo);
  const hayIncidencia = !!m.incidencia || !!m.componentes?.some((c) => c.inexistente);
  const esPedido = m.origen === 'tienda';

  // Toda la vida de este ítem, del más nuevo al más viejo
  const delItem = useMemo(
    () =>
      state.movimientos
        .filter((x) => x.categoria === m.categoria && x.codigo === m.codigo)
        .sort((a, b) => new Date(b.fecha).getTime() - new Date(a.fecha).getTime()),
    [state.movimientos, m.categoria, m.codigo]
  );

  const posicion = delItem.findIndex((x) => x.id === m.id);
  const otros = delItem.filter((x) => x.id !== m.id).slice(0, HISTORIAL);

  // Cuánto entró y cuánto salió de este ítem en el último mes
  const resumen = useMemo(() => {
    const desde = Date.now() - DIAS_RESUMEN * 864e5;
    let entro = 0;
    let salio = 0;
    for (const x of delItem) {
      const t = new Date(x.fecha).getTime();
      if (isNaN(t) || t < desde) continue;
      const d = deltaMovimiento(x);
      if (d > 0) entro += d;
      else salio += -d;
    }
    return { entro, salio };
  }, [delItem]);

  // En las ediciones la nota es la lista de campos que cambiaron, separada por
  // " · ": se lee mucho mejor como lista que como un párrafo corrido.
  const cambios =
    m.tipo === 'edicion' && m.nota
      ? m.nota.split(' · ').map((s) => s.trim()).filter(Boolean)
      : [];

  return (
    <Modal
      title={MOVIMIENTO_LABEL[m.tipo] ?? m.tipo}
      icon={<span style={{ color: st.c, display: 'grid' }}>{ICONO[m.tipo]}</span>}
      wide
      onClose={onClose}
      footer={
        <>
          {onVerHistorial && (
            <button
              className="btn"
              onClick={() => {
                onVerHistorial(m.codigo);
                onClose();
              }}
            >
              <Search size={15} /> Ver todo el historial del ítem
            </button>
          )}
          <button className="btn btn--dark" onClick={onClose}>
            Cerrar
          </button>
        </>
      }
    >
      {/* Qué ítem y cuánto se movió */}
      <div className="mov-hero">
        <div style={{ minWidth: 0 }}>
          <h3>{m.nombre}</h3>
          <div className="mov-hero__meta">
            <span className="codigo">{m.codigo}</span>
            <span className="pill">{CATEGORIA_LABEL[m.categoria] ?? m.categoria}</span>
            {esPedido && (
              <span className="pill" style={{ gap: 3 }}>
                <Store size={11} /> {m.referencia ? `pedido ${m.referencia}` : 'tienda'}
              </span>
            )}
            {hayIncidencia && (
              <span
                className="pill"
                style={{
                  gap: 3,
                  background: 'var(--critico-bg)',
                  color: 'var(--critico)',
                  borderColor: 'transparent',
                }}
              >
                <AlertTriangle size={11} /> receta incompleta
              </span>
            )}
          </div>
        </div>
        <div className="mov-hero__delta">
          <div className={delta < 0 ? 'diff-neg' : delta > 0 ? 'diff-pos' : 'muted'}>
            {delta > 0 ? '+' : ''}
            {formatNum(delta)}
          </div>
          <div
            className="muted"
            style={{ fontFamily: 'var(--font-body)', fontSize: 11.5, marginTop: 4 }}
          >
            {delta === 0 ? 'sin cambio de stock' : 'unidades'}
          </div>
        </div>
      </div>

      {/* Antes → después del ítem principal */}
      {tieneStock ? (
        <div className="mov-flujo">
          <div className="mov-flujo__box">
            <span>Antes</span>
            <b>{m.anterior != null ? formatNum(m.anterior) : '—'}</b>
          </div>
          <ArrowRight size={16} />
          <div className="mov-flujo__box">
            <span>Este movimiento</span>
            <b className={delta < 0 ? 'diff-neg' : delta > 0 ? 'diff-pos' : 'muted'}>
              {delta > 0 ? '+' : ''}
              {formatNum(delta)}
            </b>
          </div>
          <ArrowRight size={16} />
          <div className="mov-flujo__box">
            <span>Después</span>
            <b>{formatNum(m.resultante!)}</b>
          </div>
        </div>
      ) : (
        <p className="hlp" style={{ margin: '12px 0 16px' }}>
          {delta === 0
            ? 'Este movimiento no tocó el stock del ítem: sólo cambió la ficha.'
            : 'Este movimiento no dejó registrado el stock anterior ni el posterior: es de antes de que se empezara a guardar.'}
        </p>
      )}

      {hayIncidencia && (
        <div className="row aviso-venc st-critico" style={{ marginTop: 0, marginBottom: 16 }}>
          <AlertTriangle size={17} />
          <span>
            {m.incidencia ??
              'Un componente de la receta no está en el inventario y no se pudo descontar.'}
          </span>
        </div>
      )}

      {/* Quién, cuándo y qué significa */}
      <div className="section-title">El movimiento</div>
      <div className="ficha-datos">
        <Fila label="Cuándo" value={`${formatFechaLarga(m.fecha)} · ${tiempoRelativo(m.fecha)}`} />
        <Fila label="Registró" value={m.usuario ?? 'Sin usuario registrado'} />
        <Fila
          label="Origen"
          value={
            esPedido
              ? `Pedido de la tienda${m.referencia ? ` · ${m.referencia}` : ''}`
              : 'Cargado en la plataforma'
          }
        />
        {m.nota && !cambios.length && <Fila label="Nota" value={m.nota} />}
        <Fila label="Qué significa" value={<span className="muted">{EXPLICACION[m.tipo]}</span>} />
      </div>

      {/* Ediciones: qué campos cambiaron */}
      {cambios.length > 0 && (
        <>
          <div className="section-title">Qué cambió en la ficha</div>
          <ul className="mov-cambios">
            {cambios.map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </ul>
        </>
      )}

      {/* Receta descontada / ítems del pedido */}
      {!!m.componentes?.length && (
        <>
          <div className="section-title">
            {esPedido ? 'Ítems del pedido' : 'Componentes descontados de la receta'}
          </div>
          <div className="table-wrap mov-tabla">
            <table className="tbl tbl--anidada">
              <thead>
                <tr>
                  <th className="no-sort">Categoría</th>
                  <th className="no-sort">Ítem</th>
                  <th className="num">Movió</th>
                  <th className="no-sort">Stock</th>
                </tr>
              </thead>
              <tbody>
                {m.componentes.map((c) => {
                  // Si terminó con más stock que antes fue una devolución
                  // (pedido anulado o corregido a la baja), no un descuento.
                  const devuelto = c.anterior != null && c.resultante > c.anterior;
                  return (
                    <tr key={c.categoria + c.codigo}>
                      <td className="muted" style={{ fontSize: 12 }}>
                        {CATEGORIA_LABEL[c.categoria] ?? c.categoria}
                      </td>
                      <td>
                        <span className="codigo">{c.codigo}</span> {c.nombre}
                      </td>
                      <td className={'num ' + (devuelto ? 'diff-pos' : 'diff-neg')}>
                        {c.inexistente ? '—' : `${devuelto ? '+' : '−'}${formatNum(c.cantidad)}`}
                      </td>
                      <td
                        className={c.faltante && !c.inexistente ? 'diff-neg' : 'muted'}
                        style={{ fontSize: 12.5 }}
                      >
                        {c.inexistente ? (
                          <span className="diff-neg">no está en el inventario · no se descontó</span>
                        ) : (
                          <>
                            {c.anterior != null
                              ? `${formatNum(c.anterior)} → ${formatNum(c.resultante)}`
                              : `quedó ${formatNum(c.resultante)}`}
                            {c.faltante ? ' · por debajo del mínimo' : ''}
                          </>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* Cómo está el ítem hoy */}
      <div className="section-title">El ítem hoy</div>
      {item ? (
        <div className="ficha-datos">
          <Fila
            label="Stock actual"
            value={
              <span className="row" style={{ gap: 8, justifyContent: 'flex-end' }}>
                {formatNum(item.actual)} de {formatNum(item.minimo)} mínimo
                <StatusBadge actual={item.actual} minimo={item.minimo} />
              </span>
            }
          />
          <Fila
            label={`Últimos ${DIAS_RESUMEN} días`}
            value={
              <span>
                <span className="diff-pos">+{formatNum(resumen.entro)}</span> entraron ·{' '}
                <span className="diff-neg">−{formatNum(resumen.salio)}</span> salieron
              </span>
            }
          />
          <Fila
            label="Desde este movimiento"
            value={
              posicion <= 0
                ? 'Es el último movimiento de este ítem'
                : `Hubo ${posicion} movimiento${posicion === 1 ? '' : 's'} más`
            }
          />
        </div>
      ) : (
        <p className="hlp" style={{ marginTop: 0, marginBottom: 16 }}>
          El ítem ya no está en el inventario: se dio de baja o cambió de código.
        </p>
      )}

      {/* Los movimientos de al lado */}
      <div className="section-title">Otros movimientos de este ítem</div>
      {otros.length ? (
        <div className="table-wrap mov-tabla mov-lista">
          <table className="tbl tbl--anidada">
            <tbody>
              {otros.map((x) => {
                const c = MOVIMIENTO_COLOR[x.tipo] ?? MOVIMIENTO_COLOR.ajuste;
                const d = deltaMovimiento(x);
                return (
                  <tr
                    key={x.id}
                    style={{ cursor: onIr ? 'pointer' : 'default' }}
                    onClick={() => onIr?.(x.id)}
                    title={onIr ? 'Ver el detalle de este movimiento' : undefined}
                  >
                    <td className="muted" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>
                      {formatFecha(x.fecha)}
                    </td>
                    <td style={{ width: 1 }}>
                      <span
                        className="pill"
                        style={{ background: c.bg, color: c.c, borderColor: 'transparent' }}
                      >
                        {MOVIMIENTO_LABEL[x.tipo] ?? x.tipo}
                      </span>
                    </td>
                    <td className={'num ' + (d < 0 ? 'diff-neg' : d > 0 ? 'diff-pos' : 'muted')}>
                      {d > 0 ? '+' : ''}
                      {formatNum(d)}
                    </td>
                    <td className="muted" style={{ fontSize: 12 }}>
                      {x.resultante != null ? `quedó ${formatNum(x.resultante)}` : (x.nota ?? '—')}
                    </td>
                    <td className="muted" style={{ fontSize: 12 }}>
                      {x.usuario ?? '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="hlp" style={{ marginTop: 0 }}>
          Es el único movimiento registrado de este ítem.
        </p>
      )}
      {delItem.length > otros.length + 1 && (
        <p className="hlp" style={{ marginTop: 8 }}>
          <History size={12} style={{ verticalAlign: 'middle' }} /> Este ítem tiene{' '}
          {formatNum(delItem.length)} movimientos en total.
        </p>
      )}
    </Modal>
  );
}

function Fila({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="ficha-datos__fila">
      <span className="muted">{label}</span>
      <span>{value}</span>
    </div>
  );
}
