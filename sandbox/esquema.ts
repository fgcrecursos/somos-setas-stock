// =====================================================================
// BANCO DE PRUEBAS — esquema de la base
//
// Se arma con LOS MISMOS scripts que se corrieron en Supabase, en el mismo
// orden, así las funciones que descuentan stock (st_aplicar, st_sync_pedido,
// el disparador de pedidos de la tienda) son exactamente las de producción.
// Lo único inventado es el "preludio": lo que en Supabase ya existe y acá no
// (el esquema auth, los roles y las tablas de la tienda).
// =====================================================================
import schema from '../supabase/stock_schema.sql?raw';
import tienda from '../supabase/stock_tienda.sql?raw';
import parcheVentas from '../supabase/stock_tienda_parche_ventas.sql?raw';
import produccion from '../supabase/stock_produccion_tienda_2026-08-28.sql?raw';
import remitoReceta from '../supabase/stock_remito_receta_2026-09-18.sql?raw';
import vinculoRemito from '../supabase/stock_vinculo_remito_2026-09-23.sql?raw';

/** El usuario con el que "entra" el banco de pruebas: admin del stock */
export const EMAIL_PRUEBA = 'prueba@banco.local';

export const PRELUDIO = `
create schema if not exists auth;
-- En Supabase, auth.jwt() trae el token de quien llama. Acá siempre es el
-- usuario de prueba (o el que se fije con set_config('banco.email', …)).
create or replace function auth.jwt() returns jsonb language sql stable as $$
  select jsonb_build_object('email', coalesce(nullif(current_setting('banco.email', true), ''), '${EMAIL_PRUEBA}'))
$$;
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
end $$;

-- Tablas de la tienda que usan las funciones del stock
create table if not exists public.ss_store (
  id int primary key,
  products jsonb not null default '[]'::jsonb,
  config jsonb not null default '{}'::jsonb
);
create table if not exists public.ss_orders (
  id text primary key,
  ts bigint,
  status text,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
`;

/** En el orden en que se corrieron en producción */
export const SCRIPTS: [string, string][] = [
  ['stock_schema.sql', schema],
  ['stock_tienda.sql', tienda],
  ['stock_tienda_parche_ventas.sql', parcheVentas],
  ['stock_produccion_tienda_2026-08-28.sql', produccion],
  ['stock_remito_receta_2026-09-18.sql', remitoReceta],
  ['stock_vinculo_remito_2026-09-23.sql', vinculoRemito],
];

export const USUARIO_PRUEBA = `
insert into public.st_users (email, nombre, rol, activo)
values ('${EMAIL_PRUEBA}', 'Banco de pruebas', 'admin', true)
on conflict (email) do update set rol = 'admin', activo = true;
`;
