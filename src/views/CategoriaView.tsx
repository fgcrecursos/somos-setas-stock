import { Plus, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { DataTable, type Column } from '../components/DataTable';
import { ItemForm } from '../components/ItemForm';
import { ItemModal } from '../components/ItemModal';
import { DiffCell, StatusBadge, StockBar } from '../components/StatusBadge';
import {
  CATEGORIA_LABEL_PLURAL,
  calcEstado,
  formatNum,
  listaDe,
} from '../lib/helpers';
import { useStore } from '../lib/store';
import type { BaseItem, Categoria, Etiqueta, MateriaPrima } from '../lib/types';

export function CategoriaView({ categoria }: { categoria: Categoria }) {
  const { state, puedeEditar } = useStore();
  const [q, setQ] = useState('');
  const [soloAlerta, setSoloAlerta] = useState(false);
  const [ver, setVer] = useState<BaseItem | null>(null);
  const [editar, setEditar] = useState<any | null>(null);
  const [nuevo, setNuevo] = useState(false);

  const all = listaDe(state, categoria);
  const rows = useMemo(() => {
    const query = q.trim().toLowerCase();
    return all.filter((it) => {
      if (soloAlerta && calcEstado(it.actual, it.minimo).faltan <= 0) return false;
      if (!query) return true;
      return (
        it.nombre.toLowerCase().includes(query) ||
        it.codigo.toLowerCase().includes(query)
      );
    });
  }, [all, q, soloAlerta]);

  const hasTipo = categoria === 'etiqueta' || categoria === 'materia_prima';

  const columns: Column<BaseItem>[] = [
    { key: 'codigo', header: 'Código', sortValue: (r) => r.codigo, className: 'codigo', render: (r) => r.codigo },
    {
      key: 'nombre', header: 'Nombre', sortValue: (r) => r.nombre, className: 'nombre',
      render: (r) => (
        <button className="btn btn--ghost btn--sm" style={{ padding: 0, border: 'none', fontWeight: 600 }} onClick={() => setVer(r)}>
          {r.nombre}
        </button>
      ),
    },
    ...(hasTipo
      ? [{
          key: 'tipo', header: 'Tipo',
          sortValue: (r: BaseItem) => (r as Etiqueta).tipo ?? '',
          render: (r: BaseItem) => <span className="pill">{(r as Etiqueta).tipo || '—'}</span>,
        } as Column<BaseItem>]
      : []),
    ...(categoria === 'etiqueta' || categoria === 'materia_prima'
      ? [{
          key: 'pres', header: 'Presentación',
          sortValue: (r: BaseItem) => (r as MateriaPrima).presentacion ?? '',
          render: (r: BaseItem) => <span className="muted">{(r as MateriaPrima).presentacion || '—'}</span>,
        } as Column<BaseItem>]
      : []),
    { key: 'actual', header: 'Actual', align: 'right', sortValue: (r) => r.actual, render: (r) => formatNum(r.actual) },
    { key: 'minimo', header: 'Mínimo', align: 'right', sortValue: (r) => r.minimo, render: (r) => formatNum(r.minimo) },
    { key: 'nivel', header: 'Nivel', sortable: false, render: (r) => <StockBar actual={r.actual} minimo={r.minimo} /> },
    { key: 'diff', header: 'Diferencia', align: 'right', sortValue: (r) => r.actual - r.minimo, render: (r) => <DiffCell actual={r.actual} minimo={r.minimo} /> },
    { key: 'estado', header: 'Estado', sortValue: (r) => calcEstado(r.actual, r.minimo).diferencia, render: (r) => <StatusBadge actual={r.actual} minimo={r.minimo} /> },
    { key: 'acc', header: '', sortable: false, align: 'right',
      render: (r) => (
        <button className="btn btn--sm" onClick={() => (puedeEditar ? setEditar(r) : setVer(r))}>
          {puedeEditar ? 'Editar' : 'Ver'}
        </button>
      ) },
  ];

  const alertas = all.filter((it) => calcEstado(it.actual, it.minimo).faltan > 0).length;

  return (
    <div className="stack">
      <div className="toolbar">
        <div className="searchbox">
          <Search size={16} />
          <input className="input" placeholder="Buscar…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <button className={'chip' + (soloAlerta ? ' active' : '')} onClick={() => setSoloAlerta((s) => !s)}>
          Solo faltantes {alertas > 0 && `(${alertas})`}
        </button>
        <div className="toolbar__spacer" />
        <span className="muted" style={{ fontSize: 12 }}>{rows.length} de {all.length}</span>
        {puedeEditar && (
          <button className="btn btn--primary" onClick={() => setNuevo(true)}>
            <Plus size={16} /> Nuevo
          </button>
        )}
      </div>

      <div className="card">
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(r) => r.codigo}
          defaultSort="codigo"
          emptyLabel={<p>No hay ítems en {CATEGORIA_LABEL_PLURAL[categoria]}.</p>}
        />
      </div>

      {ver && (
        <ItemModal
          categoria={categoria}
          item={ver}
          onClose={() => setVer(null)}
          onEdit={() => { setEditar(ver); setVer(null); }}
        />
      )}
      {editar && <ItemForm categoria={categoria} initial={editar} onClose={() => setEditar(null)} />}
      {nuevo && <ItemForm categoria={categoria} onClose={() => setNuevo(false)} />}
    </div>
  );
}
