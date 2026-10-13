// =====================================================================
// PRODUJE EN EL LABORATORIO
// Paso 1: qué producto. Paso 2: cuántos, viendo qué se va a usar de la
// receta y si alcanza. Paso 3: listo, en palabras.
// La base arma el descuento de la receta por su cuenta (st_aplicar v2):
// lo que se muestra acá es el aviso previo, no lo que manda.
// =====================================================================
import { ArrowLeft, Check } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Contador, ElegirItem, FotoItem, Titulo } from '../components/Tareas';
import { cuanto, hay } from '../lib/frases';
import { buscarItem, formatNum } from '../lib/helpers';
import { useStore } from '../lib/store';
import type { Producto } from '../lib/types';

export function ProducirView({ onSalir, onHistoria }: { onSalir: () => void; onHistoria: (codigo: string) => void }) {
  const { state, producir, guardando } = useStore();
  const [codigo, setCodigo] = useState<string | null>(null);
  const [cant, setCant] = useState(1);
  const [hecho, setHecho] = useState<{ quedan: number; avisos: string[] } | null>(null);
  const [error, setError] = useState('');

  const producto = state.productos.find((p) => p.codigo === codigo) as Producto | undefined;

  const lineas = useMemo(() => {
    if (!producto) return [];
    const agrupado = new Map<string, { categoria: any; codigo: string; cantidad: number }>();
    for (const b of producto.bom) {
      const k = b.categoria + '|' + b.codigo;
      const prev = agrupado.get(k);
      agrupado.set(k, { ...b, cantidad: (prev?.cantidad ?? 0) + Number(b.cantidad || 0) });
    }
    return [...agrupado.values()].map((b) => {
      const comp = buscarItem(state, b.categoria, b.codigo) as any;
      const usa = b.cantidad * cant;
      return {
        clave: b.categoria + b.codigo,
        nombre: comp?.nombre ?? b.codigo,
        codigo: b.codigo,
        usa: cuanto(usa, comp),
        hay: comp?.actual,
        alcanza: comp ? comp.actual >= usa : false,
        existe: !!comp,
        unidad: comp?.unidad,
      };
    });
  }, [producto, cant, state]);

  async function confirmar() {
    if (!producto) return;
    setError('');
    const r = await producir(producto.codigo, cant);
    if (!r.ok) {
      setError(r.error ?? r.mensaje);
      return;
    }
    setHecho({ quedan: r.producto?.actual ?? producto.actual + cant, avisos: r.alertas });
  }

  if (hecho && producto)
    return (
      <div className="tarea tarea--listo">
        <span className="listo__marca"><Check size={44} strokeWidth={2.6} /></span>
        <h1>Listo, quedó anotado</h1>
        <p className="num">
          {producto.nombre} ahora tiene <strong>{formatNum(hecho.quedan)}</strong>. Ya se descontó lo que lleva la receta.
        </p>
        {hecho.avisos.length > 0 && (
          <ul className="listo__avisos">
            {hecho.avisos.map((a) => <li key={a}>{a}</li>)}
          </ul>
        )}
        <div className="tarea__acciones tarea__acciones--centro">
          <button className="btn-grande btn-grande--borde" onClick={() => { setHecho(null); setCodigo(null); setCant(1); }}>
            Registrar otra producción
          </button>
          <button className="btn-grande btn-grande--borde" onClick={() => onHistoria(producto.codigo)}>Ver su historia</button>
          <button className="btn-grande" onClick={onSalir}>Volver al inicio</button>
        </div>
      </div>
    );

  if (!producto)
    return (
      <div className="tarea">
        <button className="volver" onClick={onSalir}><ArrowLeft size={22} /> Volver</button>
        <Titulo marcado="¿Qué" titulo="¿Qué produjiste?" sub="Paso 1 de 2 · Tocá el producto" />
        <ElegirItem categorias={['producto']} pista="Escribí el nombre, por ejemplo «melena»" onElegir={(_, it) => setCodigo(it.codigo)} />
      </div>
    );

  const noAlcanza = lineas.filter((l) => !l.alcanza);

  return (
    <div className="tarea">
      <button className="volver" onClick={() => setCodigo(null)}><ArrowLeft size={22} /> Elegir otro producto</button>
      <Titulo marcado="¿Cuántos" titulo="¿Cuántos hiciste?" sub="Paso 2 de 2" />

      <div className="tarea__dos">
        <div className="panel-producto">
          <FotoItem item={producto} categoria="producto" tam={130} />
          <div className="panel-producto__txt">
            <strong className="panel-producto__nombre">{producto.nombre}</strong>
            <span className="subtitulo-marca">{[producto.tipo, producto.presentacion].filter(Boolean).join(' · ')}</span>
            <Contador valor={cant} onCambio={setCant} etiqueta="Cantidad producida" />
            <span className="num">Hoy hay {formatNum(producto.actual)} · después van a quedar <strong>{formatNum(producto.actual + cant)}</strong></span>
          </div>
        </div>

        <div className="receta-previa">
          <h2>Se va a usar de la receta</h2>
          {lineas.length === 0 && (
            <p className="aviso-suave">Este producto no tiene receta cargada: no se va a descontar nada más. Conviene cargarla en Productos.</p>
          )}
          {lineas.map((l) => (
            <div key={l.clave} className="receta-previa__fila num">
              <span className="receta-previa__nombre">
                {l.nombre}
                <small className={l.alcanza ? '' : 'falta'}>
                  {!l.existe
                    ? 'No está en el inventario: no se va a descontar'
                    : l.alcanza
                      ? `Hay ${hay(l.hay, l as any)}`
                      : `No alcanza: hay ${hay(l.hay, l as any)}`}
                </small>
              </span>
              <strong>{l.usa}</strong>
            </div>
          ))}
          <p className="nota-chica">Cuando estos se vendan, la receta no se vuelve a descontar.</p>
        </div>
      </div>

      {noAlcanza.length > 0 && (
        <p className="aviso-fuerte">
          Según el sistema no alcanza {noAlcanza.map((l) => l.nombre).join(', ')}. Si igual lo hiciste, registralo: después
          contá esos componentes para corregir el número.
        </p>
      )}
      {error && <p className="aviso-fuerte" role="alert">{error}</p>}

      <div className="tarea__acciones">
        <button className="btn-grande btn-grande--borde" onClick={onSalir}>Cancelar</button>
        <button className="btn-grande" disabled={guardando || cant < 1} onClick={confirmar}>
          {guardando ? 'Guardando…' : `Registrar ${formatNum(cant)}`}
        </button>
      </div>
    </div>
  );
}
