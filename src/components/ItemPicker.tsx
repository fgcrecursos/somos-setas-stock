import { ChevronDown, Search, X } from 'lucide-react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

export interface OpcionPicker {
  codigo: string;
  nombre: string;
}

interface Props {
  opciones: OpcionPicker[];
  value: string;
  onChange: (codigo: string) => void;
  /** Texto del botón cuando todavía no se eligió nada */
  vacio?: string;
  placeholder?: string;
  disabled?: boolean;
}

/**
 * Selector de ítem con buscador. Reemplaza al `<select>` nativo cuando la lista
 * es larga (insumos, etiquetas, materia prima): se escribe parte del código o
 * del nombre y la lista se filtra, en vez de tener que recorrerla a mano.
 * Cada palabra tipeada se busca por separado, así "cap mai" encuentra
 * "CAP-03 — Maitake" sin importar el orden.
 */
export function ItemPicker({
  opciones,
  value,
  onChange,
  vacio = 'Elegir…',
  placeholder = 'Buscar por código o nombre…',
  disabled,
}: Props) {
  const [abierto, setAbierto] = useState(false);
  const [q, setQ] = useState('');
  const [marcado, setMarcado] = useState(0);
  const cont = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listaRef = useRef<HTMLDivElement>(null);

  const elegido = opciones.find((o) => o.codigo === value);

  const filtradas = useMemo(() => {
    const partes = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (!partes.length) return opciones;
    return opciones.filter((o) => {
      const texto = `${o.codigo} ${o.nombre}`.toLowerCase();
      return partes.every((p) => texto.includes(p));
    });
  }, [opciones, q]);

  // Al abrir: foco en el buscador y la lista arranca en lo que ya estaba elegido
  useEffect(() => {
    if (!abierto) return;
    setQ('');
    const i = opciones.findIndex((o) => o.codigo === value);
    setMarcado(i >= 0 ? i : 0);
    inputRef.current?.focus();
  }, [abierto, opciones, value]);

  // Un click afuera cierra el panel sin elegir nada
  useEffect(() => {
    if (!abierto) return;
    function fuera(e: PointerEvent) {
      if (!cont.current?.contains(e.target as Node)) setAbierto(false);
    }
    document.addEventListener('pointerdown', fuera);
    return () => document.removeEventListener('pointerdown', fuera);
  }, [abierto]);

  // La opción marcada con el teclado siempre queda a la vista
  useLayoutEffect(() => {
    if (!abierto) return;
    const el = listaRef.current?.children[marcado] as HTMLElement | undefined;
    el?.scrollIntoView({ block: 'nearest' });
  }, [marcado, abierto]);

  function elegir(codigo: string) {
    onChange(codigo);
    setAbierto(false);
  }

  function teclas(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setMarcado((i) => Math.min(i + 1, filtradas.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setMarcado((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const op = filtradas[marcado];
      if (op) elegir(op.codigo);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setAbierto(false);
    }
  }

  return (
    <div className="picker" ref={cont}>
      <button
        type="button"
        className={`picker__btn${elegido ? '' : ' picker__btn--vacio'}`}
        onClick={() => setAbierto((v) => !v)}
        disabled={disabled}
      >
        <span className="picker__txt">
          {elegido ? `${elegido.codigo} — ${elegido.nombre}` : vacio}
        </span>
        <ChevronDown size={15} />
      </button>

      {abierto && (
        <div className="picker__pop">
          <div className="picker__search">
            <Search size={15} />
            <input
              ref={inputRef}
              className="input"
              placeholder={placeholder}
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setMarcado(0);
              }}
              onKeyDown={teclas}
            />
            {q && (
              <button type="button" className="picker__clear" onClick={() => setQ('')} title="Limpiar">
                <X size={14} />
              </button>
            )}
          </div>

          <div className="picker__list" ref={listaRef}>
            {filtradas.map((o, i) => (
              <button
                type="button"
                key={o.codigo}
                className={`picker__opt${i === marcado ? ' is-marcado' : ''}${
                  o.codigo === value ? ' is-elegido' : ''
                }`}
                onMouseEnter={() => setMarcado(i)}
                onClick={() => elegir(o.codigo)}
              >
                <span className="picker__cod">{o.codigo}</span>
                <span className="picker__nom">{o.nombre}</span>
              </button>
            ))}
            {!filtradas.length && (
              <div className="picker__vacio">Nada coincide con “{q}”.</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
