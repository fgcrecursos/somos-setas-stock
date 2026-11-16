// =====================================================================
// RESERVADO — lo prometido por pedidos confirmados que todavía no se
// prepararon.
//
// Desde el 16/11 un pedido descuenta el stock recién al pasar a "En
// preparación". Mientras está "Confirmado" la mercadería sigue en el estante
// y el stock la cuenta, pero ya está vendida: eso es lo reservado.
//
//   En el estante (actual) − Reservado = Disponible
//
// El disponible es lo que se usa para avisar de stock bajo y para calcular
// la reposición.
// =====================================================================
import { useEffect, useState } from 'react';
import { traerReservado } from './cloud';
import type { DBState } from './types';

/** Lo reservado por ítem (clave "categoria|codigo"); se refresca solo cada minuto */
export function useReservado(): Map<string, number> {
  const [res, setRes] = useState<Map<string, number>>(new Map());
  useEffect(() => {
    let vivo = true;
    const cargar = () =>
      traerReservado()
        .then((m) => vivo && setRes(m))
        .catch(() => {});
    cargar();
    const t = setInterval(() => {
      if (document.visibilityState === 'visible') cargar();
    }, 60_000);
    const alVolver = () => document.visibilityState === 'visible' && cargar();
    document.addEventListener('visibilitychange', alVolver);
    return () => {
      vivo = false;
      clearInterval(t);
      document.removeEventListener('visibilitychange', alVolver);
    };
  }, []);
  return res;
}

export function reservadoDe(res: Map<string, number>, categoria: string, codigo: string): number {
  return res.get(`${categoria}|${codigo}`) ?? 0;
}

/** El mismo estado, con cada ítem en su disponible (actual − reservado) */
export function conDisponible(state: DBState, res: Map<string, number>): DBState {
  if (res.size === 0) return state;
  const restar = <T extends { codigo: string; actual: number }>(lista: T[], cat: string): T[] =>
    lista.map((it) => {
      const r = reservadoDe(res, cat, it.codigo);
      return r ? { ...it, actual: it.actual - r } : it;
    });
  return {
    ...state,
    productos: restar(state.productos, 'producto'),
    insumos: restar(state.insumos, 'insumo'),
    insumosInternos: restar(state.insumosInternos, 'insumo_interno'),
    etiquetas: restar(state.etiquetas, 'etiqueta'),
    materiaPrima: restar(state.materiaPrima, 'materia_prima'),
  };
}
