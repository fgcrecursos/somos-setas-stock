import { createClient } from '@supabase/supabase-js';

// Mismo proyecto que la tienda somossetas.com.ar: así una persona entra a los
// dos sistemas con el mismo email y contraseña. Lo que puede hacer en cada uno
// lo definen tablas distintas (ss_users para la tienda, st_users para el stock).
//
// La clave "publishable" es pública por diseño (ya viaja en el JS de la tienda):
// no da acceso a nada por sí sola, todo está protegido por RLS en la base.
// Las vistas previas de Vercel (…-git-<rama>-….vercel.app, como el servidor
// de pruebas) se arman con la base del navegador (ver vite.config.ts). Si una
// llegara a armarse con esta, probar ahí escribiría en el stock de verdad: se
// frena antes de conectarse.
if (/-git-.+\.vercel\.app$/i.test(location.hostname)) {
  const aviso =
    'Esta vista previa quedó armada contra la base real y se frenó para no tocar el stock. No cargues nada: avisale a Franco.';
  document.body.innerHTML = `<p style="font:600 18px/1.5 sans-serif;max-width:520px;margin:20vh auto;padding:0 24px;text-align:center">${aviso}</p>`;
  throw new Error(aviso);
}

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

// ---------------------------------------------------------------------
// Solo existen de verdad en las versiones de prueba (sandbox/cliente.ts, que
// reemplaza a este archivo): con la base real no hay ingreso por nombre, ni
// datos de ejemplo, ni copia local que reiniciar.
// ---------------------------------------------------------------------
export const servidorDePruebas = false;
export async function entrarConDatosDeEjemplo(): Promise<{ error?: string }> {
  return { error: 'Los datos de ejemplo sólo existen en el servidor de pruebas.' };
}
export const personasDePrueba: { email: string; nombre: string }[] = [];
export async function volverADatosIniciales(): Promise<void> {}
export async function fechaDeLaCopia(): Promise<string | null> {
  return null;
}
