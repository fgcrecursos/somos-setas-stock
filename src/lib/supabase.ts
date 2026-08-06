import { createClient } from '@supabase/supabase-js';

// Mismo proyecto que la tienda somossetas.com.ar: así una persona entra a los
// dos sistemas con el mismo email y contraseña. Lo que puede hacer en cada uno
// lo definen tablas distintas (ss_users para la tienda, st_users para el stock).
//
// La clave "publishable" es pública por diseño (ya viaja en el JS de la tienda):
// no da acceso a nada por sí sola, todo está protegido por RLS en la base.
const URL = import.meta.env.VITE_SUPABASE_URL ?? 'https://muuqqbocpumdvhvxsigz.supabase.co';
const KEY =
  import.meta.env.VITE_SUPABASE_KEY ?? 'sb_publishable_9OnAKU_5FngXR2kn55spXw_JPhB1jjt';

export const sb = createClient(URL, KEY);

/**
 * Cliente descartable para dar de alta usuarios sin perder la sesión propia:
 * `signUp` reemplaza la sesión activa del cliente que lo ejecuta, así que el
 * admin que crea la cuenta quedaría logueado como la persona nueva.
 */
export function clienteAislado() {
  return createClient(URL, KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
