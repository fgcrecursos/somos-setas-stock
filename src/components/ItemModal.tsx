import {
  AlertTriangle,
  Barcode as BarcodeIcon,
  PackagePlus,
  Pencil,
  Printer,
  SlidersHorizontal,
} from 'lucide-react';
import { useState } from 'react';
import {
  CATEGORIA_LABEL,
  VENCIMIENTO_CLASE,
  calcEstado,
  calcVencimiento,
  diasAvisoGuardado,
  formatNum,
} from '../lib/helpers';
import { useStore } from '../lib/store';
import type { BaseItem, Categoria } from '../lib/types';
import { Barcode } from './Barcode';
import { Modal } from './Modal';
import { DiffCell, StatusBadge, VencimientoCell } from './StatusBadge';
import { useToast } from './Toast';

interface Props {
  categoria: Categoria;
  item: BaseItem;
  onClose: () => void;
  onEdit?: () => void;
}

export function ItemModal({ categoria, item, onClose, onEdit }: Props) {
  const { ingreso, ajustar, producir, puedeEditar, guardando } = useStore();
  const toast = useToast();
  const [addQty, setAddQty] = useState(10);
  const [setQty, setSetQty] = useState(item.actual);
  const e = calcEstado(item.actual, item.minimo);
  const esProducto = categoria === 'producto';

  // Datos de la ficha que no son stock: lote, proveedor, vencimiento…
  const d = item as any;
  const diasAviso = diasAvisoGuardado();
  const venc = calcVencimiento(d.vencimiento, diasAviso);
  const ficha: { label: string; value: React.ReactNode }[] = [];
  if (d.tipo) ficha.push({ label: 'Tipo', value: d.tipo });
  if (d.presentacion) ficha.push({ label: 'Presentación', value: d.presentacion });
  if (d.lote) ficha.push({ label: 'Lote', value: d.lote });
  if (d.proveedor) ficha.push({ label: 'Proveedor', value: d.proveedor });
  if (d.ubicacion) ficha.push({ label: 'Ubicación', value: d.ubicacion });
  if (d.vencimiento)
    ficha.push({
      label: 'Vencimiento',
      value: <VencimientoCell vencimiento={d.vencimiento} diasAviso={diasAviso} />,
    });
  const fichaVacia =
    categoria === 'materia_prima' && !d.lote && !d.proveedor && !d.vencimiento;

  async function correr(fn: () => Promise<{ ok: boolean; error?: string }>, exito: string) {
    const res = await fn();
    toast(res.error ?? exito, !res.ok);
    if (res.ok) onClose();
  }

  // Sumar stock de un producto significa "se produjo más": hay que descontar
  // la receta (etiquetas, insumos, materia prima), igual que en Vender/Producir.
  // Ingreso directo sólo tiene sentido para materia prima/insumos/etiquetas.
  async function sumarProducto() {
    const res = await producir(item.codigo, addQty);
    if (!res.ok) {
      toast(res.error ?? res.mensaje, true);
      return;
    }
    toast(
      res.alertas.length ? `${res.mensaje}. ${res.alertas.length} alerta(s) de stock` : res.mensaje,
      res.alertas.length > 0
    );
    onClose();
  }

  function printBarcode() {
    const w = window.open('', '_blank', 'width=420,height=320');
    if (!w) return;
    const svg = document.getElementById('modal-barcode')?.outerHTML ?? '';
    w.document.write(
      `<html><head><title>${item.codigo}</title></head><body style="font-family:sans-serif;text-align:center;padding:20px">
       <div style="font-weight:700;margin-bottom:8px">${item.nombre}</div>${svg}
       <script>window.onload=()=>{window.print()}</script></body></html>`
    );
    w.document.close();
  }

  return (
    <Modal
      title={item.codigo}
      icon={<BarcodeIcon size={20} color="var(--verde-700)" />}
      onClose={onClose}
      footer={
        <>
          {onEdit && puedeEditar && (
            <button className="btn" onClick={onEdit}>
              <Pencil size={15} /> Editar
            </button>
          )}
          <button className="btn btn--dark" onClick={onClose}>Cerrar</button>
        </>
      }
    >
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
        <div>
          <h3 style={{ fontSize: 20 }}>{item.nombre}</h3>
          <span className="pill" style={{ marginTop: 6 }}>{CATEGORIA_LABEL[categoria]}</span>
        </div>
        <StatusBadge actual={item.actual} minimo={item.minimo} />
      </div>

      {venc && venc.estado !== 'ok' && (
        <div className={`row aviso-venc ${VENCIMIENTO_CLASE[venc.estado]}`}>
          <AlertTriangle size={17} />
          <span>
            {venc.label}
            {d.lote ? ` · lote ${d.lote}` : ''}
            {venc.estado === 'vencido' && item.actual > 0
              ? ` · quedan ${formatNum(item.actual)} en stock`
              : ''}
          </span>
        </div>
      )}

      <div className="grid" style={{ gridTemplateColumns: '1fr 1fr 1fr', margin: '16px 0' }}>
        <Stat label="Actual" value={formatNum(item.actual)} />
        <Stat label="Mínimo" value={formatNum(item.minimo)} />
        <Stat label="Diferencia" value={<DiffCell actual={item.actual} minimo={item.minimo} />} />
      </div>

      {/* Ficha: lote, proveedor, vencimiento y demás datos de la ficha */}
      {ficha.length > 0 && (
        <>
          <div className="section-title">Ficha</div>
          <div className="ficha-datos">
            {ficha.map((f) => (
              <div key={f.label} className="ficha-datos__fila">
                <span className="muted">{f.label}</span>
                <span>{f.value}</span>
              </div>
            ))}
          </div>
        </>
      )}
      {fichaVacia && (
        <p className="hlp" style={{ marginTop: 0, marginBottom: 14 }}>
          Esta materia prima todavía no tiene lote, proveedor ni vencimiento cargados.
          {puedeEditar && ' Cargalos desde "Editar" para que entre en las alertas de vencimiento.'}
        </p>
      )}

      {/* Barcode */}
      <div className="section-title">Código de barras</div>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div className="barcode-box">
          <div id="modal-barcode">
            <Barcode value={item.codigo} />
          </div>
        </div>
        <button className="btn btn--sm" onClick={printBarcode}>
          <Printer size={15} /> Imprimir
        </button>
      </div>

      {/* Acciones rápidas — solo para quien puede editar */}
      {puedeEditar && (
        <>
          <div className="section-title" style={{ marginTop: 18 }}>Ajustar stock</div>
          <div className="form-row">
            <div className="field" style={{ margin: 0 }}>
              <label>
                <PackagePlus size={13} style={{ verticalAlign: 'middle' }} />{' '}
                {esProducto ? 'Producir (sumar)' : 'Ingresar (sumar)'}
              </label>
              <div className="row">
                <input className="input" type="number" value={addQty} onChange={(ev) => setAddQty(Number(ev.target.value))} />
                <button
                  className="btn btn--primary"
                  disabled={guardando}
                  onClick={() =>
                    esProducto
                      ? sumarProducto()
                      : correr(
                          () => ingreso(categoria, item.codigo, addQty),
                          `Ingresaron ${addQty} de ${item.nombre}`
                        )
                  }
                >
                  + Sumar
                </button>
              </div>
              {esProducto && (
                <p className="hlp" style={{ marginTop: 4 }}>
                  Descuenta la receta (etiqueta, insumos, materia prima) como una producción.
                </p>
              )}
            </div>
            <div className="field" style={{ margin: 0 }}>
              <label><SlidersHorizontal size={13} style={{ verticalAlign: 'middle' }} /> Fijar actual</label>
              <div className="row">
                <input className="input" type="number" value={setQty} onChange={(ev) => setSetQty(Number(ev.target.value))} />
                <button
                  className="btn btn--dark"
                  disabled={guardando}
                  onClick={() =>
                    correr(
                      () => ajustar(categoria, item.codigo, setQty),
                      `${item.nombre} quedó en ${setQty}`
                    )
                  }
                >
                  Fijar
                </button>
              </div>
              {esProducto && (
                <p className="hlp" style={{ marginTop: 4 }}>
                  Corrección de conteo físico: no toca la receta.
                </p>
              )}
            </div>
          </div>
        </>
      )}
      <p className="hlp" style={{ marginTop: 10 }}>
        Nivel de stock: {e.faltan > 0 ? `faltan ${e.faltan} para el mínimo` : `hay ${e.sobran} por encima del mínimo`}.
      </p>
    </Modal>
  );
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="card__body" style={{ background: 'var(--crema-2)', borderRadius: 10, padding: 12 }}>
      <div className="muted" style={{ fontSize: 11.5 }}>{label}</div>
      <div style={{ fontFamily: 'var(--font-head)', fontSize: 22, marginTop: 2 }}>{value}</div>
    </div>
  );
}
