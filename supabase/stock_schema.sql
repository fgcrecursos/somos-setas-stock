-- =====================================================================
-- SOMOS SETAS · CONTROL DE STOCK — Base de datos
-- ---------------------------------------------------------------------
-- Ejecutar UNA vez en el SQL Editor de Supabase (proyecto muuqqbocpumdvhvxsigz,
-- el mismo de la tienda). Se puede volver a ejecutar sin romper nada.
--
-- Qué crea:
--   st_users        · quién entra a la plataforma de stock y con qué rol
--   st_items        · todo el inventario (productos, insumos, etiquetas, MP)
--   st_movimientos  · el historial completo (ventas, producción, ingresos, ajustes)
--
-- La autenticación es la de Supabase Auth (tabla auth.users), la misma que usa
-- el panel de la tienda: quien ya tiene cuenta ahí entra con el mismo email y
-- contraseña. Esta tabla solo define QUÉ puede hacer cada uno acá adentro.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. USUARIOS DE LA PLATAFORMA DE STOCK
--    rol 'admin'    → crea, edita, vende, produce, ajusta.
--    rol 'invitado' → solo mira. No puede tocar nada.
-- ---------------------------------------------------------------------
create table if not exists public.st_users (
  email      text primary key,
  nombre     text,
  rol        text not null default 'invitado',
  activo     boolean not null default true,
  notas      text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.st_users drop constraint if exists st_users_rol_check;
alter table public.st_users add constraint st_users_rol_check check (rol in ('admin', 'invitado'));

-- El email siempre en minúsculas: es la clave con la que se busca al entrar.
create or replace function public.st_users_normalize()
returns trigger language plpgsql as $$
begin
  new.email := lower(trim(new.email));
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists st_users_normalize_trg on public.st_users;
create trigger st_users_normalize_trg
  before insert or update on public.st_users
  for each row execute function public.st_users_normalize();

-- ---------------------------------------------------------------------
-- 2. INVENTARIO
--    Una fila por ítem. Los campos que cambian y se calculan viven en
--    columnas propias (para poder sumar y restar en la base); el resto de
--    la ficha (tipo, presentación, receta, lote, proveedor…) va en `data`.
-- ---------------------------------------------------------------------
create table if not exists public.st_items (
  categoria  text not null,
  codigo     text not null,
  nombre     text not null default '',
  actual     numeric not null default 0,
  minimo     numeric not null default 0,
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by text,
  primary key (categoria, codigo)
);

alter table public.st_items drop constraint if exists st_items_categoria_check;
alter table public.st_items add constraint st_items_categoria_check
  check (categoria in ('producto', 'insumo', 'insumo_interno', 'etiqueta', 'materia_prima'));

create index if not exists st_items_categoria_idx on public.st_items (categoria);

-- ---------------------------------------------------------------------
-- 3. HISTORIAL DE MOVIMIENTOS
--    Cada venta, producción, ingreso y ajuste, con el detalle de los
--    componentes que se descontaron y quién lo hizo.
-- ---------------------------------------------------------------------
create table if not exists public.st_movimientos (
  id          text primary key,
  fecha       timestamptz not null default now(),
  tipo        text not null,
  categoria   text not null,
  codigo      text not null,
  nombre      text not null default '',
  cantidad    numeric not null default 0,
  nota        text,
  componentes jsonb not null default '[]'::jsonb,
  usuario     text
);

alter table public.st_movimientos drop constraint if exists st_movimientos_tipo_check;
alter table public.st_movimientos add constraint st_movimientos_tipo_check
  check (tipo in ('venta', 'produccion', 'ingreso', 'ajuste'));

create index if not exists st_movimientos_fecha_idx on public.st_movimientos (fecha desc);
create index if not exists st_movimientos_tipo_fecha_idx on public.st_movimientos (tipo, fecha desc);
create index if not exists st_movimientos_codigo_idx on public.st_movimientos (codigo);

-- ---------------------------------------------------------------------
-- 4. ¿QUIÉN ES QUIÉN?
--    SECURITY DEFINER para que las políticas puedan consultar st_users sin
--    caer en la recursión infinita de RLS.
-- ---------------------------------------------------------------------
create or replace function public.st_is_admin()
returns boolean
language sql security definer stable
set search_path = public
as $$
  select exists (
    select 1 from public.st_users u
    where u.email = lower(auth.jwt() ->> 'email')
      and u.rol = 'admin'
      and u.activo
  );
$$;

-- Puede mirar cualquiera que esté dado de alta y activo (admin o invitado).
create or replace function public.st_can_read()
returns boolean
language sql security definer stable
set search_path = public
as $$
  select exists (
    select 1 from public.st_users u
    where u.email = lower(auth.jwt() ->> 'email')
      and u.activo
  );
$$;

revoke all on function public.st_is_admin() from public;
revoke all on function public.st_can_read() from public;
grant execute on function public.st_is_admin() to authenticated;
grant execute on function public.st_can_read() to authenticated;

-- ---------------------------------------------------------------------
-- 5. RLS — nadie sin cuenta ve nada; el invitado mira pero no escribe.
-- ---------------------------------------------------------------------
alter table public.st_users       enable row level security;
alter table public.st_items       enable row level security;
alter table public.st_movimientos enable row level security;

-- st_users: cada uno ve su propia ficha (necesita saber su rol al entrar);
-- el admin ve y gestiona a todos.
drop policy if exists "st_users lectura propia o admin" on public.st_users;
create policy "st_users lectura propia o admin"
  on public.st_users for select to authenticated
  using (email = lower(auth.jwt() ->> 'email') or public.st_is_admin());

drop policy if exists "st_users alta admin" on public.st_users;
create policy "st_users alta admin"
  on public.st_users for insert to authenticated
  with check (public.st_is_admin());

drop policy if exists "st_users edicion admin" on public.st_users;
create policy "st_users edicion admin"
  on public.st_users for update to authenticated
  using (public.st_is_admin()) with check (public.st_is_admin());

drop policy if exists "st_users baja admin" on public.st_users;
create policy "st_users baja admin"
  on public.st_users for delete to authenticated
  using (public.st_is_admin() and email <> lower(auth.jwt() ->> 'email'));

-- st_items: lee cualquiera dado de alta, escribe solo el admin.
drop policy if exists "st_items lectura" on public.st_items;
create policy "st_items lectura"
  on public.st_items for select to authenticated using (public.st_can_read());

drop policy if exists "st_items alta admin" on public.st_items;
create policy "st_items alta admin"
  on public.st_items for insert to authenticated with check (public.st_is_admin());

drop policy if exists "st_items edicion admin" on public.st_items;
create policy "st_items edicion admin"
  on public.st_items for update to authenticated
  using (public.st_is_admin()) with check (public.st_is_admin());

drop policy if exists "st_items baja admin" on public.st_items;
create policy "st_items baja admin"
  on public.st_items for delete to authenticated using (public.st_is_admin());

-- st_movimientos: el historial se lee entero, lo escribe solo el admin.
drop policy if exists "st_mov lectura" on public.st_movimientos;
create policy "st_mov lectura"
  on public.st_movimientos for select to authenticated using (public.st_can_read());

drop policy if exists "st_mov alta admin" on public.st_movimientos;
create policy "st_mov alta admin"
  on public.st_movimientos for insert to authenticated with check (public.st_is_admin());

drop policy if exists "st_mov baja admin" on public.st_movimientos;
create policy "st_mov baja admin"
  on public.st_movimientos for delete to authenticated using (public.st_is_admin());

-- ---------------------------------------------------------------------
-- 6. APLICAR UN MOVIMIENTO DE FORMA ATÓMICA
--    La app calcula qué consume la receta y manda los deltas; la base los
--    suma con `actual = actual + delta` y devuelve el stock resultante.
--    Así dos personas pueden vender al mismo tiempo sin pisarse: cada
--    descuento se aplica sobre el valor real del momento, no sobre la
--    copia que tenía cargada el navegador.
--
--    p_deltas: [{"categoria":"insumo","codigo":"FR-30","delta":-5}, …]
--              o {"set": 120} para fijar un valor exacto (conteo físico).
--    p_mov:    el movimiento completo (id, tipo, codigo, nombre, …)
--    Devuelve: { resultantes: [{categoria, codigo, anterior, actual}],
--                componentes: los del movimiento con el stock real que quedó,
--                cantidad:    la cantidad efectiva (importa en los ajustes) }
-- ---------------------------------------------------------------------
create or replace function public.st_aplicar(p_deltas jsonb, p_mov jsonb)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  d            jsonb;
  resultado    jsonb := '[]'::jsonb;
  comps        jsonb := coalesce(p_mov -> 'componentes', '[]'::jsonb);
  comps_reales jsonb;
  viejo        numeric;
  nuevo        numeric;
  cantidad     numeric := coalesce((p_mov ->> 'cantidad')::numeric, 0);
  ajuste_delta numeric := null;
  quien        text := lower(auth.jwt() ->> 'email');
begin
  if not public.st_is_admin() then
    raise exception 'Sin permiso para modificar el stock';
  end if;

  -- Se recorren los deltas ordenados por clave primaria para que dos
  -- operaciones simultáneas tomen los locks en el mismo orden y no se traben.
  for d in
    select value from jsonb_array_elements(coalesce(p_deltas, '[]'::jsonb)) as t(value)
    order by (value ->> 'categoria'), (value ->> 'codigo')
  loop
    -- FOR UPDATE: nadie más toca esta fila hasta que termine la operación.
    select actual into viejo
      from public.st_items
     where categoria = d ->> 'categoria' and codigo = d ->> 'codigo'
       for update;

    if not found then continue; end if;

    if jsonb_exists(d, 'set') then
      nuevo := (d ->> 'set')::numeric;
      ajuste_delta := nuevo - viejo;
    else
      nuevo := viejo + coalesce((d ->> 'delta')::numeric, 0);
    end if;

    update public.st_items
       set actual = nuevo, updated_at = now(), updated_by = quien
     where categoria = d ->> 'categoria' and codigo = d ->> 'codigo';

    resultado := resultado || jsonb_build_object(
      'categoria', d ->> 'categoria',
      'codigo',    d ->> 'codigo',
      'anterior',  viejo,
      'actual',    nuevo
    );
  end loop;

  -- El historial guarda el stock REAL que quedó en cada componente, no el que
  -- había calculado el navegador antes de mandar la operación.
  select coalesce(jsonb_agg(
           case when r.actual is null then t.c
                else t.c || jsonb_build_object('resultante', r.actual, 'faltante', r.actual < 0)
           end
         ), '[]'::jsonb)
    into comps_reales
    from jsonb_array_elements(comps) as t(c)
    left join lateral (
      select (e.value ->> 'actual')::numeric as actual
        from jsonb_array_elements(resultado) as e
       where e.value ->> 'categoria' = t.c ->> 'categoria'
         and e.value ->> 'codigo'    = t.c ->> 'codigo'
       limit 1
    ) r on true;

  -- En un ajuste la cantidad es la diferencia real contra lo que había en la
  -- base, no contra lo que tenía cargado el navegador.
  if p_mov ->> 'tipo' = 'ajuste' and ajuste_delta is not null then
    cantidad := ajuste_delta;
  end if;

  if p_mov is not null and p_mov ->> 'id' is not null then
    insert into public.st_movimientos (id, fecha, tipo, categoria, codigo, nombre, cantidad, nota, componentes, usuario)
    values (
      p_mov ->> 'id',
      coalesce((p_mov ->> 'fecha')::timestamptz, now()),
      p_mov ->> 'tipo',
      p_mov ->> 'categoria',
      p_mov ->> 'codigo',
      coalesce(p_mov ->> 'nombre', ''),
      cantidad,
      p_mov ->> 'nota',
      comps_reales,
      quien
    )
    on conflict (id) do nothing;
  end if;

  return jsonb_build_object(
    'resultantes', resultado,
    'componentes', comps_reales,
    'cantidad',    cantidad,
    'usuario',     quien
  );
end;
$$;

revoke all on function public.st_aplicar(jsonb, jsonb) from public;
grant execute on function public.st_aplicar(jsonb, jsonb) to authenticated;

-- ---------------------------------------------------------------------
-- 7. LOS USUARIOS
--    OJO: esto define los PERMISOS. La cuenta de acceso (email + contraseña)
--    se crea aparte, desde la pantalla "Usuarios" de la app o desde
--    Authentication → Users en el panel de Supabase.
-- ---------------------------------------------------------------------
insert into public.st_users (email, nombre, rol, activo) values
  ('fngc279@gmail.com',                'Franco Guiñazú', 'admin',    true),
  ('mayra.santi@somossetas.com.ar',    'Mayra Santi',    'admin',    true),
  ('matias.aurieme@somossetas.com.ar', 'Matías Aurieme', 'admin',    true),
  ('invitado@somossetas.com.ar',       'Invitado',       'invitado', true)
on conflict (email) do update
  set nombre = excluded.nombre,
      rol    = excluded.rol,
      activo = true;
