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

export function Modal({ title, icon, wide, onClose, children, footer }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
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
