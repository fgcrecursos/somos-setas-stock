// =====================================================================
// INICIO: "¿Qué querés registrar?"
// Cuatro botones grandes para las tareas del día, un buscador para ver la
// historia de cualquier cosa y lo último que pasó, contado en frases.
// =====================================================================
import { Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { FotoItem, Titulo } from '../components/Tareas';
import { useAuth } from '../lib/auth';
import { etiquetaDia, fraseDe, hora, trozos } from '../lib/frases';
import { buscarEnTodo, calcEstado, listaDe } from '../lib/helpers';
import { useStore } from '../lib/store';
import type { Categoria } from '../lib/types';

export type Tarea = 'producir' | 'salida' | 'compra' | 'contar';

const TAREAS: { id: Tarea; titulo: string; texto: string }[] = [
  { id: 'producir', titulo: 'Produje en el laboratorio', texto: 'Suma productos terminados y gasta lo que lleva la receta: etiqueta, envase y materia prima.' },
  { id: 'salida', titulo: 'Salió mercadería', texto: 'Venta fuera de la web, muestra o rotura. Solo resta el producto: la receta ya se gastó al producir.' },
  { id: 'compra', titulo: 'Llegó una compra', texto: 'Entraron etiquetas, envases, materia prima o insumos.' },
  { id: 'contar', titulo: 'Conté el estante', texto: 'Anoto cuántos hay de verdad. Si no coincide, queda escrita la diferencia.' },
];

export function InicioView({ onTarea, onHistoria }: { onTarea: (t: Tarea) => void; onHistoria: (cat: Categoria, codigo: string) => void }) {
  const { state, puedeEditar } = useStore();
  const { perfil } = useAuth();
  const [q, setQ] = useState('');

  const resultados = useMemo(() => (q.trim().length >= 2 ? buscarEnTodo(state, q).slice(0, 8) : []), [state, q]);
  const ultimos = useMemo(() => state.movimientos.filter((m) => m.tipo !== 'edicion').slice(0, 8).map((m) => fraseDe(m, state)), [state]);
  const negativos = useMemo(() => listaDe(state, 'producto').filter((p) => p.actual < 0).length, [state]);
  const bajos = useMemo(() => listaDe(state, 'producto').filter((p) => p.actual >= 0 && calcEstado(p.actual, p.minimo).faltan > 0).length, [state]);

  return (
    <div className="tarea inicio">
      <Titulo marcado="¿Qué querés" titulo="¿Qué querés registrar?" sub={perfil?.nombre ? `Hola, ${perfil.nombre}. Tocá una opción` : 'Tocá una opción'} />

      {puedeEditar ? (
        <div className="opciones-grandes opciones-grandes--4">
          {TAREAS.map((t, i) => (
            <button key={t.id} className="opcion-grande" onClick={() => onTarea(t.id)}>
              <span className="opcion-grande__num">0{i + 1}</span>
              <span className="opcion-grande__titulo">{t.titulo}</span>
              <span className="opcion-grande__txt">{t.texto}</span>
              <span className="opcion-grande__ir">Empezar →</span>
            </button>
          ))}
        </div>
      ) : (
        <p className="aviso-suave">Tu usuario puede mirar pero no registrar movimientos.</p>
      )}

      {negativos > 0 && (
        <p className="aviso-fuerte">
          Hay <strong>{negativos}</strong> productos en negativo: el sistema dice que hay menos de cero. Contá el estante para corregirlos.
          {puedeEditar && <button className="enlace" onClick={() => onTarea('contar')}>Contar ahora</button>}
        </p>
      )}

      <section className="bloque">
        <label className="bloque__etiqueta" htmlFor="buscar-historia">Ver la historia de algo</label>
        <div className="buscador-grande">
          <Search size={24} aria-hidden="true" />
          <input id="buscar-historia" type="search" placeholder="Escribí el nombre, por ejemplo «melena» o «etiqueta»" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        {resultados.length > 0 && (
          <div className="elegir__lista">
            {resultados.map((r: any) => (
              <button key={r.categoria + r.item.codigo} type="button" className="fila-item" onClick={() => onHistoria(r.categoria, r.item.codigo)}>
                <FotoItem item={r.item} categoria={r.categoria} tam={44} />
                <span className="fila-item__txt"><strong>{r.item.nombre}</strong><span>{r.item.codigo}</span></span>
                <span className="fila-item__stock num">Hay <strong>{r.item.actual}</strong></span>
              </button>
            ))}
          </div>
        )}
      </section>

      <section className="bloque">
        <div className="bloque__cabeza">
          <h2>Lo último que pasó</h2>
          {bajos > 0 && <span className="nota-chica">{bajos} productos están por debajo del mínimo</span>}
        </div>
        {ultimos.length === 0 && <p className="nota-chica">Todavía no hay movimientos.</p>}
        {ultimos.map((f) => (
          <button key={f.id} type="button" className={'evento num' + (f.diferencia ? ' evento--dif' : '')} onClick={() => onHistoria(f.mov.categoria, f.mov.codigo)}>
            <span className="evento__hora">{etiquetaDia(f.fecha).split(',')[0]} {hora(f.fecha)}</span>
            <span className="evento__txt">
              <span>{f.mov.nombre}: {trozos(f.titulo).map((p, i) => (p.b ? <strong key={i}>{p.t}</strong> : <span key={i}>{p.t}</span>))}</span>
              {f.detalle && <small>{f.detalle}</small>}
            </span>
            <span className="evento__stock">{f.antes != null && f.despues != null && <>{f.antes} → <strong>{f.despues}</strong></>}</span>
          </button>
        ))}
      </section>
    </div>
  );
}
