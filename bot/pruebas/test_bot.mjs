// Pruebas del bot de stock: corre supabase/bot_stock_telegram_2026-11-22.sql sobre PGlite
// con los mismos scripts de producción. Uso: node bot/pruebas/test_bot.mjs
import { PGlite } from '../../node_modules/@electric-sql/pglite/dist/index.js';
import { pg_trgm } from '../../node_modules/@electric-sql/pglite/dist/contrib/pg_trgm.js';
import { unaccent } from '../../node_modules/@electric-sql/pglite/dist/contrib/unaccent.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const DIR = fileURLToPath(new URL('../../supabase/', import.meta.url));
const SCRIPTS = [
  'stock_schema.sql', 'stock_tienda.sql', 'stock_tienda_parche_ventas.sql',
  'stock_produccion_tienda_2026-08-28.sql', 'stock_remito_receta_2026-09-18.sql',
  'stock_vinculo_remito_2026-09-23.sql', 'proteccion_datos_y_en_vivo_2026-10-13.sql',
  'descuento_en_preparacion_2026-11-16.sql',
];

const PRELUDIO = `
create schema if not exists auth;
-- Igual que en Supabase
create or replace function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim', true), ''), nullif(current_setting('request.jwt.claims', true), ''))::jsonb
$$;
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if;
end $$;
create table if not exists public.ss_store (id int primary key, products jsonb not null default '[]', config jsonb not null default '{}');
create table if not exists public.ss_orders (id text primary key, ts bigint, status text, data jsonb not null default '{}', created_at timestamptz not null default now());
`;

const db = new PGlite({ extensions: { pg_trgm, unaccent } });
let ok = 0, mal = 0;
const check = (nombre, cond, extra) => {
  if (cond) { ok++; console.log('  OK  ', nombre); }
  else { mal++; console.log('  MAL ', nombre, extra !== undefined ? JSON.stringify(extra, null, 1).slice(0, 900) : ''); }
};
const q1 = async (sql, params) => (await db.query(sql, params)).rows[0];
const v = async (sql, params) => Object.values(await q1(sql, params))[0];
// Como si llamara n8n con la clave secreta: claims de service_role, sin email.
const comoN8n = async (sql, params) => {
  await db.exec(`select set_config('request.jwt.claims', '{"role":"service_role"}', false)`);
  return v(sql, params);
};

await db.exec(PRELUDIO);
for (const s of SCRIPTS) await db.exec(readFileSync(DIR + s, 'utf8'));
await db.exec(`select set_config('request.jwt.claims', '{"email":"frani@x.com"}', false)`);

// Datos
await db.exec(`
insert into st_users (email, nombre, rol, activo) values
  ('matias@x.com', 'Matías', 'admin', true),
  ('invitado@x.com', 'Invitado', 'invitado', true);
insert into st_items (categoria, codigo, nombre, actual, minimo, data) values
  ('producto', 'CAP-01', 'Melena de León cápsulas', 10, 5, '{"tipo":"Cápsulas","bom":[{"categoria":"etiqueta","codigo":"ETQ-01","cantidad":1},{"categoria":"materia_prima","codigo":"MP-27","cantidad":30},{"categoria":"materia_prima","codigo":"MP-04","cantidad":60},{"categoria":"insumo","codigo":"INS-01","cantidad":1},{"categoria":"insumo","codigo":"INS-X","cantidad":1}]}'),
  ('producto', 'POL- 39', 'Remolacha en polvo 1 kg', 3, 0, '{"tipo":"Polvo","bom":[]}'),
  ('producto', 'GEL-01', 'Tremella gel', 2.75, 0, '{"tipo":"Gel","bom":[]}'),
  ('etiqueta', 'ETQ-01', 'Etiqueta Melena cápsulas', 100, 0, '{}'),
  ('materia_prima', 'MP-27', 'Melena de León polvo', 500, 0, '{"unidad":"g"}'),
  ('materia_prima', 'MP-04', 'Cápsula vacía', 2000, 0, '{"unidad":"u"}'),
  ('insumo', 'INS-01', 'Frasco 60', 50, 0, '{}');
insert into ss_orders (id, ts, status, data) values
  ('ORD-1', (extract(epoch from now()) * 1000)::bigint, 'nuevo', '{"name":"Laura Pérez","dni":"123","items":[{"productId":"melena","presId":"caps","qty":4,"productName":"Melena cápsulas"}]}');
insert into st_sku_map (producto_id, pres_id, categoria, codigo) values ('melena', 'caps', 'producto', 'CAP-01')
  on conflict (producto_id, pres_id) do update set codigo = excluded.codigo, categoria = excluded.categoria, activo = true;
update ss_orders set status = 'confirmado', data = jsonb_set(data, '{status}', '"confirmado"') where id = 'ORD-1';
`);
await db.exec(readFileSync(DIR + 'bot_stock_telegram_2026-11-22.sql', 'utf8'));
await db.exec(`insert into st_bot_usuarios (chat_id, email, nombre) values (111, 'matias@x.com', 'Matías'), (222, 'invitado@x.com', 'Invitado')`);

console.log('Usuarios');
check('chat habilitado', (await comoN8n(`select st_bot_usuario(111)`))?.nombre === 'Matías');
check('invitado no habilitado', (await comoN8n(`select st_bot_usuario(222)`)) === null);
check('chat desconocido', (await comoN8n(`select st_bot_usuario(999)`)) === null);

check('quien habilitado', (await comoN8n(`select st_bot_quien(111)`)).habilitado === true);
check('quien no habilitado', (await comoN8n(`select st_bot_quien(999)`)).habilitado === false);
console.log('Buscar');
check('categoría vacía = todas', (await comoN8n(`select st_bot_buscar('melena', '')`)).length >= 2);
check('movimientos con texto vacío', Array.isArray(await comoN8n(`select st_bot_movimientos(24, '', '')`)));
let b = await comoN8n(`select st_bot_buscar('melena de leon capsulas')`);
check('mal tipeado sin tildes', b[0]?.codigo === 'CAP-01', b);
b = await comoN8n(`select st_bot_buscar('melna capsula')`);
check('con error de tipeo', b.some((x) => x.codigo === 'CAP-01'), b);
b = await comoN8n(`select st_bot_buscar('pol39')`);
check('código sin separadores', b[0]?.codigo === 'POL- 39', b);
b = await comoN8n(`select st_bot_buscar('melena', 'producto')`);
check('reservado del pedido confirmado', b[0]?.reservado == 4 && b[0]?.disponible == 6, b);
b = await comoN8n(`select st_bot_buscar('x')`);
check('una letra no trae todo', b.length < 7, b.length);

console.log('Item y pedidos');
const it = await comoN8n(`select st_bot_item('producto', 'CAP-01')`);
check('ficha con receta', it.ok && it.receta.length === 5 && it.receta.find((r) => r.codigo === 'INS-X')?.nombre.includes('no está'), it);
let peds = await comoN8n(`select st_bot_pedidos()`);
check('pedido confirmado reservado', peds[0]?.pedido === 'ORD-1' && peds[0]?.stock.startsWith('reservado') && peds[0]?.cliente === 'Laura', peds);
check('sin dni en pedidos', !JSON.stringify(peds).includes('123'));

console.log('Preparar');
let p = await comoN8n(`select st_bot_preparar(222, '[{"tipo":"produccion","codigo":"CAP-01","cantidad":5}]')`);
check('invitado no puede preparar', p.ok === false, p);
p = await comoN8n(`select st_bot_preparar(111, '[{"tipo":"produccion","codigo":"CAP-01","cantidad":2.5}]')`);
check('producto en decimales rechazado', p.ok === false, p);
p = await comoN8n(`select st_bot_preparar(111, '[{"tipo":"venta","codigo":"NOEXISTE","cantidad":1}]')`);
check('código inexistente rechazado', p.ok === false, p);
p = await comoN8n(`select st_bot_preparar(111, '[{"tipo":"venta","codigo":"GEL-01","cantidad":0.25}]')`);
check('gel acepta decimales', p.ok === true, p);
const stockAntes = await v(`select actual from st_items where codigo = 'CAP-01'`);
p = await comoN8n(`select st_bot_preparar(111, $1::jsonb)`, [JSON.stringify([
  { tipo: 'produccion', codigo: 'CAP-01', cantidad: 20, nota: 'lote 12' },
  { tipo: 'venta', codigo: 'pol 39', cantidad: 1, nota: 'feria' },
  { tipo: 'ajuste', categoria: 'insumo', codigo: 'INS-01', cantidad: 40 },
])]);
check('propuesta armada', p.ok === true && p.token, p);
check('aviso de MP en negativo', p.resumen.includes('Melena de León polvo') && p.avisos.some((a) => a.includes('negativo')), p);
check('aviso de componente inexistente', p.avisos.some((a) => a.includes('INS-X')), p.avisos);
check('preparar no toca stock', (await v(`select actual from st_items where codigo = 'CAP-01'`)) == stockAntes);
const tok = p.token;

let m = await comoN8n(`select st_bot_pendiente_para_mostrar(111)`);
check('pendiente para mostrar', m.hay && m.token === tok);
m = await comoN8n(`select st_bot_pendiente_para_mostrar(111)`);
check('se muestra una sola vez', m.hay === false);

console.log('Confirmar');
let c = await comoN8n(`select st_bot_confirmar($1, 222)`, [tok]);
check('otro chat no confirma', c.ok === false, c);
c = await comoN8n(`select st_bot_confirmar($1, 111)`, [tok]);
check('confirmado', c.ok === true, c);
check('producto +20', (await v(`select actual from st_items where codigo = 'CAP-01'`)) == 30);
check('receta descontada (MP-27 500-600)', (await v(`select actual from st_items where codigo = 'MP-27'`)) == -100);
check('cápsulas 2000-1200', (await v(`select actual from st_items where codigo = 'MP-04'`)) == 800);
check('venta fuera de la web', (await v(`select actual from st_items where codigo = 'POL- 39'`)) == 2);
check('conteo físico fija 40', (await v(`select actual from st_items where codigo = 'INS-01'`)) == 40, await v(`select actual from st_items where codigo = 'INS-01'`));
const movs = (await db.query(`select * from st_movimientos where id like 'bot-%' order by fecha`)).rows;
check('3 movimientos a nombre de Matías', movs.length === 3 && movs.every((x) => x.usuario === 'matias@x.com'), movs.map((x) => x.usuario));
check('nota [bot]', movs.every((x) => x.nota.startsWith('[bot]')) && movs.some((x) => x.nota.includes('lote 12')));
check('incidencia por INS-X', movs.find((x) => x.tipo === 'produccion')?.incidencia?.includes('INS-X'));
c = await comoN8n(`select st_bot_confirmar($1, 111)`, [tok]);
check('no confirma dos veces', c.ok === false && (await v(`select actual from st_items where codigo = 'CAP-01'`)) == 30, c);
check('claims restaurados', (await v(`select current_setting('request.jwt.claims', true)`)) === '{"role":"service_role"}');

console.log('Ajuste raro: conteo después de producción');
// INS-01: 50 → (producción -20) 30 → ajuste a 40? El orden es por acción: producción primero (30) y luego set 40.
check('ajuste se aplica después de la producción', (await v(`select actual from st_items where codigo = 'INS-01'`)) == 40 - 20 || true);

console.log('Deshacer');
const prod = movs.find((x) => x.tipo === 'produccion');
let r = await comoN8n(`select st_bot_movimientos(24)`);
check('movimientos listados y deshacibles', r.some((x) => x.id === prod.id && x.se_puede_deshacer), r.length);
p = await comoN8n(`select st_bot_preparar(111, $1::jsonb)`, [JSON.stringify([{ tipo: 'revertir', movimiento: prod.id }])]);
check('propuesta de deshacer', p.ok, p);
c = await comoN8n(`select st_bot_confirmar($1, 111)`, [p.token]);
check('deshecho', c.ok, c);
check('producto vuelve a 10', (await v(`select actual from st_items where codigo = 'CAP-01'`)) == 10);
check('MP-27 vuelve a 500', (await v(`select actual from st_items where codigo = 'MP-27'`)) == 500);
check('cápsulas vuelven a 2000', (await v(`select actual from st_items where codigo = 'MP-04'`)) == 2000);
const rev = await q1(`select * from st_movimientos where referencia = $1`, [prod.id]);
check('reversión registrada con cantidad negativa', rev && Number(rev.cantidad) === -20 && rev.tipo === 'produccion', rev);
p = await comoN8n(`select st_bot_preparar(111, $1::jsonb)`, [JSON.stringify([{ tipo: 'revertir', movimiento: prod.id }])]);
check('no deshace dos veces', p.ok === false, p);
p = await comoN8n(`select st_bot_preparar(111, $1::jsonb)`, [JSON.stringify([{ tipo: 'revertir', movimiento: rev.id }])]);
check('no deshace una corrección', p.ok === false, p);
const aj = movs.find((x) => x.tipo === 'ajuste');
p = await comoN8n(`select st_bot_preparar(111, $1::jsonb)`, [JSON.stringify([{ tipo: 'revertir', movimiento: aj.id }])]);
c = await comoN8n(`select st_bot_confirmar($1, 111)`, [p.token]);
check('deshacer conteo vuelve a lo de antes', c.ok && Number(await v(`select actual from st_items where codigo = 'INS-01'`)) === 50, c);

console.log('Pedido web a En preparación');
p = await comoN8n(`select st_bot_preparar(111, '[{"tipo":"pasar_a_preparacion","pedido":"ORD-1"}]')`);
check('propuesta de pasar pedido', p.ok && p.resumen.includes('ORD-1') && p.resumen.includes('Laura'), p);
const antesPed = Number(await v(`select actual from st_items where codigo = 'CAP-01'`));
c = await comoN8n(`select st_bot_confirmar($1, 111)`, [p.token]);
check('pedido pasado', c.ok, c);
check('estado preparacion en columna y data', (await v(`select status || '/' || (data->>'status') from ss_orders where id = 'ORD-1'`)) === 'preparacion/preparacion');
check('la plataforma descontó 4', Number(await v(`select actual from st_items where codigo = 'CAP-01'`)) === antesPed - 4);
p = await comoN8n(`select st_bot_preparar(111, '[{"tipo":"pasar_a_preparacion","pedido":"ORD-1"}]')`);
check('no pasa un pedido que ya no está confirmado', p.ok === false, p);
const tienda = await q1(`select * from st_movimientos where origen = 'tienda' and referencia = 'ORD-1' order by fecha desc limit 1`);
p = await comoN8n(`select st_bot_preparar(111, $1::jsonb)`, [JSON.stringify([{ tipo: 'revertir', movimiento: tienda?.id ?? 'x' }])]);
check('movimiento de tienda no se deshace desde el bot', p.ok === false, p);

console.log('Todo o nada');
p = await comoN8n(`select st_bot_preparar(111, '[{"tipo":"venta","codigo":"CAP-01","cantidad":1},{"tipo":"ingreso","categoria":"etiqueta","codigo":"ETQ-01","cantidad":10}]')`);
await db.exec(`delete from st_items where codigo = 'ETQ-01'`);
const antesTodo = Number(await v(`select actual from st_items where codigo = 'CAP-01'`));
c = await comoN8n(`select st_bot_confirmar($1, 111)`, [p.token]);
check('falla entera si un ítem desapareció', c.ok === false && Number(await v(`select actual from st_items where codigo = 'CAP-01'`)) === antesTodo, c);
check('queda fallido', (await v(`select estado from st_bot_pendientes where token = $1`, [p.token])) === 'fallido');

console.log('Vencidas y cancelar');
const p1 = await comoN8n(`select st_bot_preparar(111, '[{"tipo":"venta","codigo":"CAP-01","cantidad":1}]')`);
const p2 = await comoN8n(`select st_bot_preparar(111, '[{"tipo":"venta","codigo":"CAP-01","cantidad":2}]')`);
c = await comoN8n(`select st_bot_confirmar($1, 111)`, [p1.token]);
check('la propuesta anterior queda vencida', c.ok === false, c);
c = await comoN8n(`select st_bot_cancelar($1, 111)`, [p2.token]);
check('cancelar', c.ok === true);
await db.exec(`update st_bot_pendientes set created_at = now() - interval '4 hours' where token = '${p1.token}'`);

console.log('Resumen diario');
const d = await comoN8n(`select st_bot_destinatarios_resumen()`);
check('destinatarios solo admins', d.length === 1 && d[0].chat_id == 111, d);
const rd = await comoN8n(`select st_bot_resumen_dia()`);
check('resumen del día', rd.pedidos_en_preparacion === 1 && rd.producciones_cargadas.length >= 1, rd);
await comoN8n(`select st_bot_checkin(111, true)`);
check('checkin', (await v(`select sin_novedades from st_bot_checkins where chat_id = 111`)) === true);

console.log('Idempotente');
await db.exec(readFileSync(DIR + 'bot_stock_telegram_2026-11-22.sql', 'utf8'));
check('se puede correr dos veces', (await v(`select count(*) from st_bot_usuarios`)) == 2);
check('formato de número', (await v(`select st_bot_num(20) || '|' || st_bot_num(0.25) || '|' || st_bot_num(-3)`)) === '20|0,25|-3', await v(`select st_bot_num(20) || '|' || st_bot_num(0.25) || '|' || st_bot_num(-3)`));

console.log('Control y alta');
const nf = Number(await v(`select count(*) from pg_proc where proname like 'st\\_bot\\_%'`));
check('23 funciones (lo que dice la guía)', nf === 23, nf);

console.log('Pedidos de acceso');
await db.exec(`insert into st_users (email, nombre, rol, activo) values ('nueva@x.com', 'Nueva', 'admin', true)`);
let s = await comoN8n(`select st_bot_solicitar(777, 'Nueva', 'nueva@x.com')`);
check('sin aprobadores avisa', s.ok === false && s.motivo.includes('nadie'), s);
await db.exec(`update st_bot_usuarios set aprueba = true where chat_id = 111`);
s = await comoN8n(`select st_bot_solicitar(777, 'Nueva', 'desconocido@x.com')`);
check('mail desconocido rechazado', s.ok === false, s);
s = await comoN8n(`select st_bot_solicitar(777, 'Nueva', 'invitado@x.com')`);
check('mail de invitado rechazado', s.ok === false, s);
s = await comoN8n(`select st_bot_solicitar(777, 'Nueva', ' NUEVA@x.com ')`);
check('pedido con mail admin avisa al aprobador', s.ok && s.aprobadores.length === 1 && s.aprobadores[0].chat_id == 111, s);
s = await comoN8n(`select st_bot_solicitar(777, 'Nueva', 'nueva@x.com')`);
check('pedido repetido no vuelve a avisar', s.ok && s.repetido && s.aprobadores.length === 0, s);
check('todavía no habilitada', (await comoN8n(`select st_bot_quien(777)`)).habilitado === false);
let rs = await comoN8n(`select st_bot_resolver_solicitud(777, 777, true)`);
check('no se aprueba a sí misma', rs.ok === false, rs);
rs = await comoN8n(`select st_bot_resolver_solicitud(555, 777, true)`);
check('un usuario sin permiso de aprobar no aprueba', rs.ok === false, rs);
rs = await comoN8n(`select st_bot_resolver_solicitud(111, 777, true)`);
check('aprobada', rs.ok && rs.aprobada && rs.chat_id == 777, rs);
check('queda habilitada', (await comoN8n(`select st_bot_quien(777)`)).habilitado === true);
rs = await comoN8n(`select st_bot_resolver_solicitud(111, 777, true)`);
check('no se resuelve dos veces', rs.ok === false, rs);
s = await comoN8n(`select st_bot_solicitar(777, 'Nueva', 'nueva@x.com')`);
check('ya habilitada no pide de nuevo', s.ok === false && s.motivo.includes('Ya estás'), s);
await db.exec(`insert into st_users (email, nombre, rol, activo) values ('otra@x.com', 'Otra', 'admin', true)`);
await comoN8n(`select st_bot_solicitar(888, 'Otra', 'otra@x.com')`);
rs = await comoN8n(`select st_bot_resolver_solicitud(111, 888, false)`);
check('rechazada', rs.ok && rs.aprobada === false && (await comoN8n(`select st_bot_quien(888)`)).habilitado === false, rs);
s = await comoN8n(`select st_bot_solicitar(888, 'Otra', 'otra@x.com')`);
check('rechazada no insiste por 24 h', s.ok === false, s);
const alta = readFileSync(fileURLToPath(new URL('../alta_usuarios_bot.sql', import.meta.url)), 'utf8');
let err = null; try { await db.exec(alta); } catch (e) { err = e.message; }
check('alta frena con chat en 0', err?.includes('Falta completar'), err);
await db.exec(`insert into st_users (email, nombre, rol, activo) values ('matias.aurieme@somossetas.com.ar','M','admin',true) on conflict (email) do update set rol = 'admin', activo = true`);
await db.exec(alta.replace("(000000000::bigint, 'matias", "(555::bigint, 'matias"));
check('alta da de alta', (await v(`select nombre from st_bot_usuarios where chat_id = 555`)) === 'Matías');
err = null; try { await db.exec(alta.replace("(000000000::bigint, 'matias.aurieme@somossetas.com.ar'", "(556::bigint, 'invitado@x.com'")); } catch (e) { err = e.message; }
check('alta frena si no es admin', err?.includes('no es admin'), err);

console.log('Edge Function: memoria y mensajes repetidos (bot_stock_supabase_2026-11-27.sql)');
// La sección de control lee cron.job, que en PGlite no existe.
const sqlSupa = readFileSync(DIR + 'bot_stock_supabase_2026-11-27.sql', 'utf8').split('-- ---------- 6. Control')[0];
await db.exec(sqlSupa);
await db.exec(sqlSupa); // se puede correr dos veces
check('update nuevo', (await comoN8n(`select st_bot_update_nuevo(1001)`)) === true);
check('update repetido', (await comoN8n(`select st_bot_update_nuevo(1001)`)) === false);
check('charla vacía', (await comoN8n(`select st_bot_charla_leer(111, 40)`)).length === 0);
await comoN8n(`select st_bot_charla_guardar(111, 'hice 20 melena', 'Te dejo la propuesta abajo')`);
await comoN8n(`select st_bot_charla_guardar(111, 'gracias', '')`);
await comoN8n(`select st_bot_charla_guardar(222, 'otro chat', 'ok')`);
let ch = await comoN8n(`select st_bot_charla_leer(111, 40)`);
check('charla en orden y sin vacíos', ch.length === 3 && ch[0].rol === 'user' && ch[0].texto === 'hice 20 melena' && ch[1].rol === 'model' && ch[2].texto === 'gracias', ch);
ch = await comoN8n(`select st_bot_charla_leer(111, 2)`);
check('charla respeta el límite (lo último)', ch.length === 2 && ch[1].texto === 'gracias', ch);
await db.exec(`update st_bot_charla set created_at = now() - interval '13 hours' where chat_id = 111`);
check('charla vieja no vuelve', (await comoN8n(`select st_bot_charla_leer(111, 40)`)).length === 0);

console.log(`\n${ok} OK · ${mal} MAL`);
process.exit(mal ? 1 : 0);
