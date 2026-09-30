// =====================================================================
// ¿POR QUÉ CAMBIA EL STOCK? — aparece en la ficha cuando se edita el número.
//
// El equipo carga casi todo desde "Editar": hasta septiembre hubo 313 cambios
// de stock hechos así contra 31 producciones. Cada uno quedaba como una
// "edición" que pisaba el número, así que producir por ahí no descontaba la
// receta (etiquetas, envases, materia prima) y el stock de componentes se
// despegaba de la realidad. En vez de sacar el campo, se pregunta qué pasó y
// se registra el movimiento que corresponde.
// =====================================================================
import { AlertTriangle } from 'lucide-react';
import { formatNum } from '../lib/helpers';
import type { MotivoStock } from '../lib/store';
import type { Categoria } from '../lib/types';

interface Props {
  categoria: Categoria;
  /** Stock que había al abrir el formulario */
  visto: number;
  /** Stock que quedó escrito en el campo */
  nuevo: number;
  motivo: MotivoStock | null;
  onChange: (m: MotivoStock) => void;
}

interface Opcion {
  id: MotivoStock;
  label: string;
  ayuda: string;
}

export function opcionesMotivo(categoria: Categoria, delta: number): Opcion[] {
  const conteo: Opcion = {
    id: 'conteo',
    label: 'Corrección por conteo físico',
    ayuda:
      'Se contó lo que hay en el estante y el sistema queda en ese número exacto. No descuenta receta.',
  };
  if (delta > 0) {
    return categoria === 'producto'
      ? [
          {
            id: 'produccion',
            label: 'Se produjo',
            ayuda: `Suma ${formatNum(delta)} y descuenta la receta (etiqueta, envase, materia prima) por cada unidad.`,
          },
          conteo,
        ]
      : [
          {
            id: 'ingreso',
            label: 'Entró mercadería',
            ayuda: `Compra o reposición: suma ${formatNum(delta)} al stock real, sin pisar lo que se haya vendido o usado mientras tanto.`,
          },
          conteo,
        ];
  }
  return [
    conteo,
    {
      id: 'consumo',
      label: 'Se usó internamente',
      ayuda: `Consumo interno (muestras, pruebas, roturas): descuenta ${formatNum(-delta)} sin contarlo como venta.`,
    },
  ];
}

export function MotivoStockSelector({ categoria, visto, nuevo, motivo, onChange }: Props) {
  const delta = nuevo - visto;
  if (!Number.isFinite(delta) || delta === 0) return null;
  const opciones = opcionesMotivo(categoria, delta);
  const elegida = opciones.find((o) => o.id === motivo);

  return (
    <div className="motivo-stock">
      <div className="motivo-stock__head">
        <AlertTriangle size={15} />
        <span>
          El stock pasa de <strong>{formatNum(visto)}</strong> a <strong>{formatNum(nuevo)}</strong>{' '}
          ({delta > 0 ? '+' : '−'}
          {formatNum(Math.abs(delta))}). ¿Qué pasó?
        </span>
      </div>
      <div className="chips">
        {opciones.map((o) => (
          <button
            key={o.id}
            type="button"
            className={'chip' + (motivo === o.id ? ' active' : '')}
            onClick={() => onChange(o.id)}
          >
            {o.label}
          </button>
        ))}
      </div>
      <p className="hlp" style={{ margin: '8px 0 0' }}>
        {elegida ? elegida.ayuda : 'Elegí una opción para poder guardar.'}
      </p>
    </div>
  );
}
