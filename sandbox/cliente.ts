// =====================================================================
// BANCO DE PRUEBAS — un "Supabase" que vive en el navegador.
//
// `npm run banco` levanta la app real, con todo su código, pero en lugar de
// hablar con la base de producción habla con esta: un Postgres completo
// (PGlite) armado con los mismos scripts de Supabase y cargado con una copia
// del inventario. Sirve para probar de punta a punta que producir, vender,
// ingresar, contar o renombrar descuenta y carga lo que tiene que cargar,
// sin tocar un solo número real.
//
// Implementa sólo lo que la app usa de supabase-js (from/select/eq/…, rpc y
// auth). La vite.banco.config.ts reemplaza src/lib/supabase.ts por este
// archivo; en el build de producción no existe.
// =====================================================================
import { PGlite } from '@electric-sql/pglite';
import { EMAIL_PRUEBA, PRELUDIO, SCRIPTS, USUARIO_PRUEBA } from './esquema';
import datos from './datos.json';
import { correrPruebas, revisarPantallas } from './pruebas';

type Fila = Record<string, any>;
interface Resultado {
  data: any;
  error: { message: string; code?: string } | null;
  count?: number | null;
}

// ---------------------------------------------------------------------
// La base: se arma una sola vez por carga de página
// ---------------------------------------------------------------------
let db: PGlite;
const tipos = new Map<string, Map<string, string>>(); // tabla → columna → tipo
const claves = new Map<string, string[]>(); // tabla → clave primaria

async function armar(): Promise<void> {
  db = new PGlite({
    parsers: {
      1700: (v: string) => Number(v), // numeric → número, como PostgREST
      20: (v: string) => Number(v), // bigint
      1184: (v: string) => new Date(v).toISOString(), // timestamptz → texto ISO
    },
  });
  await db.exec(PRELUDIO);
  for (const [nombre, sql] of SCRIPTS) {
    try {
      await db.exec(sql);
    } catch (e) {
      console.error(`[banco] falló ${nombre}:`, e);
      throw e;
    }
  }
  await db.exec(USUARIO_PRUEBA);
  await cargarDatos();

  const cols = await db.query<Fila>(
    `select table_name, column_name, udt_name from information_schema.columns where table_schema = 'public'`
  );
  for (const c of cols.rows) {
    if (!tipos.has(c.table_name)) tipos.set(c.table_name, new Map());
    tipos.get(c.table_name)!.set(c.column_name, c.udt_name);
  }
  const pk = await db.query<Fila>(
    `select tc.table_name, kcu.column_name
       from information_schema.table_constraints tc
       join information_schema.key_column_usage kcu using (constraint_name, table_schema)
      where tc.constraint_type = 'PRIMARY KEY' and tc.table_schema = 'public'
      order by kcu.ordinal_position`
  );
  for (const r of pk.rows) claves.set(r.table_name, [...(claves.get(r.table_name) ?? []), r.column_name]);
}

async function cargarDatos(): Promise<void> {
  const d = datos as any;
  // Los scripts de producción traen su propia carga inicial (el mapa de la
  // tienda de agosto): se reemplaza por la copia de datos.json.
  await db.exec(`delete from st_sku_map; delete from st_pedidos; delete from st_movimientos; delete from st_items;`);
  // Cada ítem viene como [categoria, codigo, nombre, actual, minimo, data]
  for (const [categoria, codigo, nombreItem, actual, minimo, data] of d.items ?? [])
    await db.query(
      `insert into st_items (categoria, codigo, nombre, actual, minimo, data) values ($1,$2,$3,$4,$5,$6::jsonb)`,
      [categoria, codigo, nombreItem, actual, minimo, JSON.stringify(data ?? {})]
    );
  for (const m of d.skuMap ?? [])
    await db.query(
      `insert into st_sku_map (producto_id, pres_id, categoria, codigo, unidades, activo, revisar, etiqueta)
       values ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [m.producto_id, m.pres_id, m.categoria, m.codigo, m.unidades, m.activo, m.revisar, m.etiqueta]
    );
  await db.query(`insert into ss_store (id, products) values (1, $1::jsonb)`, [
    JSON.stringify(d.catalogo ?? []),
  ]);
}

const lista = armar();

// ---------------------------------------------------------------------
// Valores: todo viaja como texto y se castea al tipo de la columna
// ---------------------------------------------------------------------
function tipoDe(tabla: string, col: string): string {
  return tipos.get(tabla)?.get(col) ?? 'text';
}
function comoTexto(v: unknown, tipo: string): string | null {
  if (v === null || v === undefined) return null;
  if (tipo === 'jsonb' || tipo === 'json') return JSON.stringify(v);
  return String(v);
}
function nombre(id: string): string {
  if (!/^[a-z_][a-z0-9_]*$/i.test(id)) throw new Error(`[banco] nombre inválido: ${id}`);
  return `"${id}"`;
}
function error(e: any): { message: string; code?: string } {
  return { message: e?.message ?? String(e), code: e?.code };
}

// ---------------------------------------------------------------------
// El constructor de consultas (from('tabla').select().eq()…)
// ---------------------------------------------------------------------
class Consulta implements PromiseLike<Resultado> {
  private accion: 'select' | 'insert' | 'upsert' | 'update' | 'delete' = 'select';
  private columnas = '*';
  private conteo = false;
  private soloConteo = false;
  private devolver = false;
  private filtros: { col: string; op: string; val: unknown }[] = [];
  private orden: { col: string; asc: boolean }[] = [];
  private desde?: number;
  private hasta?: number;
  private tope?: number;
  private unica: 'maybe' | 'single' | null = null;
  private filas: Fila[] = [];
  private conflicto?: string;
  private valores?: Fila;

  constructor(private tabla: string) {}

  select(cols = '*', opts?: { count?: string; head?: boolean }) {
    if (this.accion === 'select') {
      this.columnas = cols;
      this.conteo = opts?.count === 'exact';
      this.soloConteo = !!opts?.head;
    } else {
      this.devolver = true;
      this.columnas = cols;
    }
    return this;
  }
  eq(col: string, val: unknown) { this.filtros.push({ col, op: '=', val }); return this; }
  neq(col: string, val: unknown) { this.filtros.push({ col, op: '<>', val }); return this; }
  in(col: string, val: unknown[]) { this.filtros.push({ col, op: 'in', val }); return this; }
  contains(col: string, val: unknown) { this.filtros.push({ col, op: '@>', val }); return this; }
  order(col: string, o?: { ascending?: boolean }) { this.orden.push({ col, asc: o?.ascending !== false }); return this; }
  range(a: number, b: number) { this.desde = a; this.hasta = b; return this; }
  limit(n: number) { this.tope = n; return this; }
  maybeSingle() { this.unica = 'maybe'; return this; }
  single() { this.unica = 'single'; return this; }
  insert(f: Fila | Fila[]) { this.accion = 'insert'; this.filas = Array.isArray(f) ? f : [f]; return this; }
  upsert(f: Fila | Fila[], o?: { onConflict?: string }) {
    this.accion = 'upsert';
    this.filas = Array.isArray(f) ? f : [f];
    this.conflicto = o?.onConflict;
    return this;
  }
  update(v: Fila) { this.accion = 'update'; this.valores = v; return this; }
  delete() { this.accion = 'delete'; return this; }

  then<A = Resultado, B = never>(
    ok?: ((r: Resultado) => A | PromiseLike<A>) | null,
    mal?: ((e: any) => B | PromiseLike<B>) | null
  ): PromiseLike<A | B> {
    return this.ejecutar().then(ok, mal);
  }

  private where(params: unknown[]): string {
    if (!this.filtros.length) return '';
    const partes = this.filtros.map(({ col, op, val }) => {
      const t = tipoDe(this.tabla, col);
      if (op === 'in') {
        params.push(JSON.stringify(val));
        return `${nombre(col)}::text in (select jsonb_array_elements_text($${params.length}::jsonb))`;
      }
      if (op === '@>') {
        params.push(JSON.stringify(val));
        return `${nombre(col)} @> $${params.length}::jsonb`;
      }
      params.push(comoTexto(val, t));
      return `${nombre(col)} ${op} $${params.length}::${t}`;
    });
    return ' where ' + partes.join(' and ');
  }

  private listaColumnas(): string {
    if (this.columnas.trim() === '*') return '*';
    return this.columnas.split(',').map((c) => nombre(c.trim())).join(', ');
  }

  private valoresDeFila(f: Fila, cols: string[], params: unknown[]): string {
    return (
      '(' +
      cols
        .map((c) => {
          if (!(c in f)) return 'default';
          params.push(comoTexto(f[c], tipoDe(this.tabla, c)));
          return `$${params.length}::${tipoDe(this.tabla, c)}`;
        })
        .join(', ') +
      ')'
    );
  }

  private async ejecutar(): Promise<Resultado> {
    await lista;
    const t = nombre(this.tabla);
    const params: unknown[] = [];
    try {
      let sql: string;
      if (this.accion === 'select') {
        if (this.soloConteo) {
          const r = await db.query<Fila>(`select count(*)::int as n from ${t}${this.where(params)}`, params);
          return { data: null, error: null, count: r.rows[0].n };
        }
        sql = `select ${this.listaColumnas()} from ${t}${this.where(params)}`;
        if (this.orden.length)
          sql += ' order by ' + this.orden.map((o) => `${nombre(o.col)} ${o.asc ? 'asc' : 'desc'}`).join(', ');
        if (this.desde != null && this.hasta != null)
          sql += ` offset ${Number(this.desde)} limit ${Number(this.hasta) - Number(this.desde) + 1}`;
        else if (this.tope != null) sql += ` limit ${Number(this.tope)}`;
      } else if (this.accion === 'insert' || this.accion === 'upsert') {
        const cols = [...new Set(this.filas.flatMap((f) => Object.keys(f)))];
        sql =
          `insert into ${t} (${cols.map(nombre).join(', ')}) values ` +
          this.filas.map((f) => this.valoresDeFila(f, cols, params)).join(', ');
        if (this.accion === 'upsert') {
          const pk = this.conflicto ? this.conflicto.split(',').map((c) => c.trim()) : claves.get(this.tabla) ?? [];
          const resto = cols.filter((c) => !pk.includes(c));
          sql += ` on conflict (${pk.map(nombre).join(', ')}) ` +
            (resto.length ? `do update set ${resto.map((c) => `${nombre(c)} = excluded.${nombre(c)}`).join(', ')}` : 'do nothing');
        }
        sql += ' returning *';
      } else if (this.accion === 'update') {
        const sets = Object.entries(this.valores ?? {}).map(([c, v]) => {
          params.push(comoTexto(v, tipoDe(this.tabla, c)));
          return `${nombre(c)} = $${params.length}::${tipoDe(this.tabla, c)}`;
        });
        sql = `update ${t} set ${sets.join(', ')}${this.where(params)} returning *`;
      } else {
        sql = `delete from ${t}${this.where(params)} returning *`;
      }

      const r = await db.query<Fila>(sql, params);
      let data: any = this.accion === 'select' || this.devolver ? r.rows : null;
      if (this.unica) {
        if (r.rows.length > 1) return { data: null, error: { message: 'Más de una fila', code: 'PGRST116' } };
        if (!r.rows.length && this.unica === 'single')
          return { data: null, error: { message: 'Ninguna fila', code: 'PGRST116' } };
        data = r.rows[0] ?? null;
      }
      return { data, error: null, count: this.conteo ? r.rows.length : null };
    } catch (e) {
      return { data: null, error: error(e) };
    }
  }
}

// ---------------------------------------------------------------------
// rpc('st_aplicar', {...}): cada parámetro se castea al tipo que declara la función
// ---------------------------------------------------------------------
const firmas = new Map<string, Map<string, string>>();
async function firma(fn: string): Promise<Map<string, string>> {
  if (firmas.has(fn)) return firmas.get(fn)!;
  const r = await db.query<Fila>(
    `select p.proargnames as nombres,
            array(select format_type(t, null) from unnest(p.proargtypes) t) as tipos
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = $1 limit 1`,
    [fn]
  );
  const m = new Map<string, string>();
  const f = r.rows[0];
  (f?.nombres ?? []).forEach((n: string, i: number) => m.set(n, f.tipos[i]));
  firmas.set(fn, m);
  return m;
}

async function rpc(fn: string, args: Fila = {}): Promise<Resultado> {
  await lista;
  try {
    const tiposArg = await firma(fn);
    const params: unknown[] = [];
    const partes = Object.entries(args).map(([k, v]) => {
      const t = tiposArg.get(k) ?? 'text';
      params.push(v === null || v === undefined ? null : t === 'jsonb' ? JSON.stringify(v) : String(v));
      return `${nombre(k)} => $${params.length}::${t}`;
    });
    const r = await db.query<Fila>(`select public.${nombre(fn)}(${partes.join(', ')}) as r`, params);
    return { data: r.rows[0]?.r ?? null, error: null };
  } catch (e) {
    return { data: null, error: error(e) };
  }
}

// ---------------------------------------------------------------------
// Sesión: siempre adentro, como el admin de prueba
// ---------------------------------------------------------------------
const SESION = { access_token: 'banco', user: { id: 'banco', email: EMAIL_PRUEBA } };
const auth = {
  getSession: async () => ({ data: { session: SESION }, error: null }),
  onAuthStateChange: (cb: (e: string, s: unknown) => void) => {
    setTimeout(() => cb('SIGNED_IN', SESION), 0);
    return { data: { subscription: { unsubscribe() {} } } };
  },
  signInWithPassword: async () => ({ data: { session: SESION }, error: null }),
  signOut: async () => ({ error: null }),
  resetPasswordForEmail: async () => ({ data: {}, error: null }),
  updateUser: async () => ({ data: {}, error: null }),
  signUp: async () => ({ data: {}, error: null }),
};

export const sb: any = { from: (tabla: string) => new Consulta(tabla), rpc, auth };
export function clienteAislado(): any {
  return sb;
}

// ---------------------------------------------------------------------
// Para las pruebas: consultar la base directo y simular lo que pasa afuera
// (una venta de la tienda mientras alguien tiene un formulario abierto)
// ---------------------------------------------------------------------
(window as any).__banco = {
  lista,
  async query(sql: string, params: unknown[] = []) {
    await lista;
    return (await db.query<Fila>(sql, params)).rows;
  },
  async exec(sql: string) {
    await lista;
    return db.exec(sql);
  },
  /** Todas las pruebas de punta a punta (recargar la página antes) */
  async pruebas() {
    await lista;
    return correrPruebas(async (sql, params = []) => (await db.query<Fila>(sql, params)).rows);
  },
  /** ¿Algo se sale de la pantalla en el ancho actual? */
  pantallas: revisarPantallas,
};

// Cartel fijo: que nadie confunda esta pestaña con la plataforma real
const cartel = document.createElement('div');
cartel.textContent = 'BANCO DE PRUEBAS · base local con una copia del inventario — nada de lo que se haga acá toca los datos reales';
cartel.style.cssText =
  'position:fixed;left:0;right:0;bottom:0;z-index:9999;background:#6a4f7a;color:#fff;font:600 12px/1.2 Montserrat,sans-serif;text-align:center;padding:6px 10px;pointer-events:none';
document.addEventListener('DOMContentLoaded', () => document.body.appendChild(cartel));
if (document.readyState !== 'loading') document.body.appendChild(cartel);
