// =====================================================================
// BARRA DE FILTROS — buscador a la vista, el resto adentro de un modal.
//
// Cada sección tenía su hilera de chips (tipos, categorías, períodos,
// interruptores…) y entre todas se comían dos o tres renglones antes de
// que empezara la tabla. Ahora la barra es siempre la misma: el buscador,
// que es lo que más se usa, y un botón "Filtrar" con la cantidad de
// filtros puestos. Lo demás vive en el modal.
// =====================================================================
import { Search, SlidersHorizontal } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Modal } from './Modal';

interface Props {
  /** Sin q/setQ no se dibuja el buscador: hay vistas que lo tienen en otro lado */
  q?: string;
  setQ?: (v: string) => void;
  placeholder?: string;
  /**
   * Los filtros puestos, en texto legible ("Cápsulas", "Solo faltantes").
   * De acá salen el número del botón y el resumen que se ve al pasar el mouse.
   */
  activos: string[];
  /** Deja todos los filtros del modal como estaban al entrar */
  onLimpiar: () => void;
  /** Los grupos de filtros, normalmente <GrupoFiltro>…</GrupoFiltro> */
  children: ReactNode;
  /** Lo que va pegado al buscador, antes del botón (una pestaña, un total…) */
  antes?: ReactNode;
}

export function BarraFiltros({
  q,
  setQ,
  placeholder = 'Buscar…',
  activos,
  onLimpiar,
  children,
  antes,
}: Props) {
  const [abierto, setAbierto] = useState(false);

  return (
    <>
      {setQ && (
        <div className="searchbox">
          <Search size={16} />
          <input
            className="input"
            placeholder={placeholder}
            value={q ?? ''}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
      )}
      {antes}
      <button
        className={'chip chip--filtrar' + (activos.length ? ' active' : '')}
        onClick={() => setAbierto(true)}
        title={activos.length ? activos.join(' · ') : 'Sin filtros'}
      >
        <SlidersHorizontal size={14} />
        {/* Con un solo filtro puesto se lee cuál es sin tener que abrir nada */}
        {activos.length === 1 ? `Filtrar · ${activos[0]}` : 'Filtrar'}
        {activos.length > 1 && <span className="chip__num">{activos.length}</span>}
      </button>

      {abierto && (
        <Modal
          title="Filtros"
          icon={<SlidersHorizontal size={20} />}
          onClose={() => setAbierto(false)}
          footer={
            <>
              <button
                className="btn btn--ghost"
                onClick={onLimpiar}
                disabled={!activos.length}
              >
                Limpiar filtros
              </button>
              <button className="btn btn--primary" onClick={() => setAbierto(false)}>
                Listo
              </button>
            </>
          }
        >
          {/* Los filtros se aplican al tocarlos: el modal es sólo dónde viven,
              no un formulario que haya que confirmar. */}
          <div className="filtros">{children}</div>
        </Modal>
      )}
    </>
  );
}

export function GrupoFiltro({
  titulo,
  ayuda,
  children,
}: {
  titulo: string;
  ayuda?: string;
  children: ReactNode;
}) {
  return (
    <div className="filtro-grupo">
      <div className="filtro-grupo__tit">{titulo}</div>
      {ayuda && <p className="hlp filtro-grupo__ayuda">{ayuda}</p>}
      <div className="chips">{children}</div>
    </div>
  );
}
