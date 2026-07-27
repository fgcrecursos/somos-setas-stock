import { History } from 'lucide-react';
import { Fragment, useState } from 'react';
import { formatFecha, formatNum } from '../lib/helpers';
import { useStore } from '../lib/store';

const TIPO_STYLE: Record<string, { bg: string; c: string }> = {
  venta: { bg: 'var(--naranja-100)', c: 'var(--naranja-600)' },
  produccion: { bg: 'var(--ok-bg)', c: 'var(--ok)' },
  ingreso: { bg: '#e2eef5', c: '#3f6a7a' },
  ajuste: { bg: 'var(--crema-3)', c: 'var(--verde-700)' },
};

export function MovimientosView() {
  const { state } = useStore();
  const [abierto, setAbierto] = useState<string | null>(null);

  return (
    <div className="card">
      <div className="card__head">
        <History size={18} />
        <h3>Historial de movimientos</h3>
        <span className="pill" style={{ marginLeft: 'auto' }}>{state.movimientos.length}</span>
      </div>
      <div className="table-wrap">
        <table className="tbl">
          <thead>
            <tr>
              <th className="no-sort">Fecha</th>
              <th className="no-sort">Tipo</th>
              <th className="no-sort">Ítem</th>
              <th className="num">Cantidad</th>
              <th className="no-sort">Detalle</th>
            </tr>
          </thead>
          <tbody>
            {state.movimientos.map((m) => {
              const st = TIPO_STYLE[m.tipo];
              const open = abierto === m.id;
              return (
                <Fragment key={m.id}>
                  <tr style={{ cursor: m.componentes?.length ? 'pointer' : 'default' }}
                      onClick={() => m.componentes?.length && setAbierto(open ? null : m.id)}>
                    <td className="muted" style={{ fontSize: 12 }}>{formatFecha(m.fecha)}</td>
                    <td><span className="pill" style={{ background: st.bg, color: st.c, borderColor: 'transparent' }}>{m.tipo}</span></td>
                    <td className="nombre">{m.nombre} <span className="codigo">{m.codigo}</span></td>
                    <td className="num" style={{ fontWeight: 700 }}>{m.cantidad > 0 && m.tipo !== 'venta' ? '+' : ''}{formatNum(m.tipo === 'venta' ? -m.cantidad : m.cantidad)}</td>
                    <td className="muted">
                      {m.componentes?.length ? `${m.componentes.length} componentes descontados · ${open ? 'ocultar' : 'ver'}` : (m.nota ?? '—')}
                    </td>
                  </tr>
                  {open && m.componentes?.map((c) => (
                    <tr key={m.id + c.codigo} style={{ background: 'var(--crema-2)' }}>
                      <td></td>
                      <td></td>
                      <td colSpan={2} style={{ paddingLeft: 24 }}>
                        <span className="codigo">{c.codigo}</span> {c.nombre}
                      </td>
                      <td className={c.faltante ? 'diff-neg' : 'muted'}>
                        −{formatNum(c.cantidad)} → queda {formatNum(c.resultante)}
                      </td>
                    </tr>
                  ))}
                </Fragment>
              );
            })}
            {state.movimientos.length === 0 && (
              <tr><td colSpan={5}><div className="empty"><History size={30} /><p>Sin movimientos registrados aún.</p></div></td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
