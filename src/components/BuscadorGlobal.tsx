// =====================================================================
// BUSCADOR GENERAL — encuentra cualquier ítem, esté en la sección que esté
//
// Cada sección tiene su propio buscador, pero para encontrar algo había que
// saber de antemano si era un insumo, una etiqueta o una materia prima. Este
// busca en las cinco categorías a la vez, por código o por nombre (y también
// por tipo, presentación, lote o proveedor), sin tildes y sin importar cómo
// esté escrito el separador del código: "etq ace 01", "ETQ-ACE-01" y "etqace01"
// llegan al mismo lugar. Al elegir un resultado se abre la ficha del ítem en su
// sección.
// =====================================================================
import { Search, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { CATEGORIA_LABEL, buscarEnTodo, calcEstado, formatNum } from '../lib/helpers';
import { useStore } from '../lib/store';
import type { Categoria } from '../lib/types';

interface Props {
  onElegir: (categoria: Categoria, codigo: string) => void;
}

export function BuscadorGlobal({ onElegir }: Props) {
  const { state } = useStore();
  const [q, setQ] = useState('');
  const [abierto, setAbierto] = useState(false);
  const [activo, setActivo] = useState(0);
  const caja = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);

  const resultados = useMemo(() => buscarEnTodo(state, q), [state, q]);

  // Ctrl+K (o ⌘K) para ir al buscador desde cualquier pantalla, como en el
  // resto de las herramientas que usa el equipo.
  useEffect(() => {
    function atajo(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        input.current?.focus();
        input.current?.select();
      }
    }
    window.addEventListener('keydown', atajo);
    return () => window.removeEventListener('keydown', atajo);
  }, []);

  // Un clic afuera cierra la lista pero deja lo escrito: si se vuelve al campo,
  // la búsqueda sigue ahí.
  useEffect(() => {
    function afuera(e: MouseEvent) {
      if (caja.current && !caja.current.contains(e.target as Node)) setAbierto(false);
    }
    document.addEventListener('mousedown', afuera);
    return () => document.removeEventListener('mousedown', afuera);
  }, []);

  useEffect(() => setActivo(0), [q]);

  function elegir(i: number) {
    const r = resultados[i];
    if (!r) return;
    onElegir(r.categoria, r.item.codigo);
    setAbierto(false);
    input.current?.blur();
  }

  function teclas(e: React.KeyboardEvent) {
    if (e.key === 'Escape') {
      setAbierto(false);
      input.current?.blur();
      return;
    }
    if (!resultados.length) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setAbierto(true);
      setActivo((i) => (i + 1) % resultados.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActivo((i) => (i - 1 + resultados.length) % resultados.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      elegir(activo);
    }
  }

  const mostrar = abierto && q.trim().length > 0;

  return (
    <div className="buscador-global" ref={caja}>
      <div className="searchbox">
        <Search size={16} />
        <input
          ref={input}
          className="input"
          placeholder="Buscar en todo el stock (Ctrl+K)"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setAbierto(true);
          }}
          onFocus={() => setAbierto(true)}
          onKeyDown={teclas}
        />
        {q && (
          <button
            className="buscador-global__limpiar"
            onClick={() => {
              setQ('');
              input.current?.focus();
            }}
            title="Limpiar"
            aria-label="Limpiar la búsqueda"
          >
            <X size={14} />
          </button>
        )}
      </div>

      {mostrar && (
        <div className="buscador-global__panel">
          {resultados.length === 0 ? (
            <p className="buscador-global__vacio">
              No hay ningún ítem que coincida con “{q}”.
            </p>
          ) : (
            resultados.map((r, i) => {
              const est = calcEstado(r.item.actual, r.item.minimo);
              return (
                <button
                  key={`${r.categoria}-${r.item.codigo}`}
                  className={'buscador-global__hit' + (i === activo ? ' active' : '')}
                  onMouseEnter={() => setActivo(i)}
                  onClick={() => elegir(i)}
                >
                  <span className="buscador-global__cod">{r.item.codigo}</span>
                  <span className="buscador-global__nom">{r.item.nombre}</span>
                  <span className="pill">{CATEGORIA_LABEL[r.categoria]}</span>
                  <span className={'buscador-global__stock st-' + est.estado}>
                    {formatNum(r.item.actual)}
                  </span>
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
