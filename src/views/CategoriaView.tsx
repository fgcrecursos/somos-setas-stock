import { Eye, Pencil, Plus, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { BarraFiltros, GrupoFiltro } from '../components/BarraFiltros';
import { ConfirmarBaja } from '../components/ConfirmarBaja';
import { DataTable, type Column } from '../components/DataTable';
import { ItemForm } from '../components/ItemForm';
import { ItemModal } from '../components/ItemModal';
import { DiffCell, StatusBadge, StockBar, VencimientoCell } from '../components/StatusBadge';
import {
  CATEGORIA_LABEL_PLURAL,
  calcEstado,
  calcVencimiento,
  diasAvisoGuardado,
  camposBuscables,
  coincideBusqueda,
  formatNum,
  listaDe,
} from '../lib/helpers';
import { useStore } from '../lib/store';
import type { BaseItem, Categoria, Etiqueta, MateriaPrima } from '../lib/types';

export function CategoriaView({ categoria }: { categoria: Categoria }) {
  const { state, puedeEditar } = useStore();
  const [q, setQ] = useState('');
  const [soloAlerta, setSoloAlerta] = useState(false);
  const [soloVencer, setSoloVencer] = useState(false);
  const [ver, setVer] = useState<BaseItem | null>(null);
  const [editar, setEditar] = useState<any | null>(null);
  const [nuevo, setNuevo] = useState(false);
  const [borrar, setBorrar] = useState<BaseItem | null>(null);
  const diasAviso = diasAvisoGuardado();

  const all = listaDe(state, categoria);

  /** ¿Está vencido o por vencer, y todavía tiene stock? */
  const porVencer = (it: BaseItem) => {
    const info = calcVencimiento((it as any).vencimiento, diasAviso);
    return !!info && info.estado !== 'ok' && it.actual > 0;
  };

  const rows = useMemo(() => {
    return all.filter((it) => {
      if (soloAlerta && calcEstado(it.actual, it.minimo).faltan <= 0) return false;
      if (soloVencer && !porVencer(it)) return false;
      return coincideBusqueda(q, ...camposBuscables(it));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [all, q, soloAlerta, soloVencer, diasAviso]);

  const hasTipo = categoria === 'etiqueta' || categoria === 'materia_prima';
  // La columna de vencimiento se muestra siempre en materia prima (aunque esté
  // vacía, para que se note que hay que cargarla) y en el resto sólo si alguien
  // cargó alguna fecha.
  const hasVencimiento =
    categoria === 'materia_prima' || all.some((it) => !!(it as any).vencimiento);

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
    ...(hasVencimiento
      ? [{
          key: 'venc', header: 'Vencimiento',
          // Sin fecha van al final: `zzzz` ordena después de cualquier aaaa-mm-dd
          sortValue: (r: BaseItem) => String((r as any).vencimiento ?? 'zzzz'),
          render: (r: BaseItem) => (
            <VencimientoCell vencimiento={(r as any).vencimiento} diasAviso={diasAviso} />
          ),
        } as Column<BaseItem>]
      : []),
    { key: 'acc', header: '', sortable: false, align: 'right', className: 'actions',
      render: (r) => (
        <div className="row-acciones">
          <button
            className="btn btn--sm btn--fila"
            title={puedeEditar ? `Editar ${r.codigo}` : `Ver ${r.codigo}`}
            onClick={() => (puedeEditar ? setEditar(r) : setVer(r))}
          >
            {puedeEditar ? <Pencil className="btn__ico" size={14} /> : <Eye className="btn__ico" size={14} />}
            <span className="btn__txt">{puedeEditar ? 'Editar' : 'Ver'}</span>
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

  const alertas = all.filter((it) => calcEstado(it.actual, it.minimo).faltan > 0).length;
  const vencen = all.filter(porVencer).length;

  return (
    <div className="stack">
      <div className="toolbar">
        <BarraFiltros
          q={q}
          setQ={setQ}
          placeholder="Buscar por nombre, código, tipo, lote…"
          activos={[
            ...(soloAlerta ? ['Solo faltantes'] : []),
            ...(soloVencer ? ['Por vencer'] : []),
          ]}
          onLimpiar={() => {
            setSoloAlerta(false);
            setSoloVencer(false);
          }}
        >
          <GrupoFiltro titulo="Estado del stock">
            <button className={'chip' + (!soloAlerta ? ' active' : '')} onClick={() => setSoloAlerta(false)}>Todos</button>
            <button className={'chip' + (soloAlerta ? ' active' : '')} onClick={() => setSoloAlerta(true)}>
              Solo faltantes {alertas > 0 && `(${alertas})`}
            </button>
          </GrupoFiltro>
          {(hasVencimiento || vencen > 0) && (
            <GrupoFiltro titulo="Vencimiento" ayuda={`Vencidos o que vencen dentro de ${diasAviso} días.`}>
              <button className={'chip' + (!soloVencer ? ' active' : '')} onClick={() => setSoloVencer(false)}>Todos</button>
              <button className={'chip' + (soloVencer ? ' active' : '')} onClick={() => setSoloVencer(true)}>
                Por vencer {vencen > 0 && `(${vencen})`}
              </button>
            </GrupoFiltro>
          )}
        </BarraFiltros>
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
      {editar && (
        <ItemForm
          categoria={categoria}
          initial={editar}
          onClose={() => setEditar(null)}
          onEliminar={() => setBorrar(editar)}
        />
      )}
      {nuevo && <ItemForm categoria={categoria} onClose={() => setNuevo(false)} />}
      {borrar && (
        <ConfirmarBaja
          categoria={categoria}
          item={borrar}
          onClose={() => setBorrar(null)}
          onEliminado={() => { setEditar(null); setVer(null); }}
        />
      )}
    </div>
  );
}
