import { Plus, Trash2, Package } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { problemaConCodigo, siguienteCodigo } from '../lib/codigos';
import { abrevUnidad, buscarItem, CATEGORIA_LABEL, formatNum, listaDe } from '../lib/helpers';
import { useStore, type MotivoStock } from '../lib/store';
import type { BomItem, CategoriaComponente, Producto } from '../lib/types';
import { CampoCodigo } from './CampoCodigo';
import { ItemPicker } from './ItemPicker';
import { Modal } from './Modal';
import { MotivoStockSelector, opcionesMotivo } from './MotivoStock';
import { useToast } from './Toast';

const TIPOS = ['Aceite', 'Cápsulas', 'Extracto', 'Polvo', 'Setas'];
const CATS_COMP: CategoriaComponente[] = [
  'etiqueta',
  'insumo',
  'materia_prima',
  'insumo_interno',
];

interface Props {
  initial?: Producto;
  onClose: () => void;
  /** Sólo en edición: abre la confirmación de baja del producto */
  onEliminar?: () => void;
}

export function ProductForm({ initial, onClose, onEliminar }: Props) {
  const { state, upsertProducto, guardando } = useStore();
  const toast = useToast();
  const editing = !!initial;
  // El stock que se vio al abrir: contra eso se mide si la persona lo cambió
  const [actualVisto] = useState<number>(() => Number(initial?.actual) || 0);
  const [motivo, setMotivo] = useState<MotivoStock | null>(null);
  const [p, setP] = useState<Producto>(
    initial
      ? structuredClone(initial)
      : {
          codigo: '',
          nombre: '',
          tipo: 'Cápsulas',
          presentacion: '',
          actual: 0,
          minimo: 0,
          bom: [],
        }
  );
  const [error, setError] = useState('');
  // El código lo pone la app salvo que se pida escribirlo a mano
  const [codigoManual, setCodigoManual] = useState(false);

  // Cada tipo tiene su serie (ACE, CAP, EXT, POL, ENT): si se cambia el tipo
  // antes de guardar, el código propuesto se acomoda solo.
  const sugerido = useMemo(
    () => (editing ? '' : siguienteCodigo(state, 'producto', p.tipo)),
    [state, p.tipo, editing]
  );
  useEffect(() => {
    if (editing || codigoManual) return;
    setP((prev) => (prev.codigo === sugerido ? prev : { ...prev, codigo: sugerido }));
  }, [sugerido, codigoManual, editing]);

  function set<K extends keyof Producto>(k: K, v: Producto[K]) {
    setP((prev) => ({ ...prev, [k]: v }));
  }

  function addBom() {
    setP((prev) => ({
      ...prev,
      bom: [...prev.bom, { categoria: 'etiqueta', codigo: '', cantidad: 1 }],
    }));
  }
  function updBom(i: number, patch: Partial<BomItem>) {
    setP((prev) => {
      const bom = [...prev.bom];
      bom[i] = { ...bom[i], ...patch };
      return { ...prev, bom };
    });
  }
  function delBom(i: number) {
    setP((prev) => ({ ...prev, bom: prev.bom.filter((_, idx) => idx !== i) }));
  }

  const cambiaStock = editing && Number(p.actual) !== actualVisto;
  const deltaStock = Number(p.actual) - actualVisto;
  // Si el número cambia de sentido, el motivo elegido puede dejar de valer
  useEffect(() => {
    if (motivo && !opcionesMotivo('producto', deltaStock).some((o) => o.id === motivo))
      setMotivo(null);
  }, [deltaStock, motivo]);

  async function guardar() {
    const codigo = p.codigo.trim();
    if (!p.nombre.trim()) return setError('El nombre es obligatorio.');
    // El código se valida sólo si es nuevo o si se cambió (ver ItemForm)
    if (!editing || codigo !== initial!.codigo) {
      const problema = problemaConCodigo(
        state,
        codigo,
        editing ? { categoria: 'producto', codigo: initial!.codigo } : undefined
      );
      if (problema) return setError(problema);
    }
    if (!Number.isFinite(Number(p.actual))) return setError('El stock tiene que ser un número.');
    if (cambiaStock && !motivo) return setError('Elegí por qué cambia el stock.');

    // La receta no puede quedar rota: cada componente tiene que existir en el
    // inventario y consumir una cantidad mayor a cero. Así el descuento al
    // producir nunca se saltea en silencio.
    const bom = p.bom.filter((b) => b.codigo);
    const vistos = new Set<string>();
    const repetidos = bom.filter((b) => {
      const k = `${b.categoria}|${b.codigo}`;
      if (vistos.has(k)) return true;
      vistos.add(k);
      return false;
    });
    if (repetidos.length) {
      return setError(
        `${repetidos.map((b) => b.codigo).join(', ')} está dos veces en la receta: dejalo en una sola línea con la cantidad total.`
      );
    }
    const noExisten = bom.filter((b) => !buscarItem(state, b.categoria, b.codigo));
    if (noExisten.length) {
      return setError(
        `Estos componentes de la receta no están en el inventario: ${noExisten
          .map((b) => b.codigo)
          .join(', ')}. Elegilos de la lista.`
      );
    }
    const sinCantidad = bom.filter((b) => !(Number(b.cantidad) > 0));
    if (sinCantidad.length) {
      return setError(
        `Poné una cantidad mayor a cero en: ${sinCantidad
          .map((b) => b.codigo)
          .join(', ')}.`
      );
    }

    const res = await upsertProducto(
      { ...p, codigo, actual: Number(p.actual) || 0, bom },
      initial?.codigo,
      {
        actualVisto: editing ? actualVisto : undefined,
        motivoStock: cambiaStock ? motivo ?? undefined : undefined,
      }
    );
    if (!res.ok) return setError(res.error ?? 'No se pudo guardar.');
    if (res.aviso) toast(res.aviso, true);
    onClose();
  }

  return (
    <Modal
      title={editing ? `Editar ${initial!.codigo}` : 'Nuevo producto'}
      icon={<Package size={20} color="var(--naranja)" />}
      wide
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
            {guardando ? 'Guardando…' : editing ? 'Guardar cambios' : 'Crear producto'}
          </button>
        </>
      }
    >
      <div className="form-row">
        <CampoCodigo
          valor={p.codigo}
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
          <input className="input" value={p.nombre} onChange={(e) => set('nombre', e.target.value)} />
        </div>
      </div>

      <div className="form-row-3">
        <div className="field">
          <label>Tipo</label>
          <select className="select" value={p.tipo} onChange={(e) => set('tipo', e.target.value)}>
            {TIPOS.map((t) => <option key={t}>{t}</option>)}
          </select>
        </div>
        <div className="field">
          <label>Presentación</label>
          <input className="input" placeholder="Bolsa 60 u" value={p.presentacion} onChange={(e) => set('presentacion', e.target.value)} />
        </div>
        <div className="field">
          <label>Ubicación</label>
          <input className="input" value={p.ubicacion ?? ''} onChange={(e) => set('ubicacion', e.target.value)} />
        </div>
      </div>

      <div className="form-row-3">
        <div className="field">
          <label>Stock actual</label>
          <input className="input" type="number" value={p.actual} onChange={(e) => set('actual', Number(e.target.value))} />
        </div>
        <div className="field">
          <label>Stock mínimo</label>
          <input className="input" type="number" value={p.minimo} onChange={(e) => set('minimo', Number(e.target.value))} />
        </div>
        <div className="field">
          <label>Vencimiento</label>
          <input className="input" type="date" value={p.vencimiento ?? ''} onChange={(e) => set('vencimiento', e.target.value)} />
        </div>
      </div>

      {editing && (
        <MotivoStockSelector
          categoria="producto"
          visto={actualVisto}
          nuevo={Number(p.actual)}
          motivo={motivo}
          onChange={setMotivo}
        />
      )}
      {editing && p.codigo.trim() !== initial!.codigo && (
        <p className="hlp" style={{ marginTop: -4 }}>
          Cambia el código de {initial!.codigo} a {p.codigo.trim() || '…'}: los vínculos con la
          tienda y los pedidos ya descontados se actualizan solos.
        </p>
      )}

      {/* ---- RECETA (BOM) ---- */}
      <div className="section-title" style={{ marginTop: 14 }}>
        Receta · qué necesita este producto de las otras categorías
      </div>
      <p className="hlp" style={{ marginTop: -4, marginBottom: 12 }}>
        Al <strong>producir</strong>, cada componente se descuenta automáticamente (cantidad ×
        unidades producidas). Vender sólo descuenta el producto terminado. La cantidad se cuenta en
        la misma unidad que el stock del componente: si la materia prima se cuenta por bolsa, 1 es
        una bolsa entera.
      </p>

      {p.bom.map((b, i) => {
        const opciones = listaDe(state, b.categoria);
        const comp = b.codigo ? (buscarItem(state, b.categoria, b.codigo) as any) : null;
        // Qué es "1" de este componente: la unidad cargada o, si no hay, la presentación
        const unidad = abrevUnidad(comp?.unidad);
        const enQue = String(comp?.presentacion ?? '');
        // Materia prima contada por bolsa/kilo (stock chico, sin unidad) y una
        // receta que pide 1 o más: cada unidad producida se lleva el envase entero.
        const pideMucho =
          b.categoria === 'materia_prima' &&
          !unidad &&
          Number(b.cantidad) >= 1 &&
          Math.abs(Number(comp?.actual) || 0) < 1000 &&
          /kg|kilo|bolsa|bid[oó]n|\bL\b/i.test(enQue);
        return (
          <div className="bom-line" key={i}>
            <select
              className="select"
              value={b.categoria}
              onChange={(e) => updBom(i, { categoria: e.target.value as CategoriaComponente, codigo: '' })}
            >
              {CATS_COMP.map((c) => <option key={c} value={c}>{CATEGORIA_LABEL[c]}</option>)}
            </select>
            <ItemPicker
              opciones={opciones}
              value={b.codigo}
              onChange={(codigo) => updBom(i, { codigo })}
            />
            <input
              className="input qty"
              type="number"
              min={0}
              step="any"
              value={b.cantidad}
              onChange={(e) => updBom(i, { cantidad: Number(e.target.value) })}
            />
            <button className="btn btn--sm btn--ghost" onClick={() => delBom(i)} title="Quitar">
              <Trash2 size={15} />
            </button>
            {comp && (
              <div className={'bom-line__info' + (pideMucho ? ' bom-line__info--ojo' : '')}>
                Pide {formatNum(Number(b.cantidad) || 0)}
                {unidad ? ` ${unidad}` : ''} por unidad producida · hay {formatNum(comp.actual)}
                {unidad ? ` ${unidad}` : ''} en stock
                {!unidad && comp.presentacion ? ` (se compra como: ${comp.presentacion})` : ''}
                {pideMucho &&
                  ` · ¿de verdad cada unidad gasta ${formatNum(Number(b.cantidad))} ${comp.presentacion} entera?`}
              </div>
            )}
          </div>
        );
      })}

      <button className="btn btn--sm" onClick={addBom} style={{ marginTop: 4 }}>
        <Plus size={15} /> Agregar componente
      </button>

      {error && (
        <div className="badge-estado st-agotado" style={{ marginTop: 14, padding: '9px 12px', borderRadius: 10 }}>
          {error}
        </div>
      )}
    </Modal>
  );
}
