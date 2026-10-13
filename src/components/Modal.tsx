import { X } from 'lucide-react';
import { useEffect, type ReactNode } from 'react';

interface Props {
  title: string;
  icon?: ReactNode;
  wide?: boolean;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  /**
   * Hay datos cargados sin guardar: tocar afuera, Escape o la X preguntan
   * antes de cerrar. Antes un click fuera del formulario lo cerraba y se
   * perdía todo lo escrito sin ningún aviso.
   */
  sinGuardar?: boolean;
}

const PREGUNTA =
  'Hay datos cargados que no se guardaron. Si cerrás, se pierden.\n\n¿Cerrar sin guardar?';

// Modales abiertos, en orden. Escape cierra sólo el de arriba de todo: si
// sobre un formulario hay una confirmación, cerrarla no tiene que cerrar
// también el formulario de atrás y perder lo que se estaba cargando.
const abiertos: symbol[] = [];

export function Modal({ title, icon, wide, onClose, children, footer, sinGuardar }: Props) {
  const intentarCerrar = () => {
    if (sinGuardar && !window.confirm(PREGUNTA)) return;
    onClose();
  };
  useEffect(() => {
    const id = Symbol('modal');
    abiertos.push(id);
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (abiertos[abiertos.length - 1] !== id) return;
      if (sinGuardar && !window.confirm(PREGUNTA)) return;
      onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      const i = abiertos.indexOf(id);
      if (i >= 0) abiertos.splice(i, 1);
    };
  }, [onClose, sinGuardar]);

  return (
    <div
      className="overlay"
      onMouseDown={(e) => {
        // Sólo un click directo sobre el fondo: arrastrar al seleccionar
        // texto de un campo y soltar afuera no cierra nada.
        if (e.target === e.currentTarget) intentarCerrar();
      }}
    >
      <div
        className={'modal' + (wide ? ' modal--wide' : '')}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="modal__head">
          {icon}
          <h2>{title}</h2>
          <button className="close" onClick={intentarCerrar} aria-label="Cerrar">
            <X size={20} />
          </button>
        </div>
        <div className="modal__body">{children}</div>
        {footer && <div className="modal__foot">{footer}</div>}
      </div>
    </div>
  );
}
