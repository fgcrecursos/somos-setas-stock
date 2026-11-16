// =====================================================================
// LLEGÓ UNA COMPRA: suma etiquetas, envases, materia prima o insumos.
// Los productos terminados no entran por acá: suben solo al producirlos.
//
// Se carga como llega: "2 bolsas de 5 kg", "3 packs de 100". La cuenta a la
// unidad del stock (gramos, unidades) la hace el sistema con lo que trae cada
// envase, y en el historial queda anotado cómo entró y de quién.
// =====================================================================
import { ArrowLeft, Check } from 'lucide-react';
import { useState } from 'react';
import { Contador, ElegirItem, FotoItem, Titulo } from '../components/Tareas';
import { motivoPendiente } from '../lib/conteoMP';
import { cuanto, hay } from '../lib/frases';
import { buscarItem, formatNum } from '../lib/helpers';
import { useStore } from '../lib/store';
import type { Categoria, MateriaPrima } from '../lib/types';

/** Cuánto trae un envase o pack de compra de este ítem, en la unidad de su stock */
export function porEnvase(categoria: Categoria, item: any): number | null {
  const n = Number(categoria === 'materia_prima' ? item?.contenidoEnvase : item?.cantidadPorPack);
  return Number.isFinite(n) && n > 1 ? n : null;
}

export function CompraView({ onSalir, onHistoria }: { onSalir: () => void; onHistoria: (cat: Categoria, codigo: string) => void }) {
  const { state, ingreso, guardando } = useStore();
  const [elegido, setElegido] = useState<{ categoria: Categoria; codigo: string } | null>(null);
  const [cant, setCant] = useState(1);
  const [suelto, setSuelto] = useState(false);
  const [origen, setOrigen] = useState('');
  const [hecho, setHecho] = useState<number | null>(null);
  const [error, setError] = useState('');
  const item = elegido ? (buscarItem(state, elegido.categoria, elegido.codigo) as any) : null;

  const envase = item && elegido ? porEnvase(elegido.categoria, item) : null;
  const esMP = elegido?.categoria === 'materia_prima';
  const nombreEnvase = esMP ? 'envases' : 'packs';
  const porEnvases = envase != null && !suelto;
  const total = porEnvases ? cant * envase! : cant;
  // Materia prima que todavía no está en gramos: sumarle no la arregla
  const sinPasar = esMP && item ? motivoPendiente(state, item as MateriaPrima) : null;

  function reiniciar() {
    setHecho(null);
    setElegido(null);
    setCant(1);
    setSuelto(false);
    setOrigen('');
    setError('');
  }

  async function confirmar() {
    if (!elegido || !item) return;
    setError('');
    const como = porEnvases
      ? `Llegaron ${formatNum(cant)} ${nombreEnvase} de ${cuanto(envase!, item)}: ${cuanto(total, item)}`
      : `Llegaron ${cuanto(total, item)}`;
    const nota = origen.trim() ? `${como} · ${origen.trim()}` : como;
    const r = await ingreso(elegido.categoria, elegido.codigo, total, nota);
    if (!r.ok) return setError(r.error || 'No se pudo guardar.');
    setHecho(item.actual + total);
  }

  if (hecho != null && item && elegido)
    return (
      <div className="tarea tarea--listo">
        <span className="listo__marca"><Check size={44} strokeWidth={2.6} /></span>
        <h1>Listo, quedó anotado</h1>
        <p className="num">Ahora hay <strong>{hay(hecho, item)}</strong> de {item.nombre}.</p>
        <div className="tarea__acciones tarea__acciones--centro">
          <button className="btn-grande btn-grande--borde" onClick={reiniciar}>Cargar otra cosa</button>
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
          onElegir={(categoria, it) => {
            setElegido({ categoria, codigo: it.codigo });
            setCant(1);
            setSuelto(false);
          }}
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

          {envase != null && (
            <div className="elegir__cats" role="group" aria-label="Cómo llegó">
              <button type="button" className={'opcion-chica' + (!suelto ? ' opcion-chica--activa' : '')} onClick={() => { setSuelto(false); setCant(1); }}>
                Por {esMP ? 'envase' : 'pack'} de {cuanto(envase, item)}
              </button>
              <button type="button" className={'opcion-chica' + (suelto ? ' opcion-chica--activa' : '')} onClick={() => { setSuelto(true); setCant(1); }}>
                Suelto
              </button>
            </div>
          )}

          <Contador
            valor={cant}
            onCambio={setCant}
            etiqueta={porEnvases ? `Cuántos ${nombreEnvase} llegaron` : 'Cantidad que llegó'}
          />
          {porEnvases && (
            <span className="num">
              {formatNum(cant)} {nombreEnvase} × {cuanto(envase!, item)} = <strong>{cuanto(total, item)}</strong>
            </span>
          )}
          <span className="num">Hoy hay {hay(item.actual, item)} · después va a haber <strong>{hay(item.actual + total, item)}</strong></span>

          <label className="campo-compra">
            <span>De quién o con qué remito (opcional)</span>
            <input
              type="text"
              value={origen}
              maxLength={120}
              placeholder="Proveedor, número de remito, lote…"
              onChange={(e) => setOrigen(e.target.value)}
            />
          </label>
        </div>
      </div>

      {sinPasar && (
        <p className="aviso-fuerte" role="status">
          Ojo: {item.nombre} todavía no está pasada a gramos ({sinPasar.toLowerCase()}). La compra se
          suma igual, pero el número no va a cerrar hasta contarla en “Conteo materia prima”.
        </p>
      )}
      {esMP && !sinPasar && envase == null && (
        <p className="nota-chica">
          Se carga en {item.unidad}. Si siempre llega en el mismo envase, cargá cuánto trae en
          “Conteo materia prima” y acá vas a poder anotar los envases.
        </p>
      )}
      {error && <p className="aviso-fuerte" role="alert">{error}</p>}
      <div className="tarea__acciones">
        <button className="btn-grande btn-grande--borde" onClick={onSalir}>Cancelar</button>
        <button className="btn-grande" disabled={guardando || cant < 1} onClick={confirmar}>
          {guardando ? 'Guardando…' : `Sumar ${cuanto(total, item)}`}
        </button>
      </div>
    </div>
  );
}
