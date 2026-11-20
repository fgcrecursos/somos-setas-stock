// =====================================================================
// BASE DE PRUEBA — un "Supabase" que vive en el navegador.
//
// La app real, con todo su código, pero en lugar de hablar con la base de
// producción habla con esta: un Postgres completo (PGlite) armado con los
// mismos scripts de Supabase. Sirve para probar de punta a punta que
// producir, vender, ingresar, contar o renombrar descuenta y carga lo que
// tiene que cargar, sin tocar un solo número real.
//
// Implementa sólo lo que la app usa de supabase-js (from/select/eq/…, rpc y
// auth). La configuración de Vite (baseDePrueba en vite.config.ts) reemplaza
// src/lib/supabase.ts por este archivo; en el build de producción no existe.
//
// Dos modos, según __BASE_DE_PRUEBA__ (lo fija esa misma configuración):
//  · 'banco' (`npm run banco`): base en memoria, armada de cero en cada carga
//    con la copia chica de sandbox/datos.json y ya adentro como admin. Es la
//    de las pruebas automáticas (`await __banco.pruebas()`).
//  · 'servidor' (el servidor de pruebas: rama servidor-pruebas en Vercel y
//    `npm run pruebas`): la base se guarda en el navegador. Al entrar con el
//    usuario de siempre se copia el stock real de ese momento —sólo con
//    pedidos GET: desde acá no se puede escribir en la base real— y todo lo
//    que se haga queda en esta computadora hasta cerrar sesión. Sin usuario
//    se puede probar con los datos de ejemplo.
// =====================================================================
import { PGlite } from '@electric-sql/pglite';
import { EMAIL_PRUEBA, PRELUDIO, SCRIPTS, USUARIO_PRUEBA } from './esquema';
import datos from './datos.json';

declare const __BASE_DE_PRUEBA__: 'banco' | 'servidor';
const SERVIDOR = __BASE_DE_PRUEBA__ === 'servidor';

type Fila = Record<string, any>;
interface Resultado {
  data: any;
  error: { message: string; code?: string } | null;
  count?: number | null;
}

// Si este armado llegara a publicarse en la dirección de la plataforma real,
// el equipo cargaría todo en su navegador creyendo que se guarda: se frena.
const DIRECCIONES_REALES = ['somos-setas-stock.vercel.app', 'stock.somossetas.com.ar'];
if (SERVIDOR && DIRECCIONES_REALES.includes(location.hostname)) {
  const aviso =
    'Esta dirección tiene publicado el servidor de pruebas en lugar de la plataforma real. No cargues nada: avisale a Franco.';
  document.body.innerHTML = `<p style="font:600 18px/1.5 sans-serif;max-width:520px;margin:20vh auto;padding:0 24px;text-align:center">${aviso}</p>`;
  throw new Error(aviso);
}

// ---------------------------------------------------------------------
// La base
// ---------------------------------------------------------------------
const OPCIONES = {
  parsers: {
    1700: (v: string) => Number(v), // numeric → número, como PostgREST
    20: (v: string) => Number(v), // bigint
    // timestamptz → texto ISO con todos los decimales, como PostgREST (así
    // una marca leída se puede volver a comparar por igualdad)
    1184: (v: string) => v.replace(' ', 'T').replace(/([+-]\d\d)$/, '$1:00'),
  },
};

let db: PGlite;
const tipos = new Map<string, Map<string, string>>(); // tabla → columna → tipo
const claves = new Map<string, string[]>(); // tabla → clave primaria
const firmas = new Map<string, Map<string, string>>(); // función → parámetro → tipo

/** Los mismos scripts que se corrieron en Supabase, en el mismo orden */
async function correrScripts(): Promise<void> {
  await db.exec(PRELUDIO);
  for (const [nombre, sql] of SCRIPTS) {
    try {
      await db.exec(sql);
    } catch (e) {
      console.error(`[banco] falló ${nombre}:`, e);
      throw e;
    }
  }
}

/** Tipo de cada columna y claves primarias, para armar las consultas */
async function leerEsquema(): Promise<void> {
  tipos.clear();
  claves.clear();
  firmas.clear();
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

/** La copia chica de ejemplo (sandbox/datos.json): 15 productos reales con sus componentes */
async function cargarDatosDeEjemplo(): Promise<void> {
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

/** Quién está usando la app: lo que la base ve como auth.jwt() ->> 'email' */
async function fijarQuien(email: string): Promise<void> {
  await db.query(`select set_config('banco.email', $1, false)`, [email]);
}

// ---------------------------------------------------------------------
// Banco: en memoria y de cero en cada carga
// ---------------------------------------------------------------------
async function armarBanco(): Promise<void> {
  db = new PGlite(OPCIONES);
  await correrScripts();
  await db.exec(USUARIO_PRUEBA);
  await cargarDatosDeEjemplo();
  await leerEsquema();
}

// =====================================================================
// SERVIDOR DE PRUEBAS
// =====================================================================
const BASE_IDB = 'somos-setas-stock-pruebas';
const CLAVE_SESION = 'ss-stock-pruebas:sesion';
const PAGINA = 1000; // tope de filas por pedido a la base real
const PEDIDOS_TIENDA = 200; // los mismos que muestra "Pedidos de la tienda"

// La base real: las mismas que usa src/lib/supabase.ts (la clave es pública
// por diseño; lo que protege los datos es el usuario y RLS)
const URL_REAL: string = import.meta.env.VITE_SUPABASE_URL ?? 'https://muuqqbocpumdvhvxsigz.supabase.co';
const CLAVE_PUBLICA: string =
  import.meta.env.VITE_SUPABASE_KEY ?? 'sb_publishable_9OnAKU_5FngXR2kn55spXw_JPhB1jjt';

/** Si cambia algún script, una copia armada con las funciones viejas no se retoma */
const VERSION_ESQUEMA = huella(PRELUDIO + SCRIPTS.map(([, sql]) => sql).join('\n'));
function huella(texto: string): string {
  let h = 0x811c9dc5; // FNV-1a
  for (let i = 0; i < texto.length; i++) {
    h ^= texto.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}

interface Meta {
  origen: 'real' | 'ejemplo';
  email: string;
  /** Cuándo se copió (ISO) */
  copiada: string;
  esquema: string;
}
let meta: Meta | null = null;

async function leerMeta(): Promise<Meta | null> {
  try {
    const r = await db.query<Fila>(`select valor from public.prueba_meta where clave = 'meta'`);
    return r.rows[0] ? (JSON.parse(r.rows[0].valor) as Meta) : null;
  } catch {
    return null; // base vacía: nunca se entró desde este navegador
  }
}

function emailGuardado(): string | null {
  try {
    return localStorage.getItem(CLAVE_SESION);
  } catch {
    return null;
  }
}
function guardarEmail(email: string | null): void {
  try {
    if (email) localStorage.setItem(CLAVE_SESION, email);
    else localStorage.removeItem(CLAVE_SESION);
  } catch {
    /* sin almacenamiento: la sesión dura lo que dure la pestaña */
  }
}

/**
 * Deja la base del navegador como recién creada. Se vacía en lugar de
 * borrarla y abrirla de nuevo: con la conexión abierta, el navegador deja
 * el borrado esperando y la base nueva no llegaría a abrir.
 */
async function vaciarBase(): Promise<void> {
  meta = null;
  await db.exec(`drop schema if exists public cascade; create schema public; drop schema if exists auth cascade;`);
}

/** Al cargar la página: retoma la copia de este navegador si la sesión sigue abierta */
async function abrirServidor(): Promise<void> {
  db = new PGlite(`idb://${BASE_IDB}`, { ...OPCIONES, relaxedDurability: true });
  const guardada = await leerMeta();
  const email = emailGuardado();
  if (guardada && email && guardada.email === email && guardada.esquema === VERSION_ESQUEMA) {
    meta = guardada;
    sesion = sesionDe(email);
    await leerEsquema();
    await fijarQuien(email);
  } else {
    // Primera vez, sesión cerrada o servidor actualizado: hay que volver a
    // entrar. Una copia que quedó de antes no se deja dando vueltas.
    guardarEmail(null);
    if (guardada) await vaciarBase();
  }
  ponerCartel();
}

/** Arma la base de cero (scripts + datos) y la deja guardada en el navegador */
async function armarServidor(cargar: () => Promise<void>, origen: Meta['origen'], email: string): Promise<void> {
  await vaciarBase();
  await correrScripts();
  await cargar();
  const nueva: Meta = { origen, email, copiada: new Date().toISOString(), esquema: VERSION_ESQUEMA };
  await db.exec(`create table if not exists public.prueba_meta (clave text primary key, valor text not null)`);
  await db.query(
    `insert into public.prueba_meta values ('meta', $1) on conflict (clave) do update set valor = excluded.valor`,
    [JSON.stringify(nueva)]
  );
  await leerEsquema();
  await fijarQuien(email);
  meta = nueva;
}

async function reconstruir(cargar: () => Promise<void>, origen: Meta['origen'], email: string): Promise<void> {
  const armado = armarServidor(cargar, origen, email);
  // Si falla, que las consultas no queden colgadas de un error para siempre
  lista = armado.catch(() => undefined);
  await armado;
}

// ---------------------------------------------------------------------
// La copia del stock real
// ---------------------------------------------------------------------
interface Copia {
  usuarios: Fila[];
  items: Fila[];
  movimientos: Fila[];
  skuMap: Fila[];
  pedidos: Fila[];
  ordenes: Fila[];
  catalogo: unknown[];
}

/** Entra a la base real con el usuario y la contraseña de siempre (no se guardan) */
async function autenticar(email: string, password: string): Promise<string> {
  let r: Response;
  try {
    r = await fetch(`${URL_REAL}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { apikey: CLAVE_PUBLICA, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
  } catch {
    throw new Error('Failed to fetch'); // → "No se pudo conectar con el servidor"
  }
  const j: Fila = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token)
    throw new Error(j.msg ?? j.error_description ?? j.message ?? `No se pudo entrar (error ${r.status}).`);
  return j.access_token;
}

/** Cierra sólo esta sesión en la base real: las otras de la misma persona siguen abiertas */
async function cerrarSesionReal(token: string): Promise<void> {
  try {
    await fetch(`${URL_REAL}/auth/v1/logout?scope=local`, {
      method: 'POST',
      headers: { apikey: CLAVE_PUBLICA, Authorization: `Bearer ${token}` },
    });
  } catch {
    /* si no llega, el token vence solo en una hora */
  }
}

/** De cada pedido de la tienda viaja sólo lo que usa el stock (nada de DNI, teléfono ni dirección) */
function minimizarPedido(p: Fila): Fila {
  const d = p.data ?? {};
  return {
    id: p.id,
    ts: p.ts,
    status: p.status,
    data: {
      name: d.name ?? null,
      total: d.total ?? null,
      status: d.status ?? null,
      consumoInterno: d.consumoInterno ?? null,
      items: d.items ?? [],
    },
  };
}

/**
 * Lee el stock real con los permisos de quien entra. SÓLO pedidos GET: esta
 * función no tiene forma de escribir en la base real.
 */
async function traerCopia(token: string, email: string, avance: (texto: string) => void): Promise<Copia> {
  const encabezados = { apikey: CLAVE_PUBLICA, Authorization: `Bearer ${token}`, Accept: 'application/json' };
  async function leer(ruta: string): Promise<Fila[]> {
    const r = await fetch(`${URL_REAL}/rest/v1/${ruta}`, { method: 'GET', headers: encabezados });
    if (!r.ok) {
      const j: Fila = await r.json().catch(() => ({}));
      throw new Error(`No se pudo copiar ${ruta.split('?')[0]}: ${j.message ?? `error ${r.status}`}`);
    }
    return r.json();
  }
  async function leerTodo(tabla: string, orden: string, que: string): Promise<Fila[]> {
    const filas: Fila[] = [];
    for (let desde = 0; ; desde += PAGINA) {
      avance(`Copiando ${que}…` + (filas.length ? ` (${filas.length.toLocaleString('es-AR')})` : ''));
      const pagina = await leer(`${tabla}?select=*&order=${orden}&limit=${PAGINA}&offset=${desde}`);
      filas.push(...pagina);
      if (pagina.length < PAGINA) break;
    }
    return filas;
  }

  avance('Revisando tu usuario…');
  const yo = await leer(`st_users?select=email,activo&email=eq.${encodeURIComponent(email)}`);
  if (!yo.length || yo[0].activo === false)
    throw new Error('Tu usuario no tiene acceso al stock real, así que no hay nada para copiar.');

  const usuarios = await leerTodo('st_users', 'email', 'los usuarios');
  const items = await leerTodo('st_items', 'categoria,codigo', 'el inventario');
  // Del más viejo al más nuevo: si entra un movimiento mientras se copia, va al final y no corre las páginas
  const vistos = new Set<string>();
  const movimientos = (await leerTodo('st_movimientos', 'fecha,id', 'el historial')).filter((m) =>
    vistos.has(m.id) ? false : (vistos.add(m.id), true)
  );
  const skuMap = await leerTodo('st_sku_map', 'producto_id,pres_id', 'los vínculos con la tienda');
  const pedidos = await leerTodo('st_pedidos', 'order_id', 'lo descontado de cada pedido');
  avance('Copiando los pedidos de la tienda…');
  const ordenes = (await leer(`ss_orders?select=id,ts,status,data&order=ts.desc&limit=${PEDIDOS_TIENDA}`)).map(
    minimizarPedido
  );
  const tienda = await leer('ss_store?select=products&id=eq.1');
  return { usuarios, items, movimientos, skuMap, pedidos, ordenes, catalogo: tienda[0]?.products ?? [] };
}

/**
 * Inserta filas tal como vinieron de la base real. Sólo las columnas que
 * existen en las dos: si la real todavía no tiene alguna, queda su valor por
 * defecto.
 */
async function insertar(tabla: string, filas: Fila[]): Promise<void> {
  if (!filas.length) return;
  const cols = (
    await db.query<Fila>(
      `select attname as col, format_type(atttypid, atttypmod) as tipo
         from pg_attribute
        where attrelid = $1::regclass and attnum > 0 and not attisdropped
        order by attnum`,
      [`public.${tabla}`]
    )
  ).rows;
  const presentes = new Set<string>();
  for (const f of filas) for (const k of Object.keys(f)) presentes.add(k);
  const usar = cols.filter((c) => presentes.has(c.col));
  const lista = usar.map((c) => nombre(c.col)).join(', ');
  const definicion = usar.map((c) => `${nombre(c.col)} ${c.tipo}`).join(', ');
  for (let i = 0; i < filas.length; i += 500)
    await db.query(
      `insert into public.${nombre(tabla)} (${lista})
       select ${lista} from jsonb_to_recordset($1::jsonb) as x(${definicion})`,
      [JSON.stringify(filas.slice(i, i + 500))]
    );
}

async function cargarCopia(c: Copia): Promise<void> {
  // Sin disparadores mientras se carga: la copia ya trae el stock, el
  // historial y lo descontado de cada pedido tal como quedaron en la base real
  await db.exec(`set session_replication_role = replica`);
  try {
    // Los scripts traen su propia carga inicial (usuarios y el mapa de la
    // tienda de agosto): se reemplaza entera por la copia
    await db.exec(
      `delete from st_sku_map; delete from st_pedidos; delete from st_movimientos; delete from st_items;
       delete from st_users; delete from ss_orders; delete from ss_store;`
    );
    await insertar('st_users', c.usuarios);
    await insertar('st_items', c.items);
    await insertar('st_movimientos', c.movimientos);
    await insertar('st_sku_map', c.skuMap);
    await insertar('st_pedidos', c.pedidos);
    await insertar('ss_orders', c.ordenes);
    await db.query(`insert into ss_store (id, products) values (1, $1::jsonb)`, [JSON.stringify(c.catalogo)]);
  } finally {
    await db.exec(`set session_replication_role = origin`);
  }
}

/** Entrar con el usuario de siempre: copia el stock real y arma la base de prueba con él */
async function entrarConCopiaReal(email: string, password: string): Promise<Resultado> {
  const limpio = String(email ?? '').trim().toLowerCase();
  mostrarProgreso('Entrando con tu usuario…');
  try {
    const token = await autenticar(limpio, password);
    let copia: Copia;
    try {
      copia = await traerCopia(token, limpio, mostrarProgreso);
    } finally {
      await cerrarSesionReal(token);
    }
    mostrarProgreso('Armando la base de prueba con la copia…');
    await reconstruir(() => cargarCopia(copia), 'real', limpio);
    iniciarSesion(limpio);
    return { data: { session: sesion }, error: null };
  } catch (e: any) {
    return { data: null, error: { message: e?.message ?? String(e) } };
  } finally {
    ocultarProgreso();
  }
}

/** Probar sin usuario: los 15 productos de ejemplo de sandbox/datos.json */
export async function entrarConDatosDeEjemplo(): Promise<{ error?: string }> {
  if (!SERVIDOR) return {};
  mostrarProgreso('Armando la base con los datos de ejemplo…');
  try {
    await reconstruir(
      async () => {
        await db.exec(USUARIO_PRUEBA);
        await db.query(`update st_users set nombre = 'Prueba' where email = $1`, [EMAIL_PRUEBA]);
        await cargarDatosDeEjemplo();
      },
      'ejemplo',
      EMAIL_PRUEBA
    );
    iniciarSesion(EMAIL_PRUEBA);
    return {};
  } catch (e: any) {
    return { error: e?.message ?? String(e) };
  } finally {
    ocultarProgreso();
  }
}

/** Cerrar sesión borra la copia de esta computadora entera */
async function salirYBorrar(): Promise<void> {
  guardarEmail(null);
  sesion = null;
  try {
    await db.close();
  } catch {
    /* ya estaba cerrada */
  }
  // Si el navegador deja el borrado esperando, se completa al recargar,
  // antes de que la página nueva abra la base
  await new Promise<void>((ok) => {
    const r = indexedDB.deleteDatabase(`/pglite/${BASE_IDB}`);
    r.onsuccess = r.onerror = r.onblocked = () => ok();
  });
  location.reload();
}

// ---------------------------------------------------------------------
// Sesión
// ---------------------------------------------------------------------
type Sesion = { access_token: string; user: { id: string; email: string } };
function sesionDe(email: string): Sesion {
  return SERVIDOR
    ? { access_token: 'servidor-de-pruebas', user: { id: email, email } }
    : { access_token: 'banco', user: { id: 'banco', email } };
}
// El banco entra solo, como el admin de prueba; el servidor, eligiendo cómo entrar
let sesion: Sesion | null = SERVIDOR ? null : sesionDe(EMAIL_PRUEBA);

let lista: Promise<void> = SERVIDOR ? abrirServidor() : armarBanco();

const oyentes = new Set<(e: string, s: unknown) => void>();
function iniciarSesion(email: string): void {
  sesion = sesionDe(email);
  guardarEmail(email);
  ponerCartel();
  for (const cb of oyentes) cb('SIGNED_IN', sesion);
}

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
  private ignorarDuplicados = false;
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
  upsert(f: Fila | Fila[], o?: { onConflict?: string; ignoreDuplicates?: boolean }) {
    this.accion = 'upsert';
    this.ignorarDuplicados = !!o?.ignoreDuplicates;
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
            (resto.length && !this.ignorarDuplicados ? `do update set ${resto.map((c) => `${nombre(c)} = excluded.${nombre(c)}`).join(', ')}` : 'do nothing');
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
// auth: el banco está siempre adentro; el servidor entra copiando el stock
// real (o con los datos de ejemplo) y sale borrando la copia
// ---------------------------------------------------------------------
const auth = {
  getSession: async () => {
    if (SERVIDOR) await lista;
    return { data: { session: sesion }, error: null };
  },
  onAuthStateChange: (cb: (e: string, s: unknown) => void) => {
    oyentes.add(cb);
    setTimeout(async () => {
      if (SERVIDOR) await lista;
      cb(sesion ? 'SIGNED_IN' : 'SIGNED_OUT', sesion);
    }, 0);
    return { data: { subscription: { unsubscribe: () => oyentes.delete(cb) } } };
  },
  signInWithPassword: async ({ email, password }: { email: string; password: string }) =>
    SERVIDOR ? entrarConCopiaReal(email, password) : { data: { session: sesion }, error: null },
  signOut: async () => {
    if (SERVIDOR) await salirYBorrar();
    return { error: null };
  },
  resetPasswordForEmail: async () =>
    SERVIDOR
      ? { data: {}, error: { message: 'En el servidor de pruebas no se cambian contraseñas: hacelo desde la plataforma real.' } }
      : { data: {}, error: null },
  updateUser: async () => ({ data: {}, error: null }),
  signUp: async () => ({ data: {}, error: null }),
};

export const sb: any = { from: (tabla: string) => new Consulta(tabla), rpc, auth };
export function clienteAislado(): any {
  return sb;
}

// Lo mismo que exporta src/lib/supabase.ts para las versiones de prueba
export const servidorDePruebas = SERVIDOR;
export const personasDePrueba: { email: string; nombre: string }[] = [];
export async function volverADatosIniciales(): Promise<void> {
  if (SERVIDOR) await salirYBorrar();
  else location.reload();
}
export async function fechaDeLaCopia(): Promise<string | null> {
  await lista;
  return meta?.copiada ?? null;
}

// ---------------------------------------------------------------------
// Para revisar desde la consola: consultar la base directo y, en el banco,
// correr las pruebas de punta a punta (recargar la página antes)
// ---------------------------------------------------------------------
(window as any).__banco = {
  get lista() {
    return lista;
  },
  async query(sql: string, params: unknown[] = []) {
    await lista;
    return (await db.query<Fila>(sql, params)).rows;
  },
  async exec(sql: string) {
    await lista;
    return db.exec(sql);
  },
  ...(SERVIDOR
    ? {}
    : {
        async pruebas() {
          await lista;
          const { correrPruebas } = await import('./pruebas');
          return correrPruebas(async (sql, params = []) => (await db.query<Fila>(sql, params)).rows);
        },
        /** ¿Algo se sale de la pantalla en el ancho actual? */
        async pantallas() {
          const { revisarPantallas } = await import('./pruebas');
          return revisarPantallas();
        },
      }),
};

// ---------------------------------------------------------------------
// Cartel fijo: que nadie confunda esta pestaña con la plataforma real
// ---------------------------------------------------------------------
const cartel = document.createElement('div');
cartel.setAttribute('role', 'status');
cartel.style.cssText =
  'position:fixed;left:0;right:0;bottom:0;z-index:9999;background:#6a4f7a;color:#fff;font:600 12px/1.3 Montserrat,sans-serif;text-align:center;padding:6px 10px;pointer-events:none';

function fechaCorta(iso: string): string {
  const d = new Date(iso);
  return (
    d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' }) +
    ' ' +
    d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
  );
}
function textoCartel(): string {
  if (!SERVIDOR)
    return 'BANCO DE PRUEBAS · base local con una copia del inventario — nada de lo que se haga acá toca los datos reales';
  const fin = 'nada de lo que hagas acá cambia el stock real';
  if (!sesion || !meta) return `SERVIDOR DE PRUEBAS — ${fin}`;
  if (meta.origen === 'ejemplo') return `SERVIDOR DE PRUEBAS · datos de ejemplo — ${fin}`;
  return `SERVIDOR DE PRUEBAS · copia del stock real del ${fechaCorta(meta.copiada)} — ${fin}`;
}
function ponerCartel(): void {
  cartel.textContent = textoCartel();
  if (!cartel.isConnected && document.body) document.body.appendChild(cartel);
}
document.addEventListener('DOMContentLoaded', ponerCartel);
if (document.readyState !== 'loading') ponerCartel();
if (SERVIDOR) document.title = 'PRUEBAS · ' + document.title;

// ---------------------------------------------------------------------
// Mientras se copia y se arma la base: una capa con lo que está pasando
// ---------------------------------------------------------------------
let capa: HTMLDivElement | null = null;
function mostrarProgreso(texto: string): void {
  if (!capa) {
    capa = document.createElement('div');
    capa.setAttribute('role', 'status');
    capa.style.cssText =
      'position:fixed;inset:0;z-index:10000;display:flex;align-items:center;justify-content:center;padding:24px;' +
      'background:rgba(247,245,231,.94);color:#1d1d1b;font-family:var(--font-body,sans-serif);text-align:center';
    capa.innerHTML =
      '<div style="max-width:440px"><div style="font-weight:700;font-size:24px;margin-bottom:10px">Preparando el servidor de pruebas</div>' +
      '<div data-texto style="font-size:17px;color:#4a473f"></div>' +
      '<div style="font-size:13px;color:#6a665c;margin-top:14px">Tarda unos segundos. No cierres esta pestaña.</div></div>';
    document.body.appendChild(capa);
  }
  (capa.querySelector('[data-texto]') as HTMLElement).textContent = texto;
}
function ocultarProgreso(): void {
  capa?.remove();
  capa = null;
}
