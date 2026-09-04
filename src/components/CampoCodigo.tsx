// =====================================================================
// CAMPO CÓDIGO — se completa solo al dar de alta un ítem
//
// El código lo propone la app (el próximo libre de la serie que corresponde) y
// el campo queda bloqueado para que nadie tenga que ir a mirar la tabla ni
// arriesgar un número repetido. Igual se puede escribir a mano: hay casos
// legítimos (recuperar un código dado de baja, seguir una serie vieja), así que
// el botón "Escribirlo a mano" libera el campo y el de al lado vuelve al
// automático.
// =====================================================================
import { Pencil, Wand2 } from 'lucide-react';
import { useEffect, useRef } from 'react';

interface Props {
  valor: string;
  /** El que propone la app para este ítem */
  sugerido: string;
  /** ¿Lo está escribiendo la persona? */
  manual: boolean;
  onManual: (manual: boolean) => void;
  onChange: (codigo: string) => void;
  /** En edición el código ya existe: se muestra suelto, sin sugerencia */
  editando?: boolean;
}

export function CampoCodigo({ valor, sugerido, manual, onManual, onChange, editando }: Props) {
  const ref = useRef<HTMLInputElement>(null);
  const libre = manual || editando;

  // Al pasar a mano, el cursor va al campo y el código propuesto queda
  // seleccionado: se empieza a escribir y lo reemplaza, en vez de quedar pegado
  // atrás ("ACE-08ACE-99").
  useEffect(() => {
    if (!manual || editando) return;
    ref.current?.focus();
    ref.current?.select();
  }, [manual, editando]);

  return (
    <div className="field">
      <label>Código *</label>
      <div className="campo-codigo">
        <input
          ref={ref}
          className={'input' + (libre ? '' : ' input--auto')}
          value={valor}
          readOnly={!libre}
          onChange={(e) => onChange(e.target.value.toUpperCase())}
          placeholder={sugerido}
        />
        {!editando && (
          <button
            type="button"
            className="btn btn--sm"
            onClick={() => onManual(!manual)}
            title={
              manual
                ? `Volver al código automático (${sugerido})`
                : 'Escribir el código a mano'
            }
          >
            {manual ? <Wand2 size={14} /> : <Pencil size={14} />}
            <span className="btn__txt">{manual ? 'Automático' : 'A mano'}</span>
          </button>
        )}
      </div>
      <span className="hlp">
        {editando ? (
          'Identificador único. Se usa para escanear y en las recetas.'
        ) : manual ? (
          <>Tiene que ser único: si el código ya existe, no deja guardar.</>
        ) : (
          <>Se genera solo: es el próximo libre de la serie. Se usa para escanear.</>
        )}
      </span>
    </div>
  );
}
