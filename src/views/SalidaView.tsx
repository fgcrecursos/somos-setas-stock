// =====================================================================
// SALIÓ MERCADERÍA (venta fuera de la tienda, muestra, rotura)
// Solo resta el producto terminado: la receta ya se gastó al producirlo.
// Las ventas de la tienda web y los remitos del panel se descuentan solos.
// =====================================================================
import { ArrowLeft, Check } from 'lucide-react';
import { useState } from 'react';
import { Contador, ElegirItem, FotoItem, Titulo } from '../components/Tareas';
import { formatNum } from '../lib/helpers';
import { useStore } from '../lib/store';

type Motivo = 'venta' | 'uso' | 'rotura';
const MOTIVOS: { id: Motivo; titulo: string; texto: string }[] = [
  { id: 'venta', titulo: 'Se vendió', texto: 'Venta en feria, local o a mano. Las de la tienda web se descuentan solas.' },
  { id: 'uso', titulo: 'Muestra o uso nuestro', texto: 'Regalo, muestra, prueba o lo usamos nosotros. No cuenta como venta.' },
  { id: 'rotura', titulo: 'Se rompió o venció', texto: 'Ya no se puede vender. Queda anotado el motivo.' },
];

export function SalidaView({ onSalir, onHistoria }: { onSalir: () => void; onHistoria: (codigo: string) => void }) {
  const { state, vender, consumoInterno, guardando } = useStore();
  const [motivo, setMotivo] = useState<Motivo | null>(null);
  const [codigo, setCodigo] = useState<string | null>(null);
  const [cant, setCant] = useState(1);
  const [nota, setNota] = useState('');
  const [hecho, setHecho] = useState<number | null>(null);
  const [error, setError] = useState('');
  const producto = state.productos.find((p) => p.codigo === codigo);

  async function confirmar() {
    if (!producto || !motivo) return;
    setError('');
    let ok: boolean;
    let err: string | undefined;
    if (motivo === 'venta') {
      const r = await vender(producto.codigo, cant, nota.trim() || undefined);
      ok = r.ok;
      err = r.error ?? r.mensaje;
    } else {
      const txt = motivo === 'rotura' ? `Se rompió o venció${nota.trim() ? ': ' + nota.trim() : ''}` : nota.trim() || 'Muestra o uso nuestro';
      const r = await consumoInterno('producto', producto.codigo, cant, txt);
      ok = r.ok;
      err = r.error;
    }
    if (!ok) return setError(err || 'No se pudo guardar.');
    setHecho(producto.actual - cant);
  }

  if (hecho != null && producto)
    return (
      <div className="tarea tarea--listo">
        <span className="listo__marca"><Check size={44} strokeWidth={2.6} /></span>
        <h1>Listo, quedó anotado</h1>
        <p className="num">{producto.nombre} ahora tiene <strong>{formatNum(hecho)}</strong>.</p>
        {hecho < 0 && <p className="aviso-fuerte">Quedó en negativo: según el sistema no había tantos. Conviene contar el estante.</p>}
        <div className="tarea__acciones tarea__acciones--centro">
          <button className="btn-grande btn-grande--borde" onClick={() => { setHecho(null); setCodigo(null); setCant(1); setNota(''); }}>Anotar otra salida</button>
          <button className="btn-grande btn-grande--borde" onClick={() => onHistoria(producto.codigo)}>Ver su historia</button>
          <button className="btn-grande" onClick={onSalir}>Volver al inicio</button>
        </div>
      </div>
    );

  if (!motivo)
    return (
      <div className="tarea">
        <button className="volver" onClick={onSalir}><ArrowLeft size={22} /> Volver</button>
        <Titulo marcado="¿Por qué" titulo="¿Por qué salió?" sub="Paso 1 de 3" />
        <div className="opciones-grandes">
          {MOTIVOS.map((m, i) => (
            <button key={m.id} className="opcion-grande" onClick={() => setMotivo(m.id)}>
              <span className="opcion-grande__num">0{i + 1}</span>
              <span className="opcion-grande__titulo">{m.titulo}</span>
              <span className="opcion-grande__txt">{m.texto}</span>
            </button>
          ))}
        </div>
      </div>
    );

  if (!producto)
    return (
      <div className="tarea">
        <button className="volver" onClick={() => setMotivo(null)}><ArrowLeft size={22} /> Cambiar el motivo</button>
        <Titulo marcado="¿Qué" titulo="¿Qué producto salió?" sub="Paso 2 de 3 · Tocá el producto" />
        <ElegirItem categorias={['producto']} pista="Escribí el nombre del producto" onElegir={(_, it) => setCodigo(it.codigo)} />
      </div>
    );

  const m = MOTIVOS.find((x) => x.id === motivo)!;
  return (
    <div className="tarea">
      <button className="volver" onClick={() => setCodigo(null)}><ArrowLeft size={22} /> Elegir otro producto</button>
      <Titulo marcado="¿Cuántos" titulo="¿Cuántos salieron?" sub={`Paso 3 de 3 · ${m.titulo}`} />
      <div className="panel-producto">
        <FotoItem item={producto} categoria="producto" tam={130} />
        <div className="panel-producto__txt">
          <strong className="panel-producto__nombre">{producto.nombre}</strong>
          <span className="subtitulo-marca">{[producto.tipo, producto.presentacion].filter(Boolean).join(' · ')}</span>
          <Contador valor={cant} onCambio={setCant} etiqueta="Cantidad que salió" />
          <span className="num">Hoy hay {formatNum(producto.actual)} · después van a quedar <strong>{formatNum(producto.actual - cant)}</strong></span>
        </div>
      </div>
      <label className="campo-grande">
        <span>{motivo === 'venta' ? 'A quién o dónde (si querés)' : '¿Qué pasó? (si querés)'}</span>
        <input value={nota} onChange={(e) => setNota(e.target.value)} placeholder={motivo === 'venta' ? 'Por ejemplo: feria del sábado' : 'Por ejemplo: muestra para un local'} />
      </label>
      <p className="nota-chica">Solo se resta el producto. Etiquetas, envases y materia prima no cambian: ya se descontaron al producirlo.</p>
      {error && <p className="aviso-fuerte" role="alert">{error}</p>}
      <div className="tarea__acciones">
        <button className="btn-grande btn-grande--borde" onClick={onSalir}>Cancelar</button>
        <button className="btn-grande" disabled={guardando || cant < 1} onClick={confirmar}>
          {guardando ? 'Guardando…' : `Anotar ${formatNum(cant)}`}
        </button>
      </div>
    </div>
  );
}
