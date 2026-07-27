import {
  Boxes,
  FlaskConical,
  History,
  LayoutDashboard,
  RotateCcw,
  ScanLine,
  ShoppingBag,
  Tag,
  Wheat,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { useToast } from './components/Toast';
import { calcEstado, listaDe } from './lib/helpers';
import { useStore } from './lib/store';
import type { Categoria } from './lib/types';
import { CategoriaView } from './views/CategoriaView';
import { Dashboard } from './views/Dashboard';
import { MovimientosView } from './views/MovimientosView';
import { ProductosView } from './views/ProductosView';
import { VenderView } from './views/VenderView';

const logo = '/brand/logo-blanco.png';

type ViewId =
  | 'dashboard'
  | 'vender'
  | 'producto'
  | 'insumo'
  | 'insumo_interno'
  | 'etiqueta'
  | 'materia_prima'
  | 'movimientos';

const TITLES: Record<ViewId, { t: string; s: string }> = {
  dashboard: { t: 'Dashboard', s: 'Panorama general del stock' },
  vender: { t: 'Vender / Producir', s: 'Escaneá y descontá stock con receta automática' },
  producto: { t: 'Productos', s: 'Catálogo de productos terminados' },
  insumo: { t: 'Insumos de productos', s: 'Envases, frascos, bolsas y tapas' },
  insumo_interno: { t: 'Insumos internos', s: 'Consumibles de producción y logística' },
  etiqueta: { t: 'Etiquetas', s: 'Stock de etiquetas por producto' },
  materia_prima: { t: 'Materia prima', s: 'Hongos, polvos e insumos base' },
  movimientos: { t: 'Movimientos', s: 'Historial de ventas, producción y ajustes' },
};

export default function App() {
  const { state, resetDatos } = useStore();
  const toast = useToast();
  const [view, setView] = useState<ViewId>('dashboard');

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

  const nav = (id: ViewId, icon: any, label: string, badge?: number) => (
    <button className={'nav__item' + (view === id ? ' active' : '')} onClick={() => setView(id)}>
      {icon}
      <span>{label}</span>
      {badge ? <span className="badge">{badge}</span> : null}
    </button>
  );

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
          {nav('vender', <ScanLine size={18} />, 'Vender / Escanear')}

          <div className="nav__section">Inventario</div>
          {nav('producto', <ShoppingBag size={18} />, 'Productos', alertCounts.producto)}
          {nav('insumo', <Boxes size={18} />, 'Insumos productos', alertCounts.insumo)}
          {nav('etiqueta', <Tag size={18} />, 'Etiquetas', alertCounts.etiqueta)}
          {nav('materia_prima', <Wheat size={18} />, 'Materia prima', alertCounts.materia_prima)}
          {nav('insumo_interno', <FlaskConical size={18} />, 'Insumos internos', alertCounts.insumo_interno)}

          <div className="nav__section">Actividad</div>
          {nav('movimientos', <History size={18} />, 'Movimientos')}
        </nav>

        <div className="sidebar__footer">
          <button
            onClick={() => {
              if (confirm('¿Restablecer todos los datos al estado original del Excel? Se perderán los cambios.')) {
                resetDatos();
                toast('Datos restablecidos al Excel original');
              }
            }}
          >
            <RotateCcw size={13} style={{ verticalAlign: 'middle', marginRight: 6 }} />
            Restablecer datos
          </button>
          <p style={{ marginTop: 10, marginBottom: 0 }}>Datos guardados en este navegador.</p>
        </div>
      </aside>

      <div className="main">
        <div className="topbar">
          <div>
            <h1>{TITLES[view].t}</h1>
            <div className="subtitle">{TITLES[view].s}</div>
          </div>
          <div className="topbar__spacer" />
          <button className="btn btn--primary" onClick={() => setView('vender')}>
            <ScanLine size={16} /> Escanear
          </button>
        </div>

        <div className="content">
          {view === 'dashboard' && <Dashboard onNav={(v) => setView(v as ViewId)} />}
          {view === 'vender' && <VenderView />}
          {view === 'producto' && <ProductosView />}
          {view === 'movimientos' && <MovimientosView />}
          {(view === 'insumo' ||
            view === 'insumo_interno' ||
            view === 'etiqueta' ||
            view === 'materia_prima') && (
            <CategoriaView categoria={view} key={view} />
          )}
        </div>
      </div>
    </div>
  );
}
