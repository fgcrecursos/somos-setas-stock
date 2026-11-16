// =====================================================================
// CONTÉ EL ESTANTE (restablecer)
// Una tarjeta por ítem con un casillero grande. Lo que se va escribiendo
// queda guardado en este navegador (se puede seguir otro día) y nada cambia
// en el stock hasta tocar "Guardar el conteo". Cada ítem contado deja un
// movimiento "restablecer": cuánto decía el sistema y cuánto había.
// =====================================================================
import { ArrowLeft, Check, Search } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { FotoItem, Titulo } from '../components/Tareas';
import { traerPorDespachar, type PorDespachar } from '../lib/cloud';
import { cuanto } from '../lib/frases';
import { CATEGORIA_LABEL_PLURAL, camposBuscables, coincideBusqueda, formatNum, listaDe } from '../lib/helpers';
import { useStore } from '../lib/store';
import type { Categoria } from '../lib/types';

const CATS: Categoria[] = ['producto', 'etiqueta', 'insumo', 'materia_prima', 'insumo_interno'];
const claveBorrador = (c: Categoria) => `ss-stock-v2:conteo:${c}`;

function leerBorrador(c: Categoria): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(claveBorrador(c)) || '{}');
  } catch {
    return {};
  }
}

export function ContarView({ onSalir }: { onSalir: () => void }) {
  const { state, restablecer, guardando } = useStore();
  const [cat, setCat] = useState<Categoria>('producto');
  const [valores, setValores] = useState<Record<string, string>>(() => leerBorrador('producto'));
  const [filtro, setFiltro] = useState<'todos' | 'faltan' | 'contados'>('todos');
  const [q, setQ] = useState('');
  const [confirmando, setConfirmando] = useState(false);
  // Mercadería de pedidos en preparación que todavía no salió: el sistema ya la
  // descontó, pero puede seguir en el estante. Antes de guardar hay que decir
  // si se contó o no; si no, el conteo la vuelve a sumar.
  const [porDespachar, setPorDespachar] = useState<Map<string, PorDespachar>>(new Map());
  const [pedidosEnEstante, setPedidosEnEstante] = useState<'apartados' | 'contados' | null>(null);
  useEffect(() => {
    let vivo = true;
    traerPorDespachar()
      .then((m) => vivo && setPorDespachar(m))
      .catch(() => {
        /* sin acceso a los pedidos: se cuenta como siempre */
      });
    return () => {
      vivo = false;
    };
  }, []);
  const [hecho, setHecho] = useState<number | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    try {
      localStorage.setItem(claveBorrador(cat), JSON.stringify(valores));
    } catch {
      /* sin almacenamiento: el borrador dura lo que la pantalla */
    }
  }, [valores, cat]);

  function cambiarCat(c: Categoria) {
    setCat(c);
    setValores(leerBorrador(c));
    setConfirmando(false);
  }

  const items = useMemo(
    () => [...listaDe(state, cat)].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es')),
    [state, cat]
  );
  const contado = (codigo: string) => {
    const v = valores[codigo];
    if (v == null || v.trim() === '') return null;
    const n = Number(v.replace(',', '.'));
    return Number.isFinite(n) && n >= 0 ? n : null;
  };
  const conNumero = items.filter((it) => contado(it.codigo) != null);
  const pendiente = (codigo: string) => porDespachar.get(`${cat}|${codigo}`)?.cantidad ?? 0;
  // Lo que tiene que quedar en el sistema: si lo de los pedidos sin despachar
  // se contó junto con el resto, se le resta (ya está descontado)
  const paraGuardar = (codigo: string) => {
    const n = contado(codigo);
    if (n == null) return null;
    return pedidosEnEstante === 'contados' ? Math.max(0, n - pendiente(codigo)) : n;
  };
  const contadosConPedidos = conNumero.filter((it) => pendiente(it.codigo) > 0);
  const faltaDecidir = contadosConPedidos.length > 0 && pedidosEnEstante == null;
  const visibles = items.filter((it) => {
    if (q.trim() && !coincideBusqueda(q, ...camposBuscables(it))) return false;
    if (filtro === 'faltan') return contado(it.codigo) == null;
    if (filtro === 'contados') return contado(it.codigo) != null;
    return true;
  });
  const diferencias = conNumero.filter((it) => paraGuardar(it.codigo) !== it.actual);

  async function guardar() {
    setError('');
    const r = await restablecer(
      conNumero.map((it) => {
        const visto = contado(it.codigo)!;
        const queda = paraGuardar(it.codigo)!;
        const p = pendiente(it.codigo);
        return {
          categoria: cat,
          codigo: it.codigo,
          contado: queda,
          nota:
            p > 0 && pedidosEnEstante === 'contados'
              ? `Conteo del estante: había ${formatNum(visto)}, ${formatNum(Math.min(p, visto))} son de pedidos sin despachar; quedan ${formatNum(queda)}`
              : p > 0
                ? `Conteo del estante: había ${formatNum(visto)} (sin contar ${formatNum(p)} apartados para pedidos)`
                : undefined,
        };
      })
    );
    if (!r.ok) return setError(r.error || 'No se pudo guardar.');
    setValores({});
    try {
      localStorage.removeItem(claveBorrador(cat));
    } catch {
      /* nada */
    }
    setConfirmando(false);
    setPedidosEnEstante(null);
    setHecho(r.guardados ?? 0);
  }

  if (hecho != null)
    return (
      <div className="tarea tarea--listo">
        <span className="listo__marca"><Check size={44} strokeWidth={2.6} /></span>
        <h1>Listo, conteo guardado</h1>
        <p className="num">Se actualizaron <strong>{hecho}</strong> {CATEGORIA_LABEL_PLURAL[cat].toLowerCase()}. Desde ahora las cuentas arrancan de estos números.</p>
        <div className="tarea__acciones tarea__acciones--centro">
          <button className="btn-grande btn-grande--borde" onClick={() => setHecho(null)}>Seguir contando</button>
          <button className="btn-grande" onClick={onSalir}>Volver al inicio</button>
        </div>
      </div>
    );

  return (
    <div className="tarea">
      <button className="volver" onClick={onSalir}><ArrowLeft size={22} /> Volver</button>
      <div className="tarea__encabezado">
        <Titulo marcado="Contá" titulo="Contá el estante" sub="Anotá cuántos hay de verdad" />
        <div className="avance num">
          <span><strong>{conNumero.length}</strong> de {items.length} contados</span>
          <span className="avance__barra"><span style={{ width: `${items.length ? (conNumero.length / items.length) * 100 : 0}%` }} /></span>
        </div>
      </div>

      <div className="elegir__cats" role="group" aria-label="Qué estás contando">
        {CATS.map((c) => (
          <button key={c} type="button" className={'opcion-chica' + (cat === c ? ' opcion-chica--activa' : '')} onClick={() => cambiarCat(c)}>
            {CATEGORIA_LABEL_PLURAL[c]}
          </button>
        ))}
      </div>
      <p className="nota-chica">
        {cat === 'producto'
          ? 'Contás productos terminados. Las etiquetas, envases y materia prima no cambian.'
          : 'Contás solo esto. Los productos y las recetas no cambian.'}
      </p>

      <div className="contar__filtros">
        <label className="buscador-grande">
          <Search size={24} aria-hidden="true" />
          <span className="sr-only">Buscar</span>
          <input type="search" placeholder="Buscar por nombre" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
        <div role="group" aria-label="Mostrar" className="elegir__cats">
          {([['todos', 'Todos'], ['faltan', 'Faltan contar'], ['contados', 'Ya contados']] as const).map(([id, txt]) => (
            <button key={id} type="button" className={'opcion-chica' + (filtro === id ? ' opcion-chica--activa' : '')} onClick={() => setFiltro(id)}>{txt}</button>
          ))}
        </div>
      </div>

      <div className="contar__lista">
        {visibles.map((it) => {
          const n = contado(it.codigo);
          const p = pendiente(it.codigo);
          const queda = paraGuardar(it.codigo);
          const dif = queda == null ? null : queda - it.actual;
          return (
            <div key={it.codigo} className={'tarjeta-conteo num' + (n == null ? ' tarjeta-conteo--pendiente' : '')}>
              <FotoItem item={it as any} categoria={cat} tam={56} />
              <div className="tarjeta-conteo__nombre">
                <strong>{it.nombre}</strong>
                <span>{[(it as any).tipo, (it as any).presentacion].filter(Boolean).join(' · ') || it.codigo}</span>
              </div>
              <label className="tarjeta-conteo__campo">
                <span>¿Cuántos hay?</span>
                <input
                  inputMode="decimal"
                  placeholder="?"
                  value={valores[it.codigo] ?? ''}
                  onChange={(e) => setValores((v) => ({ ...v, [it.codigo]: e.target.value.replace(/[^\d.,]/g, '') }))}
                />
              </label>
              <span className={'tarjeta-conteo__dif' + (dif ? ' tarjeta-conteo__dif--hay' : '')}>
                {dif == null ? (
                  <>Todavía no lo contaste</>
                ) : (
                  <>
                    El sistema decía {formatNum(it.actual)}
                    {p > 0 && pedidosEnEstante === 'contados' && <> · van {formatNum(Math.min(p, n ?? 0))} a pedidos</>}
                    <br />
                    <strong>{dif === 0 ? 'Coincide' : dif < 0 ? `Hay ${cuanto(dif, it as any)} menos` : `Hay ${cuanto(dif, it as any)} más`}</strong>
                  </>
                )}
              </span>
              {p > 0 && (
                <span className="tarjeta-conteo__pedidos">
                  {formatNum(p)} ya {p === 1 ? 'vendida' : 'vendidas'} en {porDespachar.get(`${cat}|${it.codigo}`)!.pedidos === 1 ? 'un pedido' : `${porDespachar.get(`${cat}|${it.codigo}`)!.pedidos} pedidos`} sin despachar
                </span>
              )}
            </div>
          );
        })}
        {visibles.length === 0 && <p className="elegir__nada">No hay nada para mostrar con este filtro.</p>}
      </div>

      {error && <p className="aviso-fuerte" role="alert">{error}</p>}

      {contadosConPedidos.length > 0 && (
        <div className="aviso-fuerte pedidos-estante" role="group" aria-label="Pedidos sin despachar">
          <p>
            <strong>Hay pedidos en preparación que todavía no salieron.</strong> El sistema ya descontó esa
            mercadería ({contadosConPedidos.length === 1 ? 'un producto' : `${contadosConPedidos.length} productos`} de
            los que contaste). ¿Dónde estaba cuando contaste?
          </p>
          <div className="elegir__cats">
            <button type="button" className={'opcion-chica' + (pedidosEnEstante === 'contados' ? ' opcion-chica--activa' : '')} onClick={() => setPedidosEnEstante('contados')}>
              En el estante: la conté
            </button>
            <button type="button" className={'opcion-chica' + (pedidosEnEstante === 'apartados' ? ' opcion-chica--activa' : '')} onClick={() => setPedidosEnEstante('apartados')}>
              Apartada: no la conté
            </button>
          </div>
        </div>
      )}

      <div className="barra-guardar">
        {confirmando ? (
          <>
            <p className="num">
              Vas a guardar <strong>{conNumero.length}</strong> números. <strong>{diferencias.length}</strong> no coinciden con el sistema y van a
              quedar anotados como diferencia. ¿Seguro?
            </p>
            <div className="tarea__acciones">
              <button className="btn-grande btn-grande--claro" onClick={() => setConfirmando(false)}>Revisar de nuevo</button>
              <button className="btn-grande btn-grande--naranja" disabled={guardando} onClick={guardar}>
                {guardando ? 'Guardando…' : 'Sí, guardar'}
              </button>
            </div>
          </>
        ) : (
          <>
            <p>Podés dejarlo a medias y seguir otro día: lo que escribiste queda en esta computadora. Nada cambia hasta tocar <strong>Guardar el conteo</strong>.</p>
            <div className="tarea__acciones">
              <button className="btn-grande btn-grande--naranja" disabled={conNumero.length === 0 || faltaDecidir} onClick={() => setConfirmando(true)}>
                {faltaDecidir ? 'Decí dónde estaban los pedidos' : 'Guardar el conteo'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
