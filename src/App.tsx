import {
  AlertTriangle,
  Boxes,
  CalendarClock,
  ClipboardList,
  CloudUpload,
  Database,
  Download,
  Eye,
  FlaskConical,
  History,
  LayoutDashboard,
  LogOut,
  RefreshCw,
  RotateCcw,
  ScanLine,
  ShoppingBag,
  Store,
  Tag,
  TrendingUp,
  Users,
  Wheat,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useToast } from './components/Toast';
import { useAuth } from './lib/auth';
import { descargarBackup } from './lib/backup';
import { alertasVencimiento, calcEstado, diasAvisoGuardado, listaDe } from './lib/helpers';
import { useStore } from './lib/store';
import type { Categoria } from './lib/types';
import { CategoriaView } from './views/CategoriaView';
import { Dashboard } from './views/Dashboard';
import { MovimientosView } from './views/MovimientosView';
import { PedidosView } from './views/PedidosView';
import { ProductosView } from './views/ProductosView';
import { ReposicionView } from './views/ReposicionView';
import { UsuariosView } from './views/UsuariosView';
import { VenderView } from './views/VenderView';
import { VentasView } from './views/VentasView';

const logo = '/brand/logo-blanco.png';

type ViewId =
  | 'dashboard'
  | 'vender'
  | 'producto'
  | 'insumo'
  | 'insumo_interno'
  | 'etiqueta'
  | 'materia_prima'
  | 'reposicion'
  | 'ventas'
  | 'pedidos'
  | 'movimientos'
  | 'usuarios';

const TITLES: Record<ViewId, { t: string; s: string }> = {
  dashboard: { t: 'Dashboard', s: 'Panorama general del stock' },
  vender: {
    t: 'Vender / Producir / Consumo',
    s: 'Escaneá y descontá stock con receta automática',
  },
  producto: { t: 'Productos', s: 'Catálogo de productos terminados' },
  insumo: { t: 'Insumos de productos', s: 'Envases, frascos, bolsas y tapas' },
  insumo_interno: { t: 'Insumos internos', s: 'Consumibles de producción y logística' },
  etiqueta: { t: 'Etiquetas', s: 'Stock de etiquetas por producto' },
  materia_prima: { t: 'Materia prima', s: 'Hongos, polvos e insumos base' },
  reposicion: {
    t: 'Reposición',
    s: 'Qué hay que producir y qué hay que comprar para poder producirlo',
  },
  ventas: { t: 'Ventas y producción', s: 'Qué se vendió, qué se produjo y qué se consumió' },
  pedidos: { t: 'Pedidos de la tienda', s: 'Los pedidos confirmados descuentan el stock solos' },
  movimientos: {
    t: 'Movimientos',
    s: 'Todo lo que entró, salió o cambió: ventas, producción, ingresos, ajustes, altas y bajas',
  },
  usuarios: { t: 'Usuarios', s: 'Quién entra a la plataforma y con qué permisos' },
};

export default function App() {
  const { state, cargando, errorCarga, vacio, puedeEditar, refrescar, restablecerDesdeExcel } =
    useStore();
  const { perfil, email, salir, esAdmin } = useAuth();
  const toast = useToast();
  const [view, setView] = useState<ViewId>('dashboard');
  const [refrescando, setRefrescando] = useState(false);

  const alertCounts = useMemo(() => {
    const count = (cat: Categoria) =>
      listaDe(state, cat).filter((it) => calcEstado(it.actual, it.minimo).faltan > 0).length;
    return {
      producto: count('producto'),
      insumo: count('insumo'),
      insumo_interno: count('insumo_interno'),
      etiqueta: count('etiqueta'),
      materia_prima: count('materia_prima'),
    };
  }, [state]);

  // Vencimientos: se recalculan con cada cambio del stock, así el aviso del
  // encabezado desaparece solo cuando se da de baja o se repone lo vencido.
  const vencimientos = useMemo(
    () => alertasVencimiento(state, diasAvisoGuardado()),
    [state]
  );

  // Aviso al entrar: un solo toast por día y por navegador, para que no
  // moleste a quien abre la plataforma veinte veces en la jornada.
  const avisado = useRef(false);
  useEffect(() => {
    if (cargando || avisado.current || vencimientos.length === 0) return;
    const hoy = new Date().toISOString().slice(0, 10);
    const clave = 'somos-setas-stock:aviso-venc-visto';
    let visto: string | null = null;
    try {
      visto = localStorage.getItem(clave);
    } catch {
      /* storage bloqueado: se avisa igual, una vez por sesión */
    }
    avisado.current = true;
    if (visto === hoy) return;
    try {
      localStorage.setItem(clave, hoy);
    } catch {
      /* ídem */
    }
    const vencidos = vencimientos.filter((v) => v.info.estado === 'vencido').length;
    const primero = vencimientos[0];
    toast(
      vencidos > 0
        ? `${vencidos} ítem(s) vencidos y ${vencimientos.length - vencidos} por vencer. El más urgente: ${primero.nombre}.`
        : `${vencimientos.length} ítem(s) por vencer. ${primero.nombre}: ${primero.info.label.toLowerCase()}.`,
      true
    );
    // toast cambia de identidad en cada render del provider: no va en las deps
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cargando, vencimientos]);

  const nav = (id: ViewId, icon: any, label: string, badge?: number) => (
    <button className={'nav__item' + (view === id ? ' active' : '')} onClick={() => setView(id)}>
      {icon}
      <span>{label}</span>
      {badge ? <span className="badge">{badge}</span> : null}
    </button>
  );

  async function actualizar() {
    setRefrescando(true);
    await refrescar();
    setRefrescando(false);
    toast('Datos actualizados desde la base');
  }

  async function backup() {
    try {
      const nombre = await descargarBackup(state, perfil?.nombre || email);
      toast(`Backup descargado: ${nombre}`);
    } catch (err) {
      toast('No se pudo generar el backup: ' + (err as Error).message, true);
    }
  }

  async function restablecer() {
    // Ahora los datos son compartidos: restablecer le cambia el stock a todo el
    // equipo, así que se avisa fuerte y se sugiere bajar el backup antes.
    if (
      !confirm(
        'Esto reemplaza TODO el inventario de la nube por los valores originales del Excel.\n\n' +
          'Le va a cambiar el stock a todo el equipo, no solo a vos. El historial de movimientos se conserva.\n\n' +
          '¿Seguro? (conviene descargar el backup antes)'
      )
    )
      return;
    const res = await restablecerDesdeExcel();
    toast(res.error ?? 'Inventario restablecido al Excel original', !!res.error);
  }

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="sidebar__brand">
          <img src={logo} alt="Somos Setas" />
          <div>
            <div className="name">Somos Setas</div>
            <div className="sub">Control de Stock</div>
          </div>
        </div>

        <nav className="nav">
          {nav('dashboard', <LayoutDashboard size={18} />, 'Dashboard')}
          {puedeEditar && nav('vender', <ScanLine size={18} />, 'Vender / Escanear')}
          {nav('reposicion', <ClipboardList size={18} />, 'Reposición', alertCounts.producto)}

          <div className="nav__section">Inventario</div>
          {nav('producto', <ShoppingBag size={18} />, 'Productos', alertCounts.producto)}
          {nav('insumo', <Boxes size={18} />, 'Insumos productos', alertCounts.insumo)}
          {nav('etiqueta', <Tag size={18} />, 'Etiquetas', alertCounts.etiqueta)}
          {nav('materia_prima', <Wheat size={18} />, 'Materia prima', alertCounts.materia_prima)}
          {nav('insumo_interno', <FlaskConical size={18} />, 'Insumos internos', alertCounts.insumo_interno)}

          <div className="nav__section">Actividad</div>
          {nav('ventas', <TrendingUp size={18} />, 'Ventas y producción')}
          {/* Los pedidos traen datos de clientes: sólo para quien administra */}
          {esAdmin && nav('pedidos', <Store size={18} />, 'Pedidos de la tienda')}
          {nav('movimientos', <History size={18} />, 'Movimientos')}
          {esAdmin && nav('usuarios', <Users size={18} />, 'Usuarios')}
        </nav>

        <div className="sidebar__user">
          <div className="sidebar__user-name">{perfil?.nombre || email}</div>
          <div className="sidebar__user-rol">
            {puedeEditar ? (
              <>Acceso total</>
            ) : (
              <>
                <Eye size={11} /> Solo lectura
              </>
            )}
          </div>
        </div>

        <div className="sidebar__footer">
          <button onClick={backup} title="Descarga un Excel con todo el inventario y el historial">
            <Download size={13} style={{ verticalAlign: 'middle', marginRight: 6 }} />
            Descargar backup (Excel)
          </button>
          {puedeEditar && (
            <button onClick={restablecer} style={{ marginTop: 8 }}>
              <RotateCcw size={13} style={{ verticalAlign: 'middle', marginRight: 6 }} />
              Restablecer datos
            </button>
          )}
          <button onClick={salir} style={{ marginTop: 8 }}>
            <LogOut size={13} style={{ verticalAlign: 'middle', marginRight: 6 }} />
            Cerrar sesión
          </button>
          <p style={{ marginTop: 10, marginBottom: 0 }}>
            <Database size={11} style={{ verticalAlign: 'middle', marginRight: 4 }} />
            Datos compartidos en la nube.
          </p>
        </div>
      </aside>

      <div className="main">
        <div className="topbar">
          <div>
            <h1>{TITLES[view].t}</h1>
            <div className="subtitle">{TITLES[view].s}</div>
          </div>
          <div className="topbar__spacer" />
          {vencimientos.length > 0 && (
            <button
              className="btn btn--sm btn--venc"
              onClick={() => setView('dashboard')}
              title={vencimientos
                .slice(0, 6)
                .map((v) => `${v.nombre}: ${v.info.label}`)
                .join('\n')}
            >
              <CalendarClock size={14} />
              {vencimientos.length} por vencer
            </button>
          )}
          {!puedeEditar && (
            <span className="pill" title="Tu usuario puede mirar todo pero no modificar nada">
              <Eye size={12} /> Modo lectura
            </span>
          )}
          <button className="btn btn--sm" onClick={actualizar} disabled={refrescando}>
            <RefreshCw size={14} className={refrescando ? 'spin' : ''} /> Actualizar
          </button>
          {puedeEditar && (
            <button className="btn btn--primary" onClick={() => setView('vender')}>
              <ScanLine size={16} /> Escanear
            </button>
          )}
        </div>

        <div className="content">
          {cargando ? (
            <div className="card">
              <div className="empty">
                <Database size={30} />
                <p>Cargando el stock desde la base de datos…</p>
              </div>
            </div>
          ) : errorCarga ? (
            <ErrorCarga mensaje={errorCarga} onReintentar={actualizar} />
          ) : vacio ? (
            <CargaInicial />
          ) : (
            <>
              {view === 'dashboard' && <Dashboard onNav={(v) => setView(v as ViewId)} />}
              {view === 'vender' && puedeEditar && <VenderView />}
              {view === 'producto' && <ProductosView />}
              {view === 'reposicion' && <ReposicionView />}
              {view === 'ventas' && <VentasView />}
              {view === 'pedidos' && esAdmin && <PedidosView />}
              {view === 'movimientos' && <MovimientosView />}
              {view === 'usuarios' && esAdmin && <UsuariosView />}
              {(view === 'insumo' ||
                view === 'insumo_interno' ||
                view === 'etiqueta' ||
                view === 'materia_prima') && <CategoriaView categoria={view} key={view} />}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function ErrorCarga({ mensaje, onReintentar }: { mensaje: string; onReintentar: () => void }) {
  return (
    <div className="card">
      <div className="empty">
        <AlertTriangle size={32} color="var(--agotado)" />
        <p style={{ fontWeight: 600, color: 'var(--texto)' }}>No se pudieron cargar los datos</p>
        <p style={{ maxWidth: 520, margin: '0 auto 16px' }}>{mensaje}</p>
        <button className="btn btn--primary" onClick={onReintentar}>
          <RefreshCw size={15} /> Reintentar
        </button>
      </div>
    </div>
  );
}

/**
 * La base está vacía: hay que hacer la carga inicial una sola vez. Se ofrece
 * subir lo que tenía guardado este navegador (los datos reales con los que se
 * venía trabajando) o arrancar desde el Excel original.
 */
function CargaInicial() {
  const { datosLocales, cargaInicial, puedeEditar, guardando } = useStore();
  const toast = useToast();

  async function subir(origen: 'navegador' | 'excel') {
    const res = await cargaInicial(origen);
    toast(res.error ?? 'Datos cargados en la base. Ya los ve todo el equipo.', !!res.error);
  }

  const total = datosLocales
    ? datosLocales.productos.length +
      datosLocales.insumos.length +
      datosLocales.insumosInternos.length +
      datosLocales.etiquetas.length +
      datosLocales.materiaPrima.length
    : 0;

  return (
    <div className="card">
      <div className="card__head">
        <CloudUpload size={18} />
        <h3>Carga inicial de la base</h3>
      </div>
      <div className="card__body">
        <p style={{ marginTop: 0 }}>
          La base de datos todavía no tiene inventario cargado. Esto se hace <strong>una sola
          vez</strong>: a partir de ahí, todos trabajan sobre los mismos números.
        </p>

        {!puedeEditar ? (
          <p className="hlp">
            Tu usuario es de solo lectura. Pedile a un administrador que haga la carga inicial.
          </p>
        ) : (
          <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', marginTop: 18 }}>
            <div className="card" style={{ padding: 18 }}>
              <h4 style={{ fontSize: 15, marginBottom: 6 }}>Subir lo de este navegador</h4>
              <p className="hlp" style={{ minHeight: 54 }}>
                {datosLocales
                  ? `Se encontraron ${total} ítems y ${datosLocales.movimientos.length} movimientos guardados en esta computadora, con todos los cambios que venías haciendo. Es la opción recomendada.`
                  : 'Esta computadora no tiene datos guardados de antes.'}
              </p>
              <button
                className="btn btn--primary"
                disabled={!datosLocales || guardando}
                onClick={() => subir('navegador')}
              >
                <CloudUpload size={15} /> {guardando ? 'Subiendo…' : 'Subir a la nube'}
              </button>
            </div>

            <div className="card" style={{ padding: 18 }}>
              <h4 style={{ fontSize: 15, marginBottom: 6 }}>Empezar del Excel original</h4>
              <p className="hlp" style={{ minHeight: 54 }}>
                Carga el inventario tal como salió del Excel de control de stock, sin los cambios
                posteriores.
              </p>
              <button className="btn" disabled={guardando} onClick={() => subir('excel')}>
                <RotateCcw size={15} /> Cargar el Excel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
