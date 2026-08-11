// =====================================================================
// PEDIDOS DE LA TIENDA — el puente entre somossetas.com.ar y el inventario.
//
// Cuando un pedido pasa a "confirmado", la base descuenta el stock sola (lo
// hace un disparador en Supabase, no esta pantalla). Acá se ve qué se descontó,
// qué quedó pendiente y por qué, y se arregla el vínculo entre lo que vende la
// web y lo que cuenta el inventario.
//
// Los pedidos que ya estaban confirmados ANTES de conectar los dos sistemas no
// se tocan solos: se aplican de a uno, o se marcan como ya descontados.
// =====================================================================
import {
  AlertTriangle,
  Check,
  Link2,
  Package,
  RefreshCw,
  RotateCcw,
  ShoppingBag,
  Store,
  Users,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useToast } from '../components/Toast';
import {
  borrarSkuMap,
  guardarSkuMap,
  ignorarPedido,
  sincronizarPedido,
  traerCatalogoTienda,
  traerPedidosTienda,
  traerSkuMap,
  type SkuTienda,
} from '../lib/cloud';
import { formatFecha, formatNum } from '../lib/helpers';
import { useStore } from '../lib/store';
import type { PedidoTienda, SkuMap } from '../lib/types';

/** Estados en los que el pedido ya cuenta como venta y debe estar descontado */
const ESTADOS_DESCUENTAN = ['confirmado', 'preparacion', 'enviado', 'entregado'];

const ESTADO_LABEL: Record<string, string> = {
  nuevo: 'Nuevo',
  confirmado: 'Confirmado',
  preparacion: 'En preparación',
  enviado: 'Enviado',
  entregado: 'Entregado',
  anulado: 'Anulado',
};

/**
 * Si las tablas del puente no existen, el error de Postgrest es incomprensible
 * ("Could not find the table in the schema cache"). Se traduce a lo único que
 * hay que hacer: correr el script una vez.
 */
function traducirError(msg: string): string {
  if (/schema cache|does not exist|st_pedidos|st_sku_map|st_aplicar_pedido/i.test(msg)) {
    return (
      'Todavía no está conectada la tienda con el stock. Hay que ejecutar una sola vez el script ' +
      'supabase/stock_tienda.sql en el SQL Editor de Supabase.'
    );
  }
  return msg;
}

export function PedidosView() {
  const { state, puedeEditar, refrescar } = useStore();
  const toast = useToast();
  const [tab, setTab] = useState<'pedidos' | 'vinculos'>('pedidos');
  const [pedidos, setPedidos] = useState<PedidoTienda[]>([]);
  const [mapa, setMapa] = useState<SkuMap[]>([]);
  const [catalogo, setCatalogo] = useState<SkuTienda[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [trabajando, setTrabajando] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const [p, m, c] = await Promise.all([
        traerPedidosTienda(),
        traerSkuMap(),
        traerCatalogoTienda().catch(() => [] as SkuTienda[]),
      ]);
      setPedidos(p);
      setMapa(m);
      setCatalogo(c);
      setError(null);
    } catch (err) {
      setError(traducirError(err instanceof Error ? err.message : String(err)));
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    cargar();
  }, [cargar]);

  const resumen = useMemo(() => {
    let descontados = 0;
    let pendientes = 0;
    let internos = 0;
    let lineasSueltas = 0;
    for (const p of pedidos) {
      const deberia = ESTADOS_DESCUENTAN.includes(p.estado);
      if (p.aplicado) descontados++;
      else if (deberia && !p.ignorar) pendientes++;
      if (p.interno) internos++;
      lineasSueltas += p.sinMapear.length;
    }
    return { descontados, pendientes, internos, lineasSueltas };
  }, [pedidos]);

  async function accion(id: string, fn: () => Promise<any>, exito: string) {
    setTrabajando(id);
    try {
      await fn();
      await Promise.all([cargar(), refrescar()]);
      toast(exito);
    } catch (err) {
      toast(traducirError(err instanceof Error ? err.message : String(err)), true);
    } finally {
      setTrabajando(null);
    }
  }

  if (cargando) {
    return (
      <div className="card">
        <div className="empty">
          <RefreshCw size={28} className="spin" />
          <p>Buscando los pedidos de la tienda…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="stack">
      <div className="toolbar">
        <div className="chips">
          <button
            className={'chip' + (tab === 'pedidos' ? ' active' : '')}
            onClick={() => setTab('pedidos')}
          >
            Pedidos
          </button>
          <button
            className={'chip' + (tab === 'vinculos' ? ' active' : '')}
            onClick={() => setTab('vinculos')}
          >
            Vínculo con la tienda
          </button>
        </div>
        <div className="toolbar__spacer" />
        <button className="btn btn--sm" onClick={cargar}>
          <RefreshCw size={14} /> Actualizar
        </button>
      </div>

      {error && (
        <div className="card">
          <div className="card__body" style={{ color: 'var(--critico)' }}>
            <AlertTriangle size={16} style={{ verticalAlign: 'middle' }} /> No se pudieron traer los
            pedidos: {error}
          </div>
        </div>
      )}

      {tab === 'pedidos' ? (
        <>
          <div className="grid grid--kpi">
            <Kpi
              icon={<Check size={19} />}
              color="var(--ok)"
              bg="var(--ok-bg)"
              valor={formatNum(resumen.descontados)}
              label="Pedidos descontados"
              foot="Ya impactaron en el stock"
            />
            <Kpi
              icon={<AlertTriangle size={19} />}
              color={resumen.pendientes ? 'var(--bajo)' : 'var(--verde-700)'}
              bg={resumen.pendientes ? 'var(--bajo-bg)' : 'var(--crema-3)'}
              valor={formatNum(resumen.pendientes)}
              label="Confirmados sin descontar"
              foot={resumen.pendientes ? 'Revisalos abajo' : 'Todo al día'}
            />
            <Kpi
              icon={<Users size={19} />}
              color="#6a4f7a"
              bg="#efe6f5"
              valor={formatNum(resumen.internos)}
              label="Consumo interno"
              foot="Pedidos sin venta"
            />
            <Kpi
              icon={<Link2 size={19} />}
              color={resumen.lineasSueltas ? 'var(--critico)' : 'var(--verde-700)'}
              bg={resumen.lineasSueltas ? 'var(--critico-bg)' : 'var(--crema-3)'}
              valor={formatNum(resumen.lineasSueltas)}
              label="Líneas sin vincular"
              foot={resumen.lineasSueltas ? 'No descontaron stock' : 'Todas vinculadas'}
            />
          </div>

          <div className="card">
            <div className="card__head">
              <ShoppingBag size={18} />
              <h3>Pedidos de la tienda</h3>
              <span className="pill" style={{ marginLeft: 'auto' }}>{pedidos.length}</span>
            </div>
            <div className="table-wrap">
              <table className="tbl">
                <thead>
                  <tr>
                    <th className="no-sort">Fecha</th>
                    <th className="no-sort">Pedido</th>
                    <th className="no-sort">Cliente</th>
                    <th className="no-sort">Estado</th>
                    <th className="num">Unidades</th>
                    <th className="no-sort">Stock</th>
                    <th className="no-sort">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {pedidos.map((p) => {
                    const unidades = p.items.reduce((s, i) => s + i.qty, 0);
                    const deberia = ESTADOS_DESCUENTAN.includes(p.estado);
                    const ocupado = trabajando === p.order_id;
                    return (
                      <tr key={p.order_id}>
                        <td className="muted" style={{ fontSize: 12 }}>{formatFecha(p.fecha)}</td>
                        <td className="codigo">
                          {p.order_id}
                          {p.interno && (
                            <div>
                              <span
                                className="pill"
                                style={{ background: '#efe6f5', color: '#6a4f7a', borderColor: 'transparent' }}
                              >
                                consumo interno
                              </span>
                            </div>
                          )}
                        </td>
                        <td className="nombre">{p.cliente}</td>
                        <td>
                          <span className="pill">{ESTADO_LABEL[p.estado] ?? p.estado}</span>
                        </td>
                        <td className="num">{formatNum(unidades)}</td>
                        <td>
                          <EstadoStock pedido={p} deberia={deberia} />
                          {p.sinMapear.length > 0 && (
                            <div className="hlp diff-neg" style={{ marginTop: 3 }}>
                              {p.sinMapear.length} línea(s) sin vincular
                            </div>
                          )}
                          {p.nota && <div className="hlp">{p.nota}</div>}
                        </td>
                        <td>
                          {puedeEditar && (
                            <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                              {!p.aplicado && deberia && !p.ignorar && (
                                <>
                                  <button
                                    className="btn btn--sm btn--primary"
                                    disabled={ocupado}
                                    onClick={() =>
                                      accion(
                                        p.order_id,
                                        () => sincronizarPedido(p.order_id),
                                        `Stock descontado del pedido ${p.order_id}`
                                      )
                                    }
                                  >
                                    Descontar
                                  </button>
                                  <button
                                    className="btn btn--sm"
                                    disabled={ocupado}
                                    title="Este pedido ya se había descontado a mano"
                                    onClick={() =>
                                      accion(
                                        p.order_id,
                                        () => ignorarPedido(p.order_id, true),
                                        'Marcado como ya descontado'
                                      )
                                    }
                                  >
                                    Ya descontado
                                  </button>
                                </>
                              )}
                              {p.aplicado && (
                                <button
                                  className="btn btn--sm"
                                  disabled={ocupado}
                                  title="Devuelve al stock lo que descontó este pedido"
                                  onClick={() =>
                                    accion(
                                      p.order_id,
                                      () => sincronizarPedido(p.order_id, true),
                                      `Stock devuelto del pedido ${p.order_id}`
                                    )
                                  }
                                >
                                  <RotateCcw size={13} /> Devolver
                                </button>
                              )}
                              {p.ignorar && (
                                <button
                                  className="btn btn--sm"
                                  disabled={ocupado}
                                  onClick={() =>
                                    accion(
                                      p.order_id,
                                      () => ignorarPedido(p.order_id, false),
                                      'El pedido vuelve a la cola'
                                    )
                                  }
                                >
                                  Deshacer
                                </button>
                              )}
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                  {pedidos.length === 0 && (
                    <tr>
                      <td colSpan={7}>
                        <div className="empty">
                          <Store size={30} />
                          <p>Todavía no hay pedidos de la tienda.</p>
                        </div>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Lo que no se pudo descontar, junto y explicado */}
          {resumen.lineasSueltas > 0 && (
            <div className="card">
              <div className="card__head">
                <AlertTriangle size={18} color="var(--critico)" />
                <h3>Líneas que no descontaron stock</h3>
              </div>
              <div className="table-wrap">
                <table className="tbl">
                  <thead>
                    <tr>
                      <th className="no-sort">Pedido</th>
                      <th className="no-sort">Producto en la web</th>
                      <th className="num">Cant.</th>
                      <th className="no-sort">Por qué</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pedidos.flatMap((p) =>
                      p.sinMapear.map((l, i) => (
                        <tr key={p.order_id + i}>
                          <td className="codigo">{p.order_id}</td>
                          <td className="nombre">
                            {l.descripcion}
                            {l.producto_id && (
                              <div className="hlp">{l.producto_id} / {l.pres_id}</div>
                            )}
                          </td>
                          <td className="num">{formatNum(l.cantidad)}</td>
                          <td className="muted" style={{ fontSize: 12 }}>{l.motivo}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
              <div className="card__body">
                <button className="btn btn--sm" onClick={() => setTab('vinculos')}>
                  <Link2 size={14} /> Ir a vincular
                </button>
              </div>
            </div>
          )}
        </>
      ) : (
        <Vinculos
          mapa={mapa}
          catalogo={catalogo}
          productos={state.productos}
          puedeEditar={puedeEditar}
          onCambio={cargar}
        />
      )}
    </div>
  );
}

function EstadoStock({ pedido, deberia }: { pedido: PedidoTienda; deberia: boolean }) {
  if (pedido.aplicado)
    return (
      <span className="badge-estado st-ok">
        Descontado{pedido.aplicadoAt ? ` · ${formatFecha(pedido.aplicadoAt)}` : ''}
      </span>
    );
  if (pedido.ignorar) return <span className="badge-estado">Descontado a mano</span>;
  if (deberia) return <span className="badge-estado st-bajo">Pendiente</span>;
  return <span className="muted" style={{ fontSize: 12 }}>Sin efecto</span>;
}

/** Editor del vínculo SKU de la tienda ↔ ítem del inventario */
function Vinculos({
  mapa,
  catalogo,
  productos,
  puedeEditar,
  onCambio,
}: {
  mapa: SkuMap[];
  catalogo: SkuTienda[];
  productos: { codigo: string; nombre: string; presentacion: string }[];
  puedeEditar: boolean;
  onCambio: () => Promise<void>;
}) {
  const toast = useToast();
  const [guardando, setGuardando] = useState<string | null>(null);
  const [soloProblemas, setSoloProblemas] = useState(false);

  // Se listan TODOS los SKU del catálogo de la web (aunque no tengan vínculo),
  // más cualquier vínculo viejo cuyo producto ya no esté en el catálogo.
  const filas = useMemo(() => {
    const porClave = new Map<string, SkuMap>();
    for (const m of mapa) porClave.set(`${m.producto_id}/${m.pres_id}`, m);

    const out = catalogo.map((sku) => ({
      sku,
      map: porClave.get(`${sku.producto_id}/${sku.pres_id}`) ?? null,
    }));

    const enCatalogo = new Set(catalogo.map((s) => `${s.producto_id}/${s.pres_id}`));
    for (const m of mapa) {
      const clave = `${m.producto_id}/${m.pres_id}`;
      if (enCatalogo.has(clave)) continue;
      out.push({
        sku: {
          producto_id: m.producto_id,
          pres_id: m.pres_id,
          producto: m.etiqueta ?? m.producto_id,
          presentacion: '(ya no está en el catálogo de la web)',
        },
        map: m,
      });
    }
    return out;
  }, [mapa, catalogo]);

  const visibles = soloProblemas
    ? filas.filter((f) => !f.map || f.map.revisar || !f.map.activo)
    : filas;

  const sinVincular = filas.filter((f) => !f.map).length;
  const aRevisar = filas.filter((f) => f.map?.revisar).length;

  async function cambiar(
    sku: SkuTienda,
    actual: SkuMap | null,
    cambios: Partial<SkuMap>
  ) {
    const clave = `${sku.producto_id}/${sku.pres_id}`;
    setGuardando(clave);
    try {
      const siguiente: SkuMap = {
        producto_id: sku.producto_id,
        pres_id: sku.pres_id,
        categoria: 'producto',
        codigo: actual?.codigo ?? '',
        unidades: actual?.unidades ?? 1,
        activo: actual?.activo ?? true,
        revisar: actual?.revisar ?? false,
        etiqueta: actual?.etiqueta ?? `${sku.producto} — ${sku.presentacion}`,
        ...cambios,
      };
      if (!siguiente.codigo) {
        if (actual) await borrarSkuMap(sku.producto_id, sku.pres_id);
      } else {
        await guardarSkuMap(siguiente);
      }
      await onCambio();
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), true);
    } finally {
      setGuardando(null);
    }
  }

  return (
    <div className="card">
      <div className="card__head">
        <Link2 size={18} />
        <h3>Qué ítem del inventario descuenta cada producto de la web</h3>
        <div className="chips" style={{ marginLeft: 12 }}>
          <button
            className={'chip' + (!soloProblemas ? ' active' : '')}
            onClick={() => setSoloProblemas(false)}
          >
            Todos ({filas.length})
          </button>
          <button
            className={'chip' + (soloProblemas ? ' active' : '')}
            onClick={() => setSoloProblemas(true)}
          >
            A revisar ({sinVincular + aRevisar})
          </button>
        </div>
      </div>
      <div className="card__body" style={{ paddingBottom: 0 }}>
        <p className="hlp" style={{ margin: 0 }}>
          Cuando un pedido se confirma, cada línea busca acá qué ítem tiene que descontar.
          <strong> Unidades</strong> es cuántas unidades del inventario consume una unidad vendida
          (1 en casi todos los casos; sirve para packs). Lo marcado como{' '}
          <em>presentación distinta</em> es un vínculo que armamos automáticamente pero donde la web
          y el inventario no coinciden en el tamaño: conviene confirmarlo.
        </p>
      </div>
      <div className="table-wrap">
        <table className="tbl">
          <thead>
            <tr>
              <th className="no-sort">Producto en la web</th>
              <th className="no-sort">Ítem del inventario</th>
              <th className="num" style={{ width: 110 }}>Unidades</th>
              <th className="no-sort" style={{ width: 150 }}>Estado</th>
            </tr>
          </thead>
          <tbody>
            {visibles.map(({ sku, map }) => {
              const clave = `${sku.producto_id}/${sku.pres_id}`;
              const ocupado = guardando === clave;
              return (
                <tr key={clave} style={!map ? { background: 'var(--critico-bg)' } : undefined}>
                  <td className="nombre">
                    {sku.producto}
                    <div className="hlp">{sku.presentacion}</div>
                  </td>
                  <td>
                    <select
                      className="select"
                      disabled={!puedeEditar || ocupado}
                      value={map?.codigo ?? ''}
                      onChange={(e) => cambiar(sku, map, { codigo: e.target.value, revisar: false })}
                    >
                      <option value="">— sin vincular (no descuenta) —</option>
                      {productos.map((p) => (
                        <option key={p.codigo} value={p.codigo}>
                          {p.codigo} — {p.nombre} ({p.presentacion})
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="num">
                    <input
                      className="input"
                      type="number"
                      min={1}
                      step="any"
                      style={{ width: 80, textAlign: 'right' }}
                      disabled={!puedeEditar || ocupado || !map}
                      defaultValue={map?.unidades ?? 1}
                      onBlur={(e) => {
                        const v = Number(e.target.value) || 1;
                        if (map && v !== map.unidades) cambiar(sku, map, { unidades: v });
                      }}
                    />
                  </td>
                  <td>
                    {!map ? (
                      <span className="badge-estado st-agotado">Sin vincular</span>
                    ) : map.revisar ? (
                      <button
                        className="btn btn--sm"
                        disabled={!puedeEditar || ocupado}
                        title="Confirmar que el vínculo está bien"
                        onClick={() => cambiar(sku, map, { revisar: false })}
                      >
                        <AlertTriangle size={13} color="var(--bajo)" /> Presentación distinta
                      </button>
                    ) : (
                      <span className="badge-estado st-ok">
                        <Package size={12} style={{ verticalAlign: 'middle' }} /> Vinculado
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
            {visibles.length === 0 && (
              <tr>
                <td colSpan={4}>
                  <div className="empty">
                    {catalogo.length === 0
                      ? 'No se pudo leer el catálogo de la tienda.'
                      : '¡Todos los productos de la web están vinculados! 🍄'}
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Kpi({
  icon, color, bg, valor, label, foot,
}: {
  icon: React.ReactNode; color: string; bg: string; valor: string; label: string; foot?: string;
}) {
  return (
    <div className="kpi">
      <div className="kpi__icon" style={{ background: bg, color }}>{icon}</div>
      <div className="kpi__value">{valor}</div>
      <div className="kpi__label">{label}</div>
      {foot && <div className="kpi__foot">{foot}</div>}
    </div>
  );
}
