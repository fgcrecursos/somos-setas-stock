// =====================================================================
// Banco de pruebas: la misma app, contra una base local (sandbox/).
// `npm run banco` → http://localhost:5199
//
// Lo único que cambia es src/lib/supabase.ts, que se reemplaza por
// sandbox/cliente.ts (ver baseDePrueba en vite.config.ts). El resto del
// código es el de producción, así lo que se prueba acá es lo que se publica.
// =====================================================================
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { baseDePrueba } from './vite.config';

export default defineConfig({
  plugins: [baseDePrueba('banco'), react()],
  server: { port: 5199, strictPort: true },
});
