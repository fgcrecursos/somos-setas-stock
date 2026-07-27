import { calcEstado } from '../lib/helpers';

export function StatusBadge({ actual, minimo }: { actual: number; minimo: number }) {
  const { estado, label } = calcEstado(actual, minimo);
  return <span className={`badge-estado st-${estado}`}>{label}</span>;
}

/** Muestra la diferencia respecto al mínimo: faltan X / sobran X / justo */
export function DiffCell({ actual, minimo }: { actual: number; minimo: number }) {
  const { diferencia, faltan, sobran } = calcEstado(actual, minimo);
  if (minimo <= 0) return <span className="muted">—</span>;
  if (diferencia < 0)
    return <span className="diff-neg">Faltan {faltan}</span>;
  if (diferencia > 0)
    return <span className="diff-pos">Sobran {sobran}</span>;
  return <span className="diff-zero">Justo</span>;
}

export function StockBar({ actual, minimo }: { actual: number; minimo: number }) {
  const { estado } = calcEstado(actual, minimo);
  const ref = Math.max(minimo, actual, 1);
  const pct = Math.max(3, Math.min(100, (actual / ref) * 100));
  const color =
    estado === 'ok' || estado === 'sin_minimo'
      ? 'var(--ok)'
      : estado === 'bajo'
      ? 'var(--bajo)'
      : estado === 'critico'
      ? 'var(--critico)'
      : 'var(--agotado)';
  return (
    <div className="mini-bar" title={`${actual} / mín ${minimo}`}>
      <span style={{ width: `${pct}%`, background: color }} />
    </div>
  );
}
