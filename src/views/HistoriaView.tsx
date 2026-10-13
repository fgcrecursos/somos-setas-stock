// =====================================================================
// LA HISTORIA DE UN ÍTEM, DÍA POR DÍA
// Cuánto hay, desde cuándo se cuenta (el último conteo del estante), qué
// entró, qué salió y qué diferencias aparecieron al contar. Para un
// componente, además: en qué productos se gastó.
// Tocar una línea abre el detalle completo del movimiento.
// =====================================================================
import { ArrowLeft } from 'lucide-react';
import { useMemo, useState } from 'react';
import { MovimientoModal } from '../components/MovimientoModal';
import { FotoItem, Titulo } from '../components/Tareas';
import { cuanto, esCorreccion, etiquetaDia, hay, gastoPorProducto, historiaDe, hora, trozos, type Frase } from '../lib/frases';
import { CATEGORIA_LABEL, buscarItem, formatNum } from '../lib/helpers';
import { useStore } from '../lib/store';
import type { Categoria, Movimiento } from '../lib/types';

type Filtro = 'todo' | 'entradas' | 'salidas' | 'conteos';

export function HistoriaView({ categoria, codigo, onVolver }: { categoria: Categoria; codigo: string; onVolver: () => void }) {
  const { state } = useStore();
  const item = buscarItem(state, categoria, codigo) as any;
  const [filtro, setFiltro] = useState<Filtro>('todo');
  const [abierto, setAbierto] = useState<Movimiento | null>(null);

  const frases = useMemo(() => historiaDe(categoria, codigo, state), [categoria, codigo, state]);

  // El último conteo del estante es el punto de partida del resumen
  const partida = frases.find((f) => f.mov.tipo === 'restablecer' && f.mov.codigo === codigo);
  const desde = partida?.fecha;
  const resumen = useMemo(() => {
    let entradas = 0, salidas = 0, diferencias = 0;
    for (const f of frases) {
      if (desde && f.fecha <= desde) continue;
      if (f.mov.codigo === codigo && esCorreccion(f.mov)) diferencias += f.cambio;
      else if (f.cambio > 0) entradas += f.cambio;
      else salidas += f.cambio;
    }
    return { entradas, salidas, diferencias };
  }, [frases, desde]);

  const gastos = useMemo(
    () => (categoria === 'producto' ? [] : gastoPorProducto(categoria, codigo, state, desde)),
    [categoria, codigo, state, desde]
  );

  const visibles = frases.filter((f) => {
    const corr = f.mov.codigo === codigo && esCorreccion(f.mov);
    if (filtro === 'conteos') return corr;
    if (filtro === 'entradas') return f.cambio > 0 && !corr;
    if (filtro === 'salidas') return f.cambio < 0 && !corr;
    return true;
  });
  const porDia: { dia: string; frases: Frase[] }[] = [];
  for (const f of visibles) {
    const dia = etiquetaDia(f.fecha);
    const ultimo = porDia[porDia.length - 1];
    if (ultimo?.dia === dia) ultimo.frases.push(f);
    else porDia.push({ dia, frases: [f] });
  }

  if (!item)
    return (
      <div className="tarea">
        <button className="volver" onClick={onVolver}><ArrowLeft size={22} /> Volver</button>
        <p>Este ítem ya no está en el inventario.</p>
      </div>
    );

  const entradaTxt = categoria === 'producto' ? 'Se produjeron' : 'Entraron';
  const salidaTxt = categoria === 'producto' ? 'Salieron' : 'Se usaron';

  return (
    <div className="tarea">
      <button className="volver" onClick={onVolver}><ArrowLeft size={22} /> Volver</button>

      <div className="historia__cabeza">
        <FotoItem item={item} categoria={categoria} tam={120} />
        <div className="historia__nombre">
          <span className="nota-chica">{CATEGORIA_LABEL[categoria]} · {item.codigo}</span>
          <Titulo marcado={item.nombre} titulo={item.nombre} sub={[item.tipo, item.presentacion, item.unidad && `se cuenta en ${item.unidad}`].filter(Boolean).join(' · ')} />
        </div>
        <div className="numero-grande num">
          <span>Hay ahora</span>
          <strong>{formatNum(item.actual)}</strong>
          <span>{hay(item.actual, item).replace(/^[\d.,-]+\s*/, '')}</span>
        </div>
      </div>

      <div className="resumen num">
        <div className="resumen__caja">
          <span>{partida ? `Último conteo, ${new Date(partida.fecha).toLocaleDateString('es-AR', { day: 'numeric', month: 'numeric' })}` : 'Sin conteo del estante todavía'}</span>
          <strong>{partida?.despues != null ? formatNum(partida.despues) : '—'}</strong>
        </div>
        <div className="resumen__caja"><span>{entradaTxt} desde entonces</span><strong>+{formatNum(resumen.entradas)}</strong></div>
        <div className="resumen__caja"><span>{salidaTxt} desde entonces</span><strong>{formatNum(resumen.salidas)}</strong></div>
        <div className={'resumen__caja' + (resumen.diferencias ? ' resumen__caja--dif' : '')}>
          <span>Correcciones (conteos y a mano)</span>
          <strong>{resumen.diferencias > 0 ? '+' : ''}{formatNum(resumen.diferencias)}</strong>
        </div>
      </div>

      {categoria !== 'producto' && (
        <section className="bloque">
          <h2>En qué se gastó{desde ? ' desde el último conteo' : ''}</h2>
          {gastos.length === 0 ? (
            <p className="nota-chica">Todavía no se usó en ninguna producción{desde ? ' desde el último conteo' : ''}.</p>
          ) : (
            gastos.map((g) => {
              const p = buscarItem(state, 'producto', g.codigo);
              return (
                <div key={g.codigo} className="linea-gasto num">
                  {p && <FotoItem item={p as any} categoria="producto" tam={44} />}
                  <span><strong>{g.nombre}</strong> · {formatNum(g.producidos)} producidos</span>
                  <strong>{cuanto(g.usado, item)}</strong>
                </div>
              );
            })
          )}
          <p className="nota-chica">Solo cuentan las producciones: cuando se vende un producto, sus componentes ya se habían descontado.</p>
        </section>
      )}

      <section className="bloque">
        <div className="bloque__cabeza">
          <h2>Qué le pasó, día por día</h2>
          <div role="group" aria-label="Filtrar" className="elegir__cats">
            {([['todo', 'Todo'], ['entradas', categoria === 'producto' ? 'Producción' : 'Entradas'], ['salidas', 'Salidas'], ['conteos', 'Correcciones']] as const).map(([id, txt]) => (
              <button key={id} type="button" className={'opcion-chica' + (filtro === id ? ' opcion-chica--activa' : '')} onClick={() => setFiltro(id)}>{txt}</button>
            ))}
          </div>
        </div>
        {porDia.length === 0 && <p className="nota-chica">No hay movimientos para mostrar.</p>}
        {porDia.map(({ dia, frases: fs }) => (
          <div key={dia}>
            <div className="dia">{dia}</div>
            {fs.map((f) => (
              <button key={f.id} type="button" className={'evento num' + (f.diferencia ? ' evento--dif' : '')} onClick={() => setAbierto(f.mov)}>
                <span className="evento__hora">{hora(f.fecha)}</span>
                <span className="evento__txt">
                  <span>{trozos(f.titulo).map((p, i) => (p.b ? <strong key={i}>{p.t}</strong> : <span key={i}>{p.t}</span>))}</span>
                  {f.detalle && <small>{f.detalle}</small>}
                </span>
                <span className="evento__stock">
                  {f.antes != null && f.despues != null ? (
                    <>{formatNum(f.antes)} → <strong>{formatNum(f.despues)}</strong></>
                  ) : f.despues != null ? (
                    <strong>{formatNum(f.despues)}</strong>
                  ) : null}
                </span>
              </button>
            ))}
          </div>
        ))}
      </section>

      {abierto && <MovimientoModal movimiento={abierto} onClose={() => setAbierto(null)} onIr={(id) => setAbierto(state.movimientos.find((m) => m.id === id) ?? null)} />}
    </div>
  );
}
