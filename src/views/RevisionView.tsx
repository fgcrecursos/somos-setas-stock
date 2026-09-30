// =====================================================================
// REVISIÓN DE DATOS — la lista de lo que hay que corregir para que el stock
// cierre. Cada grupo es un problema de los datos (no de las cuentas): se
// calcula en vivo y cada fila tiene su botón para abrir la ficha y
// corregirla ahí mismo. Cuando se arregla, la fila desaparece sola.
// =====================================================================
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, Info, Pencil, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { ItemForm } from '../components/ItemForm';
import { ProductForm } from '../components/ProductForm';
import { CATEGORIA_LABEL, buscarItem, coincideBusqueda, formatNum } from '../lib/helpers';
import { GRAVEDAD_LABEL, revisarDatos, type Gravedad, type GrupoRevision } from '../lib/revision';
import { useStore } from '../lib/store';
import type { Categoria, Producto } from '../lib/types';

const ICONO: Record<Gravedad, any> = { grave: AlertTriangle, revisar: Search, info: Info };
const COLOR: Record<Gravedad, string> = {
  grave: 'var(--agotado)',
  revisar: 'var(--bajo)',
  info: 'var(--texto-3)',
};

export function RevisionView() {
  const { state, puedeEditar } = useStore();
  const [abiertos, setAbiertos] = useState<Set<string>>(new Set());
  const [q, setQ] = useState('');
  const [editar, setEditar] = useState<{ categoria: Categoria; codigo: string } | null>(null);

  const grupos = useMemo(() => revisarDatos(state), [state]);
  const conProblemas = grupos.filter((g) => g.filas.length > 0);
  const limpios = grupos.filter((g) => g.filas.length === 0);
  const graves = conProblemas.filter((g) => g.gravedad === 'grave');

  function toggle(id: string) {
    setAbiertos((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const itemEditado = editar ? buscarItem(state, editar.categoria, editar.codigo) : null;

  return (
    <div className="stack">
      <div className="card">
        <div className="card__body">
          <p style={{ margin: 0 }}>
            El sistema descuenta bien lo que le dicen las recetas; el problema es lo que dicen. Acá
            está, en vivo, cada dato que hace que el stock no coincida con el estante.{' '}
            <strong>
              {graves.length
                ? `${graves.length} ${graves.length === 1 ? 'problema afecta' : 'problemas afectan'} el stock hoy.`
                : 'Nada de lo que afecta el stock está pendiente.'}
            </strong>
          </p>
          <p className="hlp" style={{ margin: '8px 0 0' }}>
            Orden sugerido: primero las recetas (etiquetas y materia prima), después un conteo físico
            de todo, cargado como "Corrección por conteo físico". Contar antes de corregir las
            recetas sirve de poco: la próxima producción lo vuelve a desacomodar.
          </p>
        </div>
      </div>

      <div className="toolbar" style={{ margin: 0 }}>
        <input
          className="input"
          style={{ maxWidth: 360 }}
          placeholder="Buscar código o nombre dentro de la revisión…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>

      {conProblemas.map((g) => (
        <Grupo
          key={g.id}
          g={g}
          q={q}
          abierto={abiertos.has(g.id) || !!q.trim()}
          onToggle={() => toggle(g.id)}
          puedeEditar={puedeEditar}
          onEditar={(categoria, codigo) => setEditar({ categoria, codigo })}
        />
      ))}

      {limpios.length > 0 && (
        <div className="card">
          <div className="card__body">
            {limpios.map((g) => (
              <div key={g.id} className="row" style={{ gap: 8, padding: '3px 0' }}>
                <CheckCircle2 size={15} color="var(--ok)" />
                <span className="muted" style={{ fontSize: 13 }}>{g.titulo}: nada pendiente.</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {editar && itemEditado && editar.categoria === 'producto' && (
        <ProductForm initial={itemEditado as Producto} onClose={() => setEditar(null)} />
      )}
      {editar && itemEditado && editar.categoria !== 'producto' && (
        <ItemForm categoria={editar.categoria} initial={itemEditado} onClose={() => setEditar(null)} />
      )}
    </div>
  );
}

function Grupo({
  g,
  q,
  abierto,
  onToggle,
  puedeEditar,
  onEditar,
}: {
  g: GrupoRevision;
  q: string;
  abierto: boolean;
  onToggle: () => void;
  puedeEditar: boolean;
  onEditar: (categoria: Categoria, codigo: string) => void;
}) {
  const filas = g.filas.filter((f) => coincideBusqueda(q, f.codigo, f.nombre, f.detalle));
  if (q.trim() && !filas.length) return null;
  const Icono = ICONO[g.gravedad];

  return (
    <div className="card">
      <button type="button" className="revision__head" onClick={onToggle}>
        {abierto ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        <Icono size={17} color={COLOR[g.gravedad]} />
        <span className="revision__titulo">{g.titulo}</span>
        <span className="badge" style={{ background: COLOR[g.gravedad] }}>{formatNum(g.filas.length)}</span>
        <span className="revision__grav" style={{ color: COLOR[g.gravedad] }}>{GRAVEDAD_LABEL[g.gravedad]}</span>
      </button>
      {abierto && (
        <div className="revision__body">
          <p className="hlp" style={{ margin: '0 0 4px', fontSize: 12.5, color: 'var(--texto-2)' }}>
            {g.explicacion}
          </p>
          <p className="hlp" style={{ margin: '0 0 10px', fontSize: 12.5 }}>
            <strong>Cómo se corrige:</strong> {g.comoSeCorrige}
          </p>
          <div className="table-wrap">
            <table className="tbl tbl--revision">
              <tbody>
                {filas.map((f, i) => (
                  <tr key={`${f.categoria}-${f.codigo}-${i}`}>
                    <td className="codigo" style={{ whiteSpace: 'nowrap' }}>{f.codigo}</td>
                    <td className="revision__nombre">
                      {f.nombre}
                      <div className="hlp">{f.detalle}</div>
                    </td>
                    <td style={{ width: 1 }}><span className="pill">{CATEGORIA_LABEL[f.categoria]}</span></td>
                    <td className="actions" style={{ textAlign: 'right' }}>
                      {puedeEditar && (
                        <button
                          className="btn btn--sm btn--fila"
                          title={`Editar ${f.codigo}`}
                          onClick={() => onEditar(f.categoria, f.codigo)}
                        >
                          <Pencil className="btn__ico" size={14} />
                          <span className="btn__txt">Corregir</span>
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
