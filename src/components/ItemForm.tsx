import { Boxes, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { problemaConCodigo, siguienteCodigo } from '../lib/codigos';
import {
  UNIDADES,
  VENCIMIENTO_CLASE,
  abrevUnidad,
  calcVencimiento,
  diasAvisoGuardado,
} from '../lib/helpers';
import { useStore, type MotivoStock } from '../lib/store';
import type { Categoria } from '../lib/types';
import { CampoCodigo } from './CampoCodigo';
import { Modal } from './Modal';
import { MotivoStockSelector, opcionesMotivo } from './MotivoStock';
import { useToast } from './Toast';

interface Props {
  categoria: Categoria;
  initial?: any;
  onClose: () => void;
  /** Sólo en edición: abre la confirmación de baja del ítem */
  onEliminar?: () => void;
}

const usaTipoPres: Categoria[] = ['etiqueta', 'materia_prima'];

/** "Nueva etiqueta", "Nuevo insumo": el título del alta concuerda en género */
const TITULO_NUEVO: Record<Categoria, string> = {
  producto: 'Nuevo producto',
  insumo: 'Nuevo insumo',
  insumo_interno: 'Nuevo insumo interno',
  etiqueta: 'Nueva etiqueta',
  materia_prima: 'Nueva materia prima',
};

export function ItemForm({ categoria, initial, onClose, onEliminar }: Props) {
  const { state, upsertItem, guardando } = useStore();
  const toast = useToast();
  const editing = !!initial;
  // El stock que se vio al abrir: contra eso se mide si la persona lo cambió
  const [actualVisto] = useState<number>(() => Number(initial?.actual) || 0);
  const [motivo, setMotivo] = useState<MotivoStock | null>(null);
  const [item, setItem] = useState<any>(
    initial
      ? structuredClone(initial)
      : { codigo: '', nombre: '', actual: 0, minimo: 0, tipo: '', presentacion: '' }
  );
  const [error, setError] = useState('');
  // El código lo pone la app salvo que se pida escribirlo a mano
  const [codigoManual, setCodigoManual] = useState(false);
  const diasAviso = diasAvisoGuardado();
  const venc = calcVencimiento(item.vencimiento, diasAviso);

  // Las etiquetas siguen la serie del producto que etiquetan (ETQ-CAP-31), así
  // que el código propuesto cambia con el tipo; el resto va por categoría.
  const sugerido = useMemo(
    () => (editing ? '' : siguienteCodigo(state, categoria, item.tipo)),
    [state, categoria, item.tipo, editing]
  );
  useEffect(() => {
    if (editing || codigoManual) return;
    setItem((prev: any) => (prev.codigo === sugerido ? prev : { ...prev, codigo: sugerido }));
  }, [sugerido, codigoManual, editing]);

  function set(k: string, v: any) {
    setItem((prev: any) => ({ ...prev, [k]: v }));
  }

  const cambiaStock = editing && Number(item.actual) !== actualVisto;

  // Si el número cambia de sentido (sumaba y ahora resta), el motivo elegido
  // puede dejar de valer: "entró mercadería" no explica una baja.
  const deltaStock = Number(item.actual) - actualVisto;
  useEffect(() => {
    if (motivo && !opcionesMotivo(categoria, deltaStock).some((o) => o.id === motivo))
      setMotivo(null);
  }, [categoria, deltaStock, motivo]);

  async function guardar() {
    const codigo = String(item.codigo ?? '').trim();
    if (!item.nombre?.trim()) return setError('El nombre es obligatorio.');
    // El código se valida sólo si es nuevo o si se cambió: los códigos viejos
    // con espacios ("POL- 39") siguen pudiendo editarse sin tocarlos.
    if (!editing || codigo !== initial.codigo) {
      const problema = problemaConCodigo(
        state,
        codigo,
        editing ? { categoria, codigo: initial.codigo } : undefined
      );
      if (problema) return setError(problema);
    }
    if (!Number.isFinite(Number(item.actual))) return setError('El stock tiene que ser un número.');
    if (cambiaStock && !motivo) return setError('Elegí por qué cambia el stock.');
    // Un campo de texto vacío se guarda como null y no como "": así la ficha no
    // se llena de cadenas vacías y el historial de ediciones no las cuenta.
    const limpio = { ...item, codigo, actual: Number(item.actual) || 0 };
    for (const campo of ['lote', 'proveedor', 'vencimiento', 'ubicacion', 'observaciones', 'unidad']) {
      if (typeof limpio[campo] === 'string' && !limpio[campo].trim()) limpio[campo] = null;
    }
    const res = await upsertItem(categoria, limpio, initial?.codigo, {
      actualVisto: editing ? actualVisto : undefined,
      motivoStock: cambiaStock ? motivo ?? undefined : undefined,
    });
    if (!res.ok) return setError(res.error ?? 'No se pudo guardar.');
    if (res.aviso) toast(res.aviso, true);
    onClose();
  }

  return (
    <Modal
      title={editing ? `Editar ${initial.codigo}` : TITULO_NUEVO[categoria]}
      icon={<Boxes size={20} color="var(--naranja)" />}
      onClose={onClose}
      footer={
        <>
          {editing && onEliminar && (
            <button
              className="btn btn--peligro"
              style={{ marginRight: 'auto' }}
              onClick={onEliminar}
              disabled={guardando}
            >
              <Trash2 size={15} /> Eliminar
            </button>
          )}
          <button className="btn" onClick={onClose}>Cancelar</button>
          <button className="btn btn--primary" onClick={guardar} disabled={guardando}>
            {guardando ? 'Guardando…' : editing ? 'Guardar' : 'Crear'}
          </button>
        </>
      }
    >
      <div className="form-row">
        <CampoCodigo
          valor={item.codigo}
          sugerido={sugerido}
          manual={codigoManual}
          onManual={(m) => {
            setCodigoManual(m);
            if (!m) set('codigo', sugerido);
          }}
          onChange={(c) => set('codigo', c)}
          editando={editing}
        />
        <div className="field">
          <label>Nombre *</label>
          <input className="input" value={item.nombre} onChange={(e) => set('nombre', e.target.value)} />
        </div>
      </div>

      {usaTipoPres.includes(categoria) && (
        <div className="form-row">
          <div className="field">
            <label>Tipo</label>
            <input className="input" value={item.tipo ?? ''} onChange={(e) => set('tipo', e.target.value)} />
          </div>
          <div className="field">
            <label>Presentación</label>
            <input className="input" value={item.presentacion ?? ''} onChange={(e) => set('presentacion', e.target.value)} />
          </div>
        </div>
      )}

      {/* La unidad va pegada al stock porque es lo que le da sentido al número:
          "120" no dice nada, "120 kg" sí. */}
      <div className={categoria === 'materia_prima' ? 'form-row-3' : 'form-row'}>
        <div className="field">
          <label>Stock actual</label>
          <input className="input" type="number" value={item.actual} onChange={(e) => set('actual', Number(e.target.value))} />
        </div>
        <div className="field">
          <label>Stock mínimo</label>
          <input className="input" type="number" value={item.minimo} onChange={(e) => set('minimo', Number(e.target.value))} />
        </div>
        {categoria === 'materia_prima' && (
          <div className="field">
            <label>Unidad de medida</label>
            <select
              className="select"
              value={item.unidad ?? ''}
              onChange={(e) => set('unidad', e.target.value || null)}
            >
              <option value="">Sin especificar</option>
              {UNIDADES.map((u) => (
                <option key={u.valor} value={u.valor}>
                  {u.label} ({u.valor})
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {categoria === 'materia_prima' && (
        <p className="hlp" style={{ marginTop: -6 }}>
          Es la etiqueta del número: el stock y el mínimo se leen en esta unidad. No convierte
          nada — una receta que pide 1 de esta materia prima pide 1 {abrevUnidad(item.unidad) || 'unidad'}.
        </p>
      )}
      {categoria === 'materia_prima' &&
        editing &&
        abrevUnidad(item.unidad) !== abrevUnidad(initial.unidad) &&
        state.productos.some((p) =>
          p.bom.some((b) => b.categoria === 'materia_prima' && b.codigo === initial.codigo)
        ) && (
          <p className="hlp bom-line__info--ojo" style={{ marginTop: -4 }}>
            Ojo: cambiar la unidad acá no convierte el stock ni las recetas que la usan. Para pasar
            a gramos usá "Conteo materia prima", que guarda el conteo y las recetas juntos.
          </p>
        )}

      {editing && (
        <MotivoStockSelector
          categoria={categoria}
          visto={actualVisto}
          nuevo={Number(item.actual)}
          motivo={motivo}
          onChange={setMotivo}
        />
      )}
      {editing && String(item.codigo ?? '').trim() !== initial.codigo && (
        <p className="hlp" style={{ marginTop: -4 }}>
          Cambia el código de {initial.codigo} a {String(item.codigo ?? '').trim() || '…'}: las
          recetas que lo usan y los vínculos con la tienda se actualizan solos.
        </p>
      )}

      {(categoria === 'insumo' || categoria === 'insumo_interno') && (
        <div className="form-row">
          <div className="field">
            <label>Cantidad por pack</label>
            <input className="input" type="number" value={item.cantidadPorPack ?? ''} onChange={(e) => set('cantidadPorPack', Number(e.target.value))} />
          </div>
          <div className="field">
            <label>Packs de compra</label>
            <input className="input" type="number" value={item.packDeCompra ?? ''} onChange={(e) => set('packDeCompra', Number(e.target.value))} />
          </div>
        </div>
      )}

      {categoria === 'materia_prima' && (
        <>
          <div className="form-row">
            <div className="field">
              <label>Lote</label>
              <input
                className="input"
                placeholder="Ej: L-2026-014"
                value={item.lote ?? ''}
                onChange={(e) => set('lote', e.target.value)}
              />
            </div>
            <div className="field">
              <label>Proveedor</label>
              <input
                className="input"
                value={item.proveedor ?? ''}
                onChange={(e) => set('proveedor', e.target.value)}
              />
            </div>
          </div>
          <div className="field">
            <label>Vencimiento</label>
            <input
              className="input"
              type="date"
              value={item.vencimiento ?? ''}
              onChange={(e) => set('vencimiento', e.target.value)}
            />
            {venc ? (
              <p className="hlp" style={{ marginTop: 6 }}>
                <span className={`badge-estado ${VENCIMIENTO_CLASE[venc.estado]}`}>{venc.label}</span>{' '}
                Se avisa en el Dashboard desde {diasAviso} días antes.
              </p>
            ) : (
              <p className="hlp" style={{ marginTop: 6 }}>
                Cargá la fecha y el sistema avisa solo cuando falten {diasAviso} días o menos.
              </p>
            )}
          </div>
        </>
      )}

      {error && (
        <div className="badge-estado st-agotado" style={{ marginTop: 12, padding: '9px 12px', borderRadius: 10 }}>{error}</div>
      )}
    </Modal>
  );
}
