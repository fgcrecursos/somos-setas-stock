// =====================================================================
// ¿Contra qué base se arma la app?
//
//  · Base real (Supabase): producción —Vercel, rama master— y `npm run dev`.
//  · Servidor de pruebas: cualquier otra publicación de Vercel (la rama
//    `servidor-pruebas` y toda vista previa) y `npm run pruebas`. La base
//    vive dentro del navegador (sandbox/cliente.ts): al entrar se copia el
//    stock real y nada de lo que se haga ahí vuelve a la base real.
//
// Lo único que cambia entre los dos es src/lib/supabase.ts, que en el
// servidor de pruebas se reemplaza por sandbox/cliente.ts. El resto del
// código es el mismo, así lo que se prueba es lo que se publica.
// =====================================================================
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = path.dirname(fileURLToPath(import.meta.url));
const real = path.resolve(raiz, 'src/lib/supabase.ts').toLowerCase();
const local = path.resolve(raiz, 'sandbox/cliente.ts');

/**
 * Cambia la base real por una que vive en el navegador (sandbox/cliente.ts).
 *  · 'banco': en memoria, con la copia chica de sandbox/datos.json; la usan
 *    las pruebas automáticas (`npm run banco`).
 *  · 'servidor': el servidor de pruebas, con la base guardada en el navegador.
 */
export function baseDePrueba(modo: 'banco' | 'servidor'): Plugin {
  return {
    name: 'base-de-prueba',
    enforce: 'pre',
    config: () => ({
      define: { __BASE_DE_PRUEBA__: JSON.stringify(modo) },
      optimizeDeps: { exclude: ['@electric-sql/pglite'] },
    }),
    async resolveId(source, importer, options) {
      if (!importer || !source.includes('supabase')) return null;
      const r = await this.resolve(source, importer, { ...options, skipSelf: true });
      if (r && path.resolve(r.id.split('?')[0]).toLowerCase() === real) return local;
      return null;
    },
  };
}

export default defineConfig(({ mode }) => {
  // En Vercel: production (rama master) | preview (cualquier otra rama)
  const entorno = process.env.VERCEL_ENV;
  const servidorDePruebas = mode === 'pruebas' || (!!process.env.VERCEL && entorno !== 'production');
  if (process.env.VERCEL)
    console.log(
      `[base] ${servidorDePruebas ? 'SERVIDOR DE PRUEBAS (base en el navegador)' : 'BASE REAL'}` +
        ` · VERCEL_ENV=${entorno ?? '—'} · rama=${process.env.VERCEL_GIT_COMMIT_REF ?? '—'}`
    );
  return {
    plugins: [...(servidorDePruebas ? [baseDePrueba('servidor')] : []), react()],
  };
});
