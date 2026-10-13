-- =====================================================================
-- PROTECCIÓN DE DATOS + CAMBIOS EN VIVO (2026-10-13)
--
-- Pedido del equipo: "cargamos información y después no la encontramos" y
-- "tenemos que recargar la página para ver lo nuevo". Este script:
--
--   1. Guarda una copia de TODA ficha antes de que se modifique o se borre
--      (st_items y st_sku_map) en st_historial. Nada que se haya guardado
--      se pierde: si alguien pisa o elimina algo, la versión anterior queda
--      ahí y se puede restaurar con st_restaurar(id).
--   2. Marca updated_at / updated_by en cada cambio de una ficha, así la app
--      detecta si otra persona escribió mientras uno editaba.
--   3. El historial de movimientos ya no se puede borrar desde la app.
--   4. Habilita el aviso en vivo (Supabase Realtime) de st_items y
--      st_movimientos: lo que guarda una persona le aparece al resto sin
--      recargar.
--
-- No cambia ningún dato existente: no toca stock, fichas ni movimientos.
-- Es idempotente: se puede correr más de una vez.
-- Va DESPUÉS de stock_schema.sql y stock_tienda.sql.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. COPIA DE SEGURIDAD DE CADA CAMBIO
-- ---------------------------------------------------------------------
create table if not exists public.st_historial (
  id        bigint generated always as identity primary key,
  tabla     text not null,
  operacion text not null,                 -- 'UPDATE' o 'DELETE'
  clave     text not null,                 -- 'producto|CAP-03', 'PROD-1|60c'…
  antes     jsonb not null,                -- la fila completa ANTES del cambio
  despues   jsonb,                         -- cómo quedó (null si se borró)
  quien     text,
  cuando    timestamptz not null default now()
);

create index if not exists st_historial_clave_idx on public.st_historial (tabla, clave, cuando desc);
create index if not exists st_historial_cuando_idx on public.st_historial (cuando desc);

alter table public.st_historial enable row level security;

-- Se lee como el resto del stock. Nadie la escribe ni la borra desde la app:
-- sólo los triggers (security definer) agregan filas.
drop policy if exists "st_historial lectura" on public.st_historial;
create policy "st_historial lectura"
  on public.st_historial for select to authenticated using (public.st_can_read());

create or replace function public.st_guardar_historial()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  v_clave text;
begin
  if tg_table_name = 'st_items' then
    v_clave := old.categoria || '|' || old.codigo;
  else
    v_clave := old.producto_id || '|' || old.pres_id;
  end if;

  -- Un UPDATE que sólo mueve el stock no se copia: cada cambio de stock ya
  -- queda en st_movimientos con su antes y después. Acá va la ficha.
  if tg_op = 'UPDATE'
     and (to_jsonb(new) - 'updated_at' - 'updated_by' - 'actual')
       = (to_jsonb(old) - 'updated_at' - 'updated_by' - 'actual') then
    return new;
  end if;

  insert into public.st_historial (tabla, operacion, clave, antes, despues, quien)
  values (
    tg_table_name,
    tg_op,
    v_clave,
    to_jsonb(old),
    case when tg_op = 'DELETE' then null else to_jsonb(new) end,
    coalesce(lower(auth.jwt() ->> 'email'), current_user)
  );

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists st_items_historial_trg on public.st_items;
create trigger st_items_historial_trg
  after update or delete on public.st_items
  for each row execute function public.st_guardar_historial();

drop trigger if exists st_sku_map_historial_trg on public.st_sku_map;
create trigger st_sku_map_historial_trg
  after update or delete on public.st_sku_map
  for each row execute function public.st_guardar_historial();

-- ---------------------------------------------------------------------
-- 2. MARCA DE ÚLTIMO CAMBIO EN CADA FICHA
-- ---------------------------------------------------------------------
create or replace function public.st_items_marcar()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  new.updated_by := coalesce(lower(auth.jwt() ->> 'email'), new.updated_by);
  return new;
end;
$$;

drop trigger if exists st_items_marcar_trg on public.st_items;
create trigger st_items_marcar_trg
  before update on public.st_items
  for each row execute function public.st_items_marcar();

-- ---------------------------------------------------------------------
-- 3. EL HISTORIAL DE MOVIMIENTOS NO SE BORRA
--    La app nunca borra movimientos; con esto tampoco se puede por error.
-- ---------------------------------------------------------------------
drop policy if exists "st_mov baja admin" on public.st_movimientos;

-- ---------------------------------------------------------------------
-- 4. RESTAURAR UNA FICHA DESDE EL HISTORIAL
--    select public.st_restaurar(123);   -- el id de st_historial
--    Si la ficha fue borrada, la vuelve a crear tal como estaba (con el
--    stock que tenía). Si existe, le devuelve los datos de la ficha pero NO
--    el stock: el número actual sigue mandando, para no deshacer ventas.
--    Sólo para admin.
-- ---------------------------------------------------------------------
create or replace function public.st_restaurar(p_id bigint)
returns text
language plpgsql security definer
set search_path = public
as $$
declare
  h public.st_historial;
  f jsonb;
begin
  if not public.st_is_admin() then
    raise exception 'Sólo un admin puede restaurar.';
  end if;
  select * into h from public.st_historial where id = p_id;
  if not found then
    raise exception 'No existe el registro % del historial.', p_id;
  end if;
  f := h.antes;

  if h.tabla = 'st_items' then
    if exists (select 1 from public.st_items where categoria = f->>'categoria' and codigo = f->>'codigo') then
      update public.st_items
         set nombre = f->>'nombre', minimo = (f->>'minimo')::numeric, data = f->'data'
       where categoria = f->>'categoria' and codigo = f->>'codigo';
      return 'Ficha ' || (f->>'codigo') || ' restaurada (el stock actual no se tocó).';
    end if;
    insert into public.st_items (categoria, codigo, nombre, actual, minimo, data)
    values (f->>'categoria', f->>'codigo', f->>'nombre', (f->>'actual')::numeric,
            (f->>'minimo')::numeric, coalesce(f->'data', '{}'::jsonb));
    return 'Ítem ' || (f->>'codigo') || ' vuelto a crear con ' || (f->>'actual') || ' en stock.';
  end if;

  if h.tabla = 'st_sku_map' then
    insert into public.st_sku_map
      select * from jsonb_populate_record(null::public.st_sku_map, f)
    on conflict (producto_id, pres_id) do nothing;
    return 'Vínculo ' || h.clave || ' restaurado (si ya existía, quedó como estaba).';
  end if;

  raise exception 'Tabla % no restaurable.', h.tabla;
end;
$$;

revoke all on function public.st_restaurar(bigint) from public;
grant execute on function public.st_restaurar(bigint) to authenticated;

-- ---------------------------------------------------------------------
-- 5. CAMBIOS EN VIVO (Supabase Realtime)
--    Respeta RLS: cada persona sólo recibe lo que ya podía leer.
-- ---------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
  if not exists (select 1 from pg_publication_tables
                 where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'st_items') then
    alter publication supabase_realtime add table public.st_items;
  end if;
  if not exists (select 1 from pg_publication_tables
                 where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'st_movimientos') then
    alter publication supabase_realtime add table public.st_movimientos;
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- CONTROL (tiene que dar las tres filas en true)
-- ---------------------------------------------------------------------
select 'historial activo' as control,
       exists (select 1 from pg_trigger where tgname = 'st_items_historial_trg') as ok
union all
select 'en vivo st_items',
       exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'st_items')
union all
select 'en vivo st_movimientos',
       exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'st_movimientos');
