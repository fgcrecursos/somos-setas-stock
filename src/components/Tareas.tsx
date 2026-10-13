// =====================================================================
// Piezas de las pantallas de tareas (Producir, Salió, Compra, Contar):
// la foto del producto, el contador de botones grandes, el buscador para
// elegir un ítem y el título con la barra naranja del catálogo.
// =====================================================================
import { Minus, Plus, Search } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { CATEGORIA_LABEL, coincideBusqueda, camposBuscables, formatNum, listaDe } from '../lib/helpers';
import { useStore } from '../lib/store';
import { sb } from '../lib/supabase';
import type { BaseItem, Categoria } from '../lib/types';
import { cuanto } from '../lib/frases';

// ---------------------------------------------------------------------
// Fotos: salen del catálogo de la tienda, vía el vínculo SKU ↔ ítem
// ---------------------------------------------------------------------
let fotosCache: Promise<Map<string, string>> | null = null;
function cargarFotos(): Promise<Map<string, string>> {
  if (fotosCache) return fotosCache;
  fotosCache = (async () => {
    const mapa = new Map<string, string>();
    const [{ data: store }, { data: vinculos }] = await Promise.all([
      sb.from('ss_store').select('products').eq('id', 1).maybeSingle(),
      sb.from('st_sku_map').select('producto_id,codigo,activo'),
    ]);
    const productos: any[] = store?.products ?? [];
    const fotoDe = (p: any): string | undefined =>
      p?.img ?? p?.image ?? p?.imagen ?? (Array.isArray(p?.images) ? p.images[0] : undefined);
    for (const v of (vinculos ?? []) as any[]) {
      if (!v.activo || mapa.has(v.codigo)) continue;
      const foto = fotoDe(productos.find((p) => p.id === v.producto_id));
      if (typeof foto === 'string' && foto) mapa.set(v.codigo, foto);
    }
    return mapa;
  })().catch(() => new Map());
  return fotosCache;
}

function useFoto(codigo: string): string | undefined {
  const [foto, setFoto] = useState<string>();
  useEffect(() => {
    let vivo = true;
    cargarFotos().then((m) => vivo && setFoto(m.get(codigo)));
    return () => {
      vivo = false;
    };
  }, [codigo]);
  return foto;
}

/** Foto del producto o, si no hay, una ficha con el tipo (Cápsulas, Extracto…) */
export function FotoItem({ item, categoria, tam = 72 }: { item: BaseItem & { tipo?: string }; categoria: Categoria; tam?: number }) {
  const foto = useFoto(item.codigo);
  const [rota, setRota] = useState(false);
  if (foto && !rota)
    return (
      <img
        className="foto-item"
        src={foto}
        alt=""
        onError={() => setRota(true)}
        style={{ width: tam, height: tam * 1.2 }}
      />
    );
  const rotulo = categoria === 'producto' ? item.tipo || 'Producto' : CATEGORIA_LABEL[categoria];
  return (
    <span className="foto-item foto-item--vacia" style={{ width: tam, height: tam * 1.2 }} aria-hidden="true">
      <span>{rotulo}</span>
    </span>
  );
}

// ---------------------------------------------------------------------
export function Titulo({ titulo, marcado, sub }: { titulo: string; marcado?: string; sub?: string }) {
  const resto = marcado ? titulo.slice(marcado.length) : titulo;
  return (
    <div className="tarea__titulo">
      <h1>
        {marcado && <span className="titulo-marca">{marcado}</span>}
        {resto}
      </h1>
      {sub && <p className="subtitulo-marca">{sub}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------
export function Contador({ valor, onCambio, min = 1, etiqueta }: { valor: number; onCambio: (n: number) => void; min?: number; etiqueta: string }) {
  const cambiar = (d: number) => onCambio(Math.max(min, (Number.isFinite(valor) ? valor : 0) + d));
  return (
    <div className="contador num" role="group" aria-label={etiqueta}>
      <button type="button" className="contador__btn" onClick={() => cambiar(-10)} aria-label="Restar 10">−10</button>
      <button type="button" className="contador__btn" onClick={() => cambiar(-1)} aria-label="Restar 1"><Minus size={26} /></button>
      <input
        className="contador__num"
        inputMode="numeric"
        aria-label={etiqueta}
        value={Number.isFinite(valor) ? String(valor) : ''}
        onChange={(e) => {
          const n = Number(e.target.value.replace(/\D/g, ''));
          onCambio(Number.isFinite(n) ? n : min);
        }}
      />
      <button type="button" className="contador__btn" onClick={() => cambiar(1)} aria-label="Sumar 1"><Plus size={26} /></button>
      <button type="button" className="contador__btn" onClick={() => cambiar(10)} aria-label="Sumar 10">+10</button>
    </div>
  );
}

// ---------------------------------------------------------------------
/** Buscador grande + lista de ítems con foto, para elegir uno */
export function ElegirItem({
  categorias,
  onElegir,
  pista,
  extra,
}: {
  categorias: Categoria[];
  onElegir: (categoria: Categoria, item: BaseItem) => void;
  pista: string;
  extra?: (categoria: Categoria, item: BaseItem) => ReactNode;
}) {
  const { state } = useStore();
  const [q, setQ] = useState('');
  const [cat, setCat] = useState<Categoria>(categorias[0]);
  const items = useMemo(() => {
    const todos = listaDe(state, cat);
    const filtrados = q.trim() ? todos.filter((it) => coincideBusqueda(q, ...camposBuscables(it))) : todos;
    return [...filtrados].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  }, [state, cat, q]);

  return (
    <div className="elegir">
      {categorias.length > 1 && (
        <div className="elegir__cats" role="group" aria-label="Qué tipo de cosa">
          {categorias.map((c) => (
            <button
              key={c}
              type="button"
              className={'opcion-chica' + (cat === c ? ' opcion-chica--activa' : '')}
              onClick={() => setCat(c)}
            >
              {CATEGORIA_LABEL[c]}
            </button>
          ))}
        </div>
      )}
      <label className="buscador-grande">
        <Search size={24} aria-hidden="true" />
        <span className="sr-only">{pista}</span>
        <input autoFocus type="search" placeholder={pista} value={q} onChange={(e) => setQ(e.target.value)} />
      </label>
      <div className="elegir__lista">
        {items.slice(0, 60).map((it) => (
          <button key={it.codigo} type="button" className="fila-item" onClick={() => onElegir(cat, it)}>
            <FotoItem item={it as any} categoria={cat} tam={52} />
            <span className="fila-item__txt">
              <strong>{it.nombre}</strong>
              <span>
                {[(it as any).tipo, (it as any).presentacion, it.codigo].filter(Boolean).join(' · ')}
              </span>
            </span>
            <span className="fila-item__stock num">
              {extra ? extra(cat, it) : <>Hay <strong>{formatNum(it.actual)}</strong></>}
            </span>
          </button>
        ))}
        {items.length === 0 && <p className="elegir__nada">No encontramos nada con «{q}». Probá con otra palabra.</p>}
        {items.length > 60 && <p className="elegir__nada">Hay {items.length - 60} más: escribí parte del nombre para encontrarlo.</p>}
      </div>
    </div>
  );
}

/** "Hay 48 unidades" en lenguaje simple */
export function hayTexto(item: BaseItem & { unidad?: string | null }): string {
  return `Hay ${cuanto(item.actual, item)}`;
}
