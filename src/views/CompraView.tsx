// =====================================================================
// LLEGÓ UNA COMPRA: suma etiquetas, envases, materia prima o insumos.
// Los productos terminados no entran por acá: suben solo al producirlos.
// =====================================================================
import { ArrowLeft, Check } from 'lucide-react';
import { useState } from 'react';
import { Contador, ElegirItem, FotoItem, Titulo } from '../components/Tareas';
import { cuanto, hay } from '../lib/frases';
import { buscarItem } from '../lib/helpers';
import { useStore } from '../lib/store';
import type { Categoria } from '../lib/types';

export function CompraView({ onSalir, onHistoria }: { onSalir: () => void; onHistoria: (cat: Categoria, codigo: string) => void }) {
  const { state, ingreso, guardando } = useStore();
  const [elegido, setElegido] = useState<{ categoria: Categoria; codigo: string } | null>(null);
  const [cant, setCant] = useState(1);
  const [hecho, setHecho] = useState<number | null>(null);
  const [error, setError] = useState('');
  const item = elegido ? (buscarItem(state, elegido.categoria, elegido.codigo) as any) : null;

  async function confirmar() {
    if (!elegido || !item) return;
    setError('');
    const r = await ingreso(elegido.categoria, elegido.codigo, cant);
    if (!r.ok) return setError(r.error || 'No se pudo guardar.');
    setHecho(item.actual + cant);
  }

  if (hecho != null && item && elegido)
    return (
      <div className="tarea tarea--listo">
        <span className="listo__marca"><Check size={44} strokeWidth={2.6} /></span>
        <h1>Listo, quedó anotado</h1>
        <p className="num">Ahora hay <strong>{hay(hecho, item)}</strong> de {item.nombre}.</p>
        <div className="tarea__acciones tarea__acciones--centro">
          <button className="btn-grande btn-grande--borde" onClick={() => { setHecho(null); setElegido(null); setCant(1); }}>Cargar otra cosa</button>
          <button className="btn-grande btn-grande--borde" onClick={() => onHistoria(elegido.categoria, elegido.codigo)}>Ver su historia</button>
          <button className="btn-grande" onClick={onSalir}>Volver al inicio</button>
        </div>
      </div>
    );

  if (!item || !elegido)
    return (
      <div className="tarea">
        <button className="volver" onClick={onSalir}><ArrowLeft size={22} /> Volver</button>
        <Titulo marcado="¿Qué" titulo="¿Qué llegó?" sub="Paso 1 de 2 · Elegí el tipo y tocá lo que entró" />
        <ElegirItem
          categorias={['materia_prima', 'etiqueta', 'insumo', 'insumo_interno']}
          pista="Escribí el nombre"
          onElegir={(categoria, it) => setElegido({ categoria, codigo: it.codigo })}
          extra={(_, it) => <>Hay <strong>{hay(it.actual, it as any)}</strong></>}
        />
      </div>
    );

  return (
    <div className="tarea">
      <button className="volver" onClick={() => setElegido(null)}><ArrowLeft size={22} /> Elegir otra cosa</button>
      <Titulo marcado="¿Cuánto" titulo="¿Cuánto llegó?" sub="Paso 2 de 2" />
      <div className="panel-producto">
        <FotoItem item={item} categoria={elegido.categoria} tam={110} />
        <div className="panel-producto__txt">
          <strong className="panel-producto__nombre">{item.nombre}</strong>
          <span className="subtitulo-marca">{item.unidad ? `Se cuenta en ${item.unidad}` : item.codigo}</span>
          <Contador valor={cant} onCambio={setCant} etiqueta="Cantidad que llegó" />
          <span className="num">Hoy hay {hay(item.actual, item)} · después va a haber <strong>{hay(item.actual + cant, item)}</strong></span>
        </div>
      </div>
      {error && <p className="aviso-fuerte" role="alert">{error}</p>}
      <div className="tarea__acciones">
        <button className="btn-grande btn-grande--borde" onClick={onSalir}>Cancelar</button>
        <button className="btn-grande" disabled={guardando || cant < 1} onClick={confirmar}>
          {guardando ? 'Guardando…' : `Sumar ${cuanto(cant, item)}`}
        </button>
      </div>
    </div>
  );
}
