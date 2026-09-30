// =====================================================================
// Banco de pruebas: la misma app, contra una base local (sandbox/).
// `npm run banco` → http://localhost:5199
//
// Lo único que cambia es src/lib/supabase.ts, que se reemplaza por
// sandbox/cliente.ts. El resto del código es el de producción, así lo que
// se prueba acá es lo que se publica.
// =====================================================================
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = path.dirname(fileURLToPath(import.meta.url));
const real = path.resolve(raiz, 'src/lib/supabase.ts').toLowerCase();
const local = path.resolve(raiz, 'sandbox/cliente.ts');

function bancoDePruebas(): Plugin {
  return {
    name: 'banco-de-pruebas',
    enforce: 'pre',
    async resolveId(source, importer, options) {
      if (!importer || !source.includes('supabase')) return null;
      const r = await this.resolve(source, importer, { ...options, skipSelf: true });
      if (r && path.resolve(r.id.split('?')[0]).toLowerCase() === real) return local;
      return null;
    },
  };
}

export default defineConfig({
  plugins: [bancoDePruebas(), react()],
  optimizeDeps: { exclude: ['@electric-sql/pglite'] },
  server: { port: 5199, strictPort: true },
});
