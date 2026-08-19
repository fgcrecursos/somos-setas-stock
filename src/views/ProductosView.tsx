import { Link2, Package, Plus, Search, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { ConfirmarBaja } from '../components/ConfirmarBaja';
import { DataTable, type Column } from '../components/DataTable';
import { ItemModal } from '../components/ItemModal';
import { ProductForm } from '../components/ProductForm';
import { DiffCell, StatusBadge, StockBar } from '../components/StatusBadge';
import { calcEstado, formatNum } from '../lib/helpers';
import { useStore } from '../lib/store';
import type { Producto } from '../lib/types';

export function ProductosView() {
  const { state, puedeEditar } = useStore();
  const [q, setQ] = useState('');
  const [tipo, setTipo] = useState<string>('Todos');
  const [soloAlerta, setSoloAlerta] = useState(false);
  const [ver, setVer] = useState<Producto | null>(null);
  const [editar, setEditar] = useState<Producto | null>(null);
  const [nuevo, setNuevo] = useState(false);
  const [borrar, setBorrar] = useState<Producto | null>(null);

  const tipos = useMemo(
    () => ['Todos', ...Array.from(new Set(state.productos.map((p) => p.tipo)))],
    [state.productos]
  );

  const rows = useMemo(() => {
    const query = q.trim().toLowerCase();
    return state.productos.filter((p) => {
      if (tipo !== 'Todos' && p.tipo !== tipo) return false;
      if (soloAlerta && calcEstado(p.actual, p.minimo).faltan <= 0) return false;
      if (!query) return true;
      return (
        p.nombre.toLowerCase().includes(query) ||
        p.codigo.toLowerCase().includes(query) ||
        p.presentacion.toLowerCase().includes(query)
      );
    });
  }, [state.productos, q, tipo, soloAlerta]);

  const columns: Column<Producto>[] = [
    { key: 'codigo', header: 'Código', sortValue: (r) => r.codigo, className: 'codigo', render: (r) => r.codigo },
    { key: 'nombre', header: 'Producto', sortValue: (r) => r.nombre, className: 'nombre',
      render: (r) => (
        <button className="btn btn--ghost btn--sm" style={{ padding: 0, border: 'none', fontWeight: 600 }} onClick={() => setVer(r)}>
          {r.nombre}
        </button>
      ) },
    { key: 'tipo', header: 'Tipo', sortValue: (r) => r.tipo, render: (r) => <span className="pill">{r.tipo}</span> },
    { key: 'pres', header: 'Presentación', sortValue: (r) => r.presentacion, render: (r) => <span className="muted">{r.presentacion}</span> },
    { key: 'actual', header: 'Actual', align: 'right', sortValue: (r) => r.actual, render: (r) => formatNum(r.actual) },
    { key: 'minimo', header: 'Mínimo', align: 'right', sortValue: (r) => r.minimo, render: (r) => formatNum(r.minimo) },
    { key: 'nivel', header: 'Nivel', sortable: false, render: (r) => <StockBar actual={r.actual} minimo={r.minimo} /> },
    { key: 'diff', header: 'Diferencia', align: 'right', sortValue: (r) => r.actual - r.minimo, render: (r) => <DiffCell actual={r.actual} minimo={r.minimo} /> },
    { key: 'bom', header: 'Receta', align: 'center', sortValue: (r) => r.bom.length,
      render: (r) => (
        <span className="pill" title={`${r.bom.length} componentes`}>
          <Link2 size={12} /> {r.bom.length}
        </span>
      ) },
    { key: 'estado', header: 'Estado', sortValue: (r) => calcEstado(r.actual, r.minimo).diferencia, render: (r) => <StatusBadge actual={r.actual} minimo={r.minimo} /> },
    { key: 'acc', header: '', sortable: false, align: 'right',
      render: (r) => (
        <div className="row-acciones">
          <button className="btn btn--sm" onClick={() => (puedeEditar ? setEditar(r) : setVer(r))}>
            {puedeEditar ? 'Editar' : 'Ver'}
          </button>
          {puedeEditar && (
            <button
              className="btn btn--sm btn--peligro"
              title={`Eliminar ${r.codigo}`}
              aria-label={`Eliminar ${r.codigo}`}
              onClick={() => setBorrar(r)}
            >
              <Trash2 size={14} />
            </button>
          )}
        </div>
      ) },
  ];

  return (
    <div className="stack">
      <div className="toolbar">
        <div className="searchbox">
          <Search size={16} />
          <input className="input" placeholder="Buscar producto o código…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="chips">
          {tipos.map((t) => (
            <button key={t} className={'chip' + (tipo === t ? ' active' : '')} onClick={() => setTipo(t)}>{t}</button>
          ))}
        </div>
        <button className={'chip' + (soloAlerta ? ' active' : '')} onClick={() => setSoloAlerta((s) => !s)}>
          Solo faltantes
        </button>
        <div className="toolbar__spacer" />
        <span className="muted" style={{ fontSize: 12 }}>{rows.length} de {state.productos.length}</span>
        {puedeEditar && (
          <button className="btn btn--primary" onClick={() => setNuevo(true)}>
            <Plus size={16} /> Nuevo producto
          </button>
        )}
      </div>

      <div className="card">
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(r) => r.codigo}
          defaultSort="codigo"
          emptyLabel={
            <div>
              <Package size={30} />
              <p>No hay productos que coincidan con el filtro.</p>
            </div>
          }
        />
      </div>

      {ver && (
        <ItemModal
          categoria="producto"
          item={ver}
          onClose={() => setVer(null)}
          onEdit={() => { setEditar(ver); setVer(null); }}
        />
      )}
      {editar && (
        <ProductForm
          initial={editar}
          onClose={() => setEditar(null)}
          onEliminar={() => setBorrar(editar)}
        />
      )}
      {nuevo && <ProductForm onClose={() => setNuevo(false)} />}
      {borrar && (
        <ConfirmarBaja
          categoria="producto"
          item={borrar}
          onClose={() => setBorrar(null)}
          onEliminado={() => { setEditar(null); setVer(null); }}
        />
      )}
    </div>
  );
}
