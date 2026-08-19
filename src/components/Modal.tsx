import { X } from 'lucide-react';
import { useEffect, type ReactNode } from 'react';

interface Props {
  title: string;
  icon?: ReactNode;
  wide?: boolean;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}

// Modales abiertos, en orden. Escape cierra sólo el de arriba de todo: si
// sobre un formulario hay una confirmación, cerrarla no tiene que cerrar
// también el formulario de atrás y perder lo que se estaba cargando.
const abiertos: symbol[] = [];

export function Modal({ title, icon, wide, onClose, children, footer }: Props) {
  useEffect(() => {
    const id = Symbol('modal');
    abiertos.push(id);
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (abiertos[abiertos.length - 1] !== id) return;
      onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      const i = abiertos.indexOf(id);
      if (i >= 0) abiertos.splice(i, 1);
    };
  }, [onClose]);

  return (
    <div className="overlay" onMouseDown={onClose}>
      <div
        className={'modal' + (wide ? ' modal--wide' : '')}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="modal__head">
          {icon}
          <h2>{title}</h2>
          <button className="close" onClick={onClose} aria-label="Cerrar">
            <X size={20} />
          </button>
        </div>
        <div className="modal__body">{children}</div>
        {footer && <div className="modal__foot">{footer}</div>}
      </div>
    </div>
  );
}
