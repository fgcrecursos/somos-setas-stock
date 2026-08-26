// =====================================================================
// MINI CALENDARIO — elegir un día concreto dentro de un filtro de período.
//
// Es propio y no un <input type="date"> porque el calendario nativo del
// navegador se dibuja con los colores del sistema y no acepta CSS: rompía
// la estética del panel apenas se abría.
//
// El desplegable se monta en <body> (portal) y no al lado del botón: los
// paneles y las barras de filtros suelen tener overflow oculto o scroll
// propio, y ahí adentro el calendario aparecía cortado.
// =====================================================================
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

const MESES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];
const MESES_CORTOS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
/** La semana argentina arranca el lunes, no el domingo */
const DIAS_SEMANA = ['Lu', 'Ma', 'Mi', 'Ju', 'Vi', 'Sá', 'Do'];

/** Medidas del desplegable, fijas porque el contenido siempre es el mismo */
const POP_ANCHO = 262;
const POP_ALTO = 340;
const MARGEN = 10;

const iso = (a: number, m: number, d: number) =>
  `${a}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

/** AAAA-MM-DD → "11 ago 2026" */
export function etiquetaDia(ymd: string): string {
  const [a, m, d] = ymd.split('-').map(Number);
  return `${d} ${MESES_CORTOS[m - 1]} ${a}`;
}

interface Props {
  /** Día elegido en AAAA-MM-DD, o null si el filtro está en otro período */
  value: string | null;
  /** Devuelve el día elegido, o null cuando se toca "Quitar" */
  onChange: (dia: string | null) => void;
}

export function CalendarioDia({ value, onChange }: Props) {
  const [abierto, setAbierto] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);

  const hoy = new Date();
  const hoyISO = iso(hoy.getFullYear(), hoy.getMonth(), hoy.getDate());

  // Mes que se está mirando. Al abrir arranca en el día elegido, o en el actual.
  const [cursor, setCursor] = useState(() => ({ a: hoy.getFullYear(), m: hoy.getMonth() }));
  const [pos, setPos] = useState({ top: 0, left: 0 });

  useEffect(() => {
    if (!abierto) return;
    if (value) {
      const [a, m] = value.split('-').map(Number);
      setCursor({ a, m: m - 1 });
    } else {
      setCursor({ a: hoy.getFullYear(), m: hoy.getMonth() });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [abierto, value]);

  /**
   * Lo pega debajo del botón, en coordenadas de la página. Si abajo no entra
   * lo pasa arriba, y si se pasa del borde derecho lo corre hacia adentro.
   */
  useLayoutEffect(() => {
    if (!abierto) return;
    const ubicar = () => {
      const r = btn.current?.getBoundingClientRect();
      if (!r) return;
      const anchoVista = document.documentElement.clientWidth;
      const altoVista = document.documentElement.clientHeight;
      const abajoEntra = r.bottom + 8 + POP_ALTO <= altoVista - MARGEN;
      const arribaEntra = r.top - 8 - POP_ALTO >= MARGEN;
      const preferido = abajoEntra || !arribaEntra ? r.bottom + 8 : r.top - 8 - POP_ALTO;
      // En una ventana muy baja no entra de ningún lado: ahí se pega al borde
      const top = Math.max(MARGEN, Math.min(preferido, altoVista - POP_ALTO - MARGEN));
      const left = Math.max(
        MARGEN,
        Math.min(r.left, anchoVista - POP_ANCHO - MARGEN)
      );
      setPos({ top: top + window.scrollY, left: left + window.scrollX });
    };
    ubicar();
    // El scroll puede venir de la página o de un contenedor con scroll propio
    window.addEventListener('scroll', ubicar, true);
    window.addEventListener('resize', ubicar);
    return () => {
      window.removeEventListener('scroll', ubicar, true);
      window.removeEventListener('resize', ubicar);
    };
  }, [abierto]);

  // Se cierra al tocar afuera o con Escape, como cualquier menú del panel
  useEffect(() => {
    if (!abierto) return;
    const fuera = (e: MouseEvent) => {
      const t = e.target as Node;
      if (btn.current?.contains(t) || pop.current?.contains(t)) return;
      setAbierto(false);
    };
    const escape = (e: KeyboardEvent) => e.key === 'Escape' && setAbierto(false);
    document.addEventListener('mousedown', fuera);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('mousedown', fuera);
      document.removeEventListener('keydown', escape);
    };
  }, [abierto]);

  /** Los huecos del arranque + los días del mes. Sin días del mes vecino: ensucian. */
  const celdas = useMemo(() => {
    const arranque = (new Date(cursor.a, cursor.m, 1).getDay() + 6) % 7;
    const largo = new Date(cursor.a, cursor.m + 1, 0).getDate();
    return [
      ...Array.from({ length: arranque }, () => null),
      ...Array.from({ length: largo }, (_, i) => i + 1),
    ];
  }, [cursor]);

  /** No se puede ir a meses que todavía no pasaron */
  const mesSiguienteBloqueado =
    cursor.a > hoy.getFullYear() ||
    (cursor.a === hoy.getFullYear() && cursor.m >= hoy.getMonth());

  const mover = (paso: number) => {
    const d = new Date(cursor.a, cursor.m + paso, 1);
    setCursor({ a: d.getFullYear(), m: d.getMonth() });
  };

  const elegir = (dia: string) => {
    onChange(dia);
    setAbierto(false);
  };

  return (
    <>
      <button
        ref={btn}
        type="button"
        className={'chip cal__btn' + (value ? ' active' : '')}
        onClick={() => setAbierto((v) => !v)}
        title="Elegir un día"
      >
        <CalendarDays size={14} />
        {value ? etiquetaDia(value) : 'Un día'}
      </button>

      {abierto &&
        createPortal(
          <div ref={pop} className="cal__pop" style={{ top: pos.top, left: pos.left }}>
            <div className="cal__head">
              <button type="button" className="cal__nav" onClick={() => mover(-1)} title="Mes anterior">
                <ChevronLeft size={16} />
              </button>
              <div className="cal__mes">
                {MESES[cursor.m]} {cursor.a}
              </div>
              <button
                type="button"
                className="cal__nav"
                onClick={() => mover(1)}
                disabled={mesSiguienteBloqueado}
                title="Mes siguiente"
              >
                <ChevronRight size={16} />
              </button>
            </div>

            <div className="cal__grid">
              {DIAS_SEMANA.map((d) => (
                <span key={d} className="cal__dow">
                  {d}
                </span>
              ))}
              {celdas.map((dia, i) => {
                if (dia === null) return <span key={`h${i}`} />;
                const ymd = iso(cursor.a, cursor.m, dia);
                return (
                  <button
                    key={ymd}
                    type="button"
                    className={
                      'cal__dia' +
                      (ymd === value ? ' sel' : '') +
                      (ymd === hoyISO && ymd !== value ? ' hoy' : '')
                    }
                    disabled={ymd > hoyISO}
                    onClick={() => elegir(ymd)}
                  >
                    {dia}
                  </button>
                );
              })}
            </div>

            <div className="cal__foot">
              <button type="button" className="cal__link" onClick={() => elegir(hoyISO)}>
                Hoy
              </button>
              {value && (
                <button
                  type="button"
                  className="cal__link cal__link--der"
                  onClick={() => {
                    onChange(null);
                    setAbierto(false);
                  }}
                >
                  Quitar
                </button>
              )}
            </div>
          </div>,
          document.body
        )}
    </>
  );
}
