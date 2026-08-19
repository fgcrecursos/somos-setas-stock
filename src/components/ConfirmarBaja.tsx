// =====================================================================
// Confirmación de baja de un ítem del inventario.
//
// Eliminar no se deshace y los datos son compartidos, así que antes de
// borrar se muestra qué se está por perder: el stock que todavía tenía y
// las recetas de productos que lo usan como componente.
// =====================================================================
import { AlertTriangle, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { CATEGORIA_LABEL, formatNum } from '../lib/helpers';
import { useStore } from '../lib/store';
import type { BaseItem, Categoria } from '../lib/types';
import { Modal } from './Modal';
import { useToast } from './Toast';

interface Props {
  categoria: Categoria;
  item: BaseItem;
  onClose: () => void;
  /** Se llama sólo si la baja salió bien: sirve para cerrar la ficha de atrás */
  onEliminado?: () => void;
}

export function ConfirmarBaja({ categoria, item, onClose, onEliminado }: Props) {
  const { state, eliminarItem, upsertProducto, guardando } = useStore();
  const toast = useToast();
  const [error, setError] = useState('');
  const [limpiarRecetas, setLimpiarRecetas] = useState(true);

  // Un componente que sigue en la receta de un producto no se puede borrar en
  // silencio: al producir, esa línea quedaría apuntando a un ítem que no existe.
  const enRecetas = useMemo(() => {
    if (categoria === 'producto') return [];
    return state.productos.filter((p) =>
      p.bom.some((b) => b.categoria === categoria && b.codigo === item.codigo)
    );
  }, [state.productos, categoria, item.codigo]);

  async function eliminar() {
    setError('');
    const res = await eliminarItem(categoria, item.codigo);
    if (!res.ok) {
      setError(res.error ?? 'No se pudo eliminar.');
      return;
    }

    // Recién ahora se tocan las recetas: si la baja hubiera fallado, los
    // productos quedan como estaban.
    let recetasFallidas = 0;
    if (limpiarRecetas && enRecetas.length) {
      for (const p of enRecetas) {
        const limpio = {
          ...p,
          bom: p.bom.filter((b) => !(b.categoria === categoria && b.codigo === item.codigo)),
        };
        const r = await upsertProducto(limpio, p.codigo);
        if (!r.ok) recetasFallidas++;
      }
    }

    toast(
      recetasFallidas
        ? `${item.nombre} se eliminó, pero ${recetasFallidas} receta(s) no se pudieron actualizar`
        : `${item.nombre} se eliminó del stock`,
      recetasFallidas > 0
    );
    onEliminado?.();
    onClose();
  }

  return (
    <Modal
      title={`Eliminar ${item.codigo}`}
      icon={<Trash2 size={20} color="var(--agotado)" />}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={guardando}>
            Cancelar
          </button>
          <button className="btn btn--peligro" onClick={eliminar} disabled={guardando}>
            <Trash2 size={15} /> {guardando ? 'Eliminando…' : 'Eliminar definitivamente'}
          </button>
        </>
      }
    >
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h3 style={{ fontSize: 20 }}>{item.nombre}</h3>
          <span className="pill" style={{ marginTop: 6 }}>{CATEGORIA_LABEL[categoria]}</span>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div className="muted" style={{ fontSize: 11.5 }}>Stock actual</div>
          <div style={{ fontFamily: 'var(--font-head)', fontSize: 26 }}>{formatNum(item.actual)}</div>
        </div>
      </div>

      <p className="hlp" style={{ marginTop: 14 }}>
        Sale del inventario para todo el equipo. Queda anotado como <strong>baja</strong> en el
        historial de movimientos, pero la ficha no se puede recuperar: si después hace falta, hay
        que cargarla de nuevo.
      </p>

      {item.actual !== 0 && (
        <div className="row aviso-venc st-agotado" style={{ marginTop: 6 }}>
          <AlertTriangle size={17} />
          <span>
            Todavía tiene {formatNum(item.actual)} en stock: esas unidades salen del sistema.
          </span>
        </div>
      )}

      {enRecetas.length > 0 && (
        <>
          <div className="row aviso-venc st-critico" style={{ marginTop: 10 }}>
            <AlertTriangle size={17} />
            <span>
              {enRecetas.length === 1 ? 'Lo usa 1 receta' : `Lo usan ${enRecetas.length} recetas`}:{' '}
              {enRecetas.map((p) => `${p.codigo} ${p.nombre}`).join(' · ')}
            </span>
          </div>
          <label className="row" style={{ marginTop: 10, gap: 8, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={limpiarRecetas}
              onChange={(e) => setLimpiarRecetas(e.target.checked)}
            />
            <span style={{ fontSize: 13 }}>
              Quitarlo también de esas recetas (si no, van a quedar con un componente que ya no
              existe y la producción va a avisar el error).
            </span>
          </label>
        </>
      )}

      {error && (
        <div
          className="badge-estado st-agotado"
          style={{ marginTop: 14, padding: '9px 12px', borderRadius: 10 }}
        >
          {error}
        </div>
      )}
    </Modal>
  );
}
