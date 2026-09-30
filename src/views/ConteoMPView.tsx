// =====================================================================
// CONTEO DE MATERIA PRIMA — pasar de "bolsas" a gramos.
//
// Una materia prima por vez: se pesa lo que hay, se elige la unidad y se
// carga cuánto lleva una unidad de cada producto que la usa. Las tres cosas
// se guardan juntas (ver pasarMateriaPrima en store.tsx). Se carga directo
// acá, en el depósito: sin planilla intermedia.
// =====================================================================
import { CheckCircle2, Scale, Search, Wand2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Modal } from '../components/Modal';
import { Cantidad } from '../components/StatusBadge';
import { useToast } from '../components/Toast';
import { traerSkuMap } from '../lib/cloud';
import {
  UNIDADES_CONTEO,
  descripcionesPorProducto,
  minimoSugerido,
  tieneUnidad,
  unidadSugerida,
  usosDe,
  type UnidadConteo,
} from '../lib/conteoMP';
import { abrevUnidad, coincideBusqueda, formatNum } from '../lib/helpers';
import { useStore } from '../lib/store';
import type { MateriaPrima } from '../lib/types';

type Filtro = 'pendientes' | 'contadas' | 'todas';

export function ConteoMPView() {
  const { state, puedeEditar } = useStore();
  const [filtro, setFiltro] = useState<Filtro>('pendientes');
  const [q, setQ] = useState('');
  const [contar, setContar] = useState<string | null>(null);
  const [tienda, setTienda] = useState<Map<string, string[]>>(new Map());

  // Las descripciones de la tienda dicen "60u × 500 mg": de ahí sale la
  // sugerencia de gramos de las cápsulas. Si no se pueden leer, no se sugiere.
  useEffect(() => {
    let vivo = true;
    traerSkuMap()
      .then((m) => vivo && setTienda(descripcionesPorProducto(m)))
      .catch(() => {
        /* sin vínculo con la tienda: las cápsulas quedan sin sugerencia */
      });
    return () => {
      vivo = false;
    };
  }, []);

  const mps = state.materiaPrima as MateriaPrima[];
  const contadas = mps.filter(tieneUnidad).length;
  const usos = useMemo(() => {
    const n = new Map<string, number>();
    for (const p of state.productos)
      for (const b of p.bom ?? [])
        if (b.categoria === 'materia_prima') n.set(b.codigo, (n.get(b.codigo) ?? 0) + 1);
    return n;
  }, [state.productos]);

  const filas = mps
    .filter((m) => (filtro === 'pendientes' ? !tieneUnidad(m) : filtro === 'contadas' ? tieneUnidad(m) : true))
    .filter((m) => coincideBusqueda(q, m.codigo, m.nombre, m.presentacion, m.ubicacion, m.lote))
    .sort((a, b) => (usos.get(b.codigo) ?? 0) - (usos.get(a.codigo) ?? 0) || a.codigo.localeCompare(b.codigo));

  const elegida = contar ? mps.find((m) => m.codigo === contar) ?? null : null;

  return (
    <div className="stack">
      <div className="card">
        <div className="card__body">
          <p style={{ marginTop: 0 }}>
            La materia prima se contaba por envase y las recetas pedían "1" por cada unidad
            producida: <strong>cada frasco o bolsita descontaba una bolsa entera</strong>. Para que
            cierre, cada materia prima se pasa a <strong>gramos</strong> (o ml, o unidades) y en el
            mismo paso se carga cuánto lleva cada producto.
          </p>
          <ol className="conteo-pasos">
            <li>
              En el depósito, tocá <strong>Contar</strong> en cada materia prima y cargá todo lo que
              hay, pesado (una bolsa cerrada de 5 kg son 5.000 g).
            </li>
            <li>
              En el mismo formulario, cargá cuánto lleva una unidad de cada producto que la usa. Las
              sugerencias salen de la presentación o de la tienda; los de extractos, aceites, geles
              y mezclas los tiene que pasar producción.
            </li>
            <li>Al guardar, el conteo y las recetas quedan juntos.</li>
          </ol>
          <span className="muted" style={{ fontSize: 13 }}>
            <strong>{contadas}</strong> de {mps.length} materias primas ya se cuentan en su unidad.
          </span>
        </div>
      </div>

      <div className="toolbar" style={{ margin: 0 }}>
        <div className="chips">
          {(
            [
              ['pendientes', `Pendientes (${mps.length - contadas})`],
              ['contadas', `Ya contadas (${contadas})`],
              ['todas', `Todas (${mps.length})`],
            ] as [Filtro, string][]
          ).map(([id, label]) => (
            <button key={id} className={'chip' + (filtro === id ? ' active' : '')} onClick={() => setFiltro(id)}>
              {label}
            </button>
          ))}
        </div>
        <div className="toolbar__spacer" />
        <div className="conteo-buscar">
          <Search size={15} />
          <input
            className="input"
            placeholder="Buscar código, nombre, ubicación…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
      </div>

      <div className="card">
        <div className="table-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th className="no-sort">Código</th>
                <th className="no-sort">Materia prima</th>
                <th className="no-sort">Se compra como</th>
                <th className="no-sort">Ubicación</th>
                <th className="num">Hoy en el sistema</th>
                <th className="num">Recetas</th>
                <th className="no-sort">Estado</th>
                <th className="no-sort" />
              </tr>
            </thead>
            <tbody>
              {filas.map((m) => (
                <tr key={m.codigo}>
                  <td className="codigo">{m.codigo}</td>
                  <td className="nombre">{m.nombre}</td>
                  <td className="muted">{m.presentacion || '—'}</td>
                  <td className="muted">{m.ubicacion || '—'}</td>
                  <td className={'num' + (m.actual < 0 ? ' diff-neg' : '')}>
                    <Cantidad valor={m.actual} unidad={m.unidad} />
                    {!tieneUnidad(m) && <div className="hlp">sin unidad</div>}
                  </td>
                  <td className="num">{usos.get(m.codigo) ?? 0}</td>
                  <td>
                    {tieneUnidad(m) ? (
                      <span className="badge-estado st-ok">En {abrevUnidad(m.unidad)}</span>
                    ) : (
                      <span className="badge-estado st-bajo">Pendiente</span>
                    )}
                  </td>
                  <td className="actions">
                    {puedeEditar && (
                      <button className="btn btn--sm btn--fila" onClick={() => setContar(m.codigo)}>
                        <Scale className="btn__ico" size={14} />
                        <span className="btn__txt">{tieneUnidad(m) ? 'Contar de nuevo' : 'Contar'}</span>
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {filas.length === 0 && (
                <tr>
                  <td colSpan={8}>
                    <div className="empty">
                      <CheckCircle2 size={28} />
                      <p>{filtro === 'pendientes' && !q ? 'No queda ninguna pendiente.' : 'Nada coincide.'}</p>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {elegida && <ContarMP mp={elegida} tienda={tienda} onClose={() => setContar(null)} />}
    </div>
  );
}

// ---------------------------------------------------------------------
// Contar una materia prima y pasar sus recetas a la unidad nueva
// ---------------------------------------------------------------------
function ContarMP({
  mp,
  tienda,
  onClose,
}: {
  mp: MateriaPrima;
  tienda: Map<string, string[]>;
  onClose: () => void;
}) {
  const { state, pasarMateriaPrima, guardando } = useStore();
  const toast = useToast();
  const yaTenia = tieneUnidad(mp);
  const [unidad, setUnidad] = useState<UnidadConteo>(unidadSugerida(mp));
  const [conteo, setConteo] = useState('');
  // Si ya se contaba en esta unidad, el mínimo y las recetas son datos reales
  // y se muestran cargados. Si no, sólo se sugieren: nada se precarga.
  const [minimo, setMinimo] = useState(yaTenia ? String(mp.minimo) : '');
  const usos = useMemo(() => usosDe(state, mp, unidad, tienda), [state, mp, unidad, tienda]);
  const [recetas, setRecetas] = useState<Record<string, string>>(() =>
    yaTenia ? Object.fromEntries(usosDe(state, mp, unidadSugerida(mp), tienda).map((x) => [x.producto.codigo, String(x.cantidadHoy)])) : {}
  );
  const [error, setError] = useState('');

  const minSug = minimoSugerido(mp, unidad);
  const hayQueCompletar =
    (minSug && minimo.trim() === '') || usos.some((x) => x.sugerido && !(recetas[x.producto.codigo] ?? '').trim());

  function completarSugeridos() {
    if (minSug && minimo.trim() === '') setMinimo(String(minSug.cantidad));
    setRecetas((prev) => {
      const next = { ...prev };
      for (const x of usos)
        if (x.sugerido && !(next[x.producto.codigo] ?? '').trim())
          next[x.producto.codigo] = String(x.sugerido.cantidad);
      return next;
    });
  }

  async function guardar() {
    setError('');
    const n = (t: string) => (t.trim() === '' ? NaN : Number(t.replace(',', '.')));
    const c = n(conteo);
    if (!(c >= 0)) return setError(`Cargá cuánto se contó, en ${unidad}.`);
    const min = n(minimo);
    if (!(min >= 0)) return setError(`Cargá el mínimo en ${unidad} (0 si no se repone).`);
    const faltan = usos.filter((x) => !(n(recetas[x.producto.codigo] ?? '') > 0));
    if (faltan.length)
      return setError(
        `Falta cuánto lleva por unidad: ${faltan.map((x) => x.producto.codigo).join(', ')}. Si todavía no lo sabe producción, esta materia prima espera.`
      );
    const res = await pasarMateriaPrima(mp.codigo, {
      unidad,
      conteo: c,
      minimo: min,
      recetas: usos.map((x) => ({ producto: x.producto.codigo, cantidad: n(recetas[x.producto.codigo]) })),
    });
    if (!res.ok) return setError(res.error ?? 'No se pudo guardar.');
    toast(
      `${mp.nombre}: ${formatNum(c)} ${unidad}` +
        (usos.length ? ` y ${usos.length} receta(s) en ${unidad}` : '')
    );
    onClose();
  }

  return (
    <Modal
      title={`${yaTenia ? 'Contar' : 'Pasar a gramos'} · ${mp.codigo}`}
      icon={<Scale size={20} color="var(--naranja)" />}
      wide
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancelar</button>
          <button className="btn btn--primary" onClick={guardar} disabled={guardando}>
            {guardando ? 'Guardando…' : 'Guardar conteo y recetas'}
          </button>
        </>
      }
    >
      <h3 style={{ fontSize: 19, margin: 0 }}>{mp.nombre}</h3>
      <p className="hlp" style={{ margin: '4px 0 14px' }}>
        Se compra como {mp.presentacion || '—'} · hoy el sistema dice{' '}
        <strong>
          {formatNum(mp.actual)}
          {yaTenia ? ` ${abrevUnidad(mp.unidad)}` : ' (sin unidad)'}
        </strong>
        {mp.ubicacion ? ` · ubicación ${mp.ubicacion}` : ''}
      </p>

      <div className="form-row-3">
        <div className="field">
          <label>Contar en</label>
          <select className="select" value={unidad} onChange={(e) => setUnidad(e.target.value as UnidadConteo)}>
            {UNIDADES_CONTEO.map((u) => (
              <option key={u.valor} value={u.valor}>{u.label}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Contado ({unidad}) *</label>
          <input
            className="input"
            type="number"
            min={0}
            step="any"
            placeholder={`Todo lo que hay, en ${unidad}`}
            value={conteo}
            onChange={(e) => setConteo(e.target.value)}
            autoFocus
          />
        </div>
        <div className="field">
          <label>Stock mínimo ({unidad}) *</label>
          <input
            className="input"
            type="number"
            min={0}
            step="any"
            placeholder={minSug ? `sugerido: ${formatNum(minSug.cantidad)}` : '0 si no se repone'}
            value={minimo}
            onChange={(e) => setMinimo(e.target.value)}
          />
          {minSug && <span className="hlp">Sugerido {formatNum(minSug.cantidad)} {unidad}: {minSug.porque}.</span>}
        </div>
      </div>

      <div className="section-title" style={{ marginTop: 6 }}>
        Recetas que la usan · cuánto lleva UNA unidad del producto
      </div>
      {usos.length === 0 ? (
        <p className="hlp">Ninguna receta la descuenta: sólo se guarda el conteo.</p>
      ) : (
        <>
          <p className="hlp" style={{ marginTop: -4 }}>
            Se guardan junto con el conteo: desde ahí, producir 10 unidades descuenta 10 × lo que
            cargues acá. Las sugerencias salen de la presentación o de la tienda; confirmalas.
          </p>
          <div className="table-wrap">
            <table className="tbl conteo-recetas">
              <thead>
                <tr>
                  <th className="no-sort">Producto</th>
                  <th className="num">Hoy pide</th>
                  <th className="num">Por unidad ({unidad})</th>
                </tr>
              </thead>
              <tbody>
                {usos.map((x) => (
                  <tr key={x.producto.codigo}>
                    <td>
                      <span className="codigo">{x.producto.codigo}</span>{' '}
                      <strong>{x.producto.nombre}</strong>
                      <div className="hlp">
                        {x.producto.tipo} · {x.producto.presentacion || 'sin presentación'}
                        {x.lineas > 1 && ' · estaba en dos líneas: queda en una'}
                        {x.sugerido
                          ? ` · sugerido ${formatNum(x.sugerido.cantidad)} ${unidad} (${x.sugerido.porque})`
                          : ' · sin sugerencia: lo da producción'}
                      </div>
                    </td>
                    <td className="num muted">{formatNum(x.cantidadHoy)}</td>
                    <td className="num" style={{ width: 130 }}>
                      <input
                        className="input qty"
                        type="number"
                        min={0}
                        step="any"
                        placeholder={x.sugerido ? formatNum(x.sugerido.cantidad) : ''}
                        value={recetas[x.producto.codigo] ?? ''}
                        onChange={(e) => setRecetas((prev) => ({ ...prev, [x.producto.codigo]: e.target.value }))}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {hayQueCompletar && (
        <button className="btn btn--sm" style={{ marginTop: 10 }} onClick={completarSugeridos}>
          <Wand2 size={14} /> Completar los vacíos con lo sugerido
        </button>
      )}

      {error && (
        <div className="badge-estado st-agotado" style={{ marginTop: 12, padding: '9px 12px', borderRadius: 10 }}>
          {error}
        </div>
      )}
    </Modal>
  );
}
