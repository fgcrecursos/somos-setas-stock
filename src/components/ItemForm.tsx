import { Boxes } from 'lucide-react';
import { useState } from 'react';
import {
  CATEGORIA_LABEL,
  VENCIMIENTO_CLASE,
  calcVencimiento,
  diasAvisoGuardado,
} from '../lib/helpers';
import { useStore } from '../lib/store';
import type { BaseItem, Categoria } from '../lib/types';
import { Modal } from './Modal';

interface Props {
  categoria: Categoria;
  initial?: any;
  onClose: () => void;
}

const usaTipoPres: Categoria[] = ['etiqueta', 'materia_prima'];

export function ItemForm({ categoria, initial, onClose }: Props) {
  const { state, upsertItem, guardando } = useStore();
  const editing = !!initial;
  const [item, setItem] = useState<any>(
    initial
      ? structuredClone(initial)
      : { codigo: '', nombre: '', actual: 0, minimo: 0, tipo: '', presentacion: '' }
  );
  const [error, setError] = useState('');
  const diasAviso = diasAvisoGuardado();
  const venc = calcVencimiento(item.vencimiento, diasAviso);

  function set(k: string, v: any) {
    setItem((prev: any) => ({ ...prev, [k]: v }));
  }

  async function guardar() {
    if (!item.codigo?.trim()) return setError('El código es obligatorio.');
    if (!item.nombre?.trim()) return setError('El nombre es obligatorio.');
    const lista = state[
      categoria === 'insumo'
        ? 'insumos'
        : categoria === 'insumo_interno'
        ? 'insumosInternos'
        : categoria === 'etiqueta'
        ? 'etiquetas'
        : 'materiaPrima'
    ] as BaseItem[];
    const dup = lista.find((x) => x.codigo === item.codigo && x.codigo !== initial?.codigo);
    if (dup) return setError(`Ya existe ${item.codigo} en ${CATEGORIA_LABEL[categoria]}.`);
    // Un campo de texto vacío se guarda como null y no como "": así la ficha no
    // se llena de cadenas vacías y el historial de ediciones no las cuenta.
    const limpio = { ...item };
    for (const campo of ['lote', 'proveedor', 'vencimiento', 'ubicacion', 'observaciones']) {
      if (typeof limpio[campo] === 'string' && !limpio[campo].trim()) limpio[campo] = null;
    }
    const res = await upsertItem(categoria, limpio, initial?.codigo);
    if (!res.ok) return setError(res.error ?? 'No se pudo guardar.');
    onClose();
  }

  return (
    <Modal
      title={editing ? `Editar ${initial.codigo}` : `Nuevo ${CATEGORIA_LABEL[categoria].toLowerCase()}`}
      icon={<Boxes size={20} color="var(--naranja)" />}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancelar</button>
          <button className="btn btn--primary" onClick={guardar} disabled={guardando}>
            {guardando ? 'Guardando…' : editing ? 'Guardar' : 'Crear'}
          </button>
        </>
      }
    >
      <div className="form-row">
        <div className="field">
          <label>Código *</label>
          <input className="input" value={item.codigo} onChange={(e) => set('codigo', e.target.value.toUpperCase())} />
        </div>
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

      <div className="form-row">
        <div className="field">
          <label>Stock actual</label>
          <input className="input" type="number" value={item.actual} onChange={(e) => set('actual', Number(e.target.value))} />
        </div>
        <div className="field">
          <label>Stock mínimo</label>
          <input className="input" type="number" value={item.minimo} onChange={(e) => set('minimo', Number(e.target.value))} />
        </div>
      </div>

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
