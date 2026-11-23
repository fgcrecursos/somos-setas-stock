-- =====================================================================
-- BOT DE STOCK POR TELEGRAM (n8n + Gemini) — 22/11/2026
--
-- Funciones que usa el flujo de n8n `bot/n8n/bot-stock-telegram.json`.
-- El bot NUNCA escribe en las tablas directo: todo pasa por estas funciones,
-- que reusan las mismas reglas de la plataforma (st_aplicar para mover stock,
-- el disparador de pedidos para descontar al pasar a En preparación).
--
-- Cómo trabaja:
--   1. El agente entiende el mensaje y busca los ítems (st_bot_buscar).
--   2. Arma la propuesta con st_bot_preparar → queda PENDIENTE, no toca stock.
--   3. n8n la muestra con dos botones. Recién cuando la persona toca
--      "Confirmar", n8n llama a st_bot_confirmar (no el agente) y se aplica.
--   4. Cualquier movimiento hecho desde la plataforma se puede deshacer con
--      st_bot_preparar(tipo 'revertir'), que también pide confirmación.
--
-- Cada movimiento queda a nombre de la persona que confirmó (su email de
-- st_users), con la nota "[bot]". Para usar el bot hay que ser admin activo
-- en st_users y tener el chat de Telegram dado de alta en st_bot_usuarios.
--
-- Requisitos: haber corrido descuento_en_preparacion_2026-11-16.sql.
-- Se puede correr más de una vez. No modifica stock ni pedidos al correrlo.
-- =====================================================================

do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'st_pedidos' and column_name = 'reservado'
  ) then
    raise exception 'Falta correr antes supabase/descuento_en_preparacion_2026-11-16.sql';
  end if;
end $$;

create schema if not exists extensions;
create extension if not exists pg_trgm with schema extensions;
create extension if not exists unaccent with schema extensions;

-- ---------- 1. Tablas del bot ----------

-- Quién puede hablar con el bot. chat_id = id del chat privado de Telegram.
create table if not exists public.st_bot_usuarios (
  chat_id        bigint primary key,
  email          text not null references public.st_users (email) on update cascade,
  nombre         text not null,
  activo         boolean not null default true,
  resumen_diario boolean not null default true,   -- recibe la pregunta de cada día
  created_at     timestamptz not null default now()
);

-- Propuestas que esperan el botón "Confirmar".
create table if not exists public.st_bot_pendientes (
  token        uuid primary key default gen_random_uuid(),
  chat_id      bigint not null,
  email        text not null,
  acciones     jsonb not null,
  resumen      text not null,
  estado       text not null default 'pendiente',
  mostrado     boolean not null default false,
  resultado    jsonb,
  created_at   timestamptz not null default now(),
  resuelto_at  timestamptz
);
alter table public.st_bot_pendientes drop constraint if exists st_bot_pendientes_estado_check;
alter table public.st_bot_pendientes add constraint st_bot_pendientes_estado_check
  check (estado in ('pendiente', 'confirmado', 'cancelado', 'vencido', 'fallido'));
create index if not exists st_bot_pendientes_chat_idx on public.st_bot_pendientes (chat_id, created_at desc);

-- Movimientos ya deshechos (para no deshacer dos veces).
create table if not exists public.st_bot_reversiones (
  mov_id       text primary key,
  reversion_id text not null,
  token        uuid,
  created_at   timestamptz not null default now()
);

-- Registro de la pregunta diaria y si contestaron.
create table if not exists public.st_bot_checkins (
  fecha          date not null,
  chat_id        bigint not null,
  enviado_at     timestamptz,
  respondido_at  timestamptz,
  sin_novedades  boolean not null default false,
  primary key (fecha, chat_id)
);

-- Nadie entra a estas tablas desde la app: solo las funciones de abajo.
alter table public.st_bot_usuarios    enable row level security;
alter table public.st_bot_pendientes  enable row level security;
alter table public.st_bot_reversiones enable row level security;
alter table public.st_bot_checkins    enable row level security;

-- Los admins del stock pueden ver quién está dado de alta en el bot.
drop policy if exists "st_bot_usuarios lectura admin" on public.st_bot_usuarios;
create policy "st_bot_usuarios lectura admin"
  on public.st_bot_usuarios for select to authenticated
  using (public.st_is_admin());

-- ---------- 2. Ayudantes ----------

-- 20 → "20", 0.25 → "0,25". Para los textos que lee el equipo.
create or replace function public.st_bot_num(x numeric)
returns text language sql immutable as $$
  select replace(rtrim(to_char(coalesce(x, 0), 'FM999999990.999'), '.'), '.', ',')
$$;

-- Día de hoy en Argentina.
create or replace function public.st_bot_hoy()
returns date language sql stable as $$
  select (now() at time zone 'America/Argentina/Buenos_Aires')::date
$$;

-- "Melena de León" → "melena de leon". Para comparar lo que tipean.
create or replace function public.st_bot_norm(t text)
returns text language sql stable set search_path = public, extensions as $$
  select lower(extensions.unaccent(coalesce(t, '')))
$$;

-- "POL- 39" / "pol39" / "ETQ.ENT-9" → "pol39", "etqent9". Igual que compactar() de la app.
create or replace function public.st_bot_compactar(t text)
returns text language sql stable set search_path = public, extensions as $$
  select regexp_replace(lower(extensions.unaccent(coalesce(t, ''))), '[^a-z0-9]', '', 'g')
$$;

-- Productos de tipo gel se cuentan en kilos (aceptan decimales); el resto de
-- los productos va en unidades enteras. Igual que seCuentaEnKilos() de la app.
create or replace function public.st_bot_acepta_decimales(p_categoria text, p_data jsonb)
returns boolean language sql immutable as $$
  select p_categoria <> 'producto' or lower(coalesce(p_data ->> 'tipo', '')) = 'gel'
$$;

-- Lo reservado por pedidos Confirmados, por ítem.
create or replace function public.st_bot_reservados()
returns table (categoria text, codigo text, cantidad numeric)
language sql stable security definer set search_path = public as $$
  select l ->> 'categoria', l ->> 'codigo', sum((l ->> 'cantidad')::numeric)
    from public.st_pedidos p
    join public.ss_orders o on o.id = p.order_id and o.status = 'confirmado'
    cross join lateral jsonb_array_elements(p.reservado) l
   where not p.ignorar
   group by 1, 2
$$;

-- Lo ya descontado por pedidos En preparación (todavía en el depósito, apartado).
create or replace function public.st_bot_por_despachar()
returns table (categoria text, codigo text, cantidad numeric)
language sql stable security definer set search_path = public as $$
  select l ->> 'categoria', l ->> 'codigo', sum((l ->> 'cantidad')::numeric)
    from public.st_pedidos p
    join public.ss_orders o on o.id = p.order_id and o.status = 'preparacion'
    cross join lateral jsonb_array_elements(p.lineas) l
   where p.aplicado and not p.ignorar
   group by 1, 2
$$;

-- Unidad en la que se cuenta un ítem, para que el bot hable en la misma.
create or replace function public.st_bot_unidad(p_categoria text, p_data jsonb)
returns text language sql immutable as $$
  select case
    when p_categoria = 'producto' and lower(coalesce(p_data ->> 'tipo', '')) = 'gel' then 'kg'
    when p_categoria = 'producto' then 'u'
    else coalesce(nullif(p_data ->> 'unidad', ''), 'u')
  end
$$;

-- ¿Este chat puede usar el bot? Devuelve email y nombre, o null.
create or replace function public.st_bot_usuario(p_chat_id bigint)
returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('chat_id', b.chat_id, 'email', b.email, 'nombre', b.nombre)
    from public.st_bot_usuarios b
    join public.st_users u on u.email = b.email and u.activo and u.rol = 'admin'
   where b.chat_id = p_chat_id and b.activo
$$;

-- Lo mismo, para n8n: nunca devuelve null (así el nodo IF no se confunde).
create or replace function public.st_bot_quien(p_chat_id bigint)
returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(public.st_bot_usuario(p_chat_id) || '{"habilitado": true}'::jsonb,
                  jsonb_build_object('habilitado', false, 'chat_id', p_chat_id))
$$;

-- ---------- 3. Consultas (solo lectura) ----------

-- Buscar ítems por nombre o código, aunque esté mal tipeado.
create or replace function public.st_bot_buscar(p_texto text, p_categoria text default null, p_limite int default 8)
returns jsonb
language plpgsql stable security definer set search_path = public, extensions as $$
declare
  q   text := public.st_bot_norm(p_texto);
  pc  text := nullif(trim(coalesce(p_categoria, '')), '');
  qc  text := public.st_bot_compactar(p_texto);
  res jsonb;
begin
  if coalesce(trim(p_texto), '') = '' then
    return '[]'::jsonb;
  end if;

  with r as (select * from public.st_bot_reservados()),
       d as (select * from public.st_bot_por_despachar()),
       base as (
    select i.categoria, i.codigo, i.nombre, i.actual, i.minimo, i.data,
           coalesce(r.cantidad, 0) as reservado,
           coalesce(d.cantidad, 0) as por_despachar,
           greatest(
             extensions.similarity(public.st_bot_norm(i.nombre), q),
             extensions.word_similarity(q, public.st_bot_norm(i.nombre)),
             case when public.st_bot_compactar(i.codigo) = qc then 1.0
                  when length(qc) >= 3 and public.st_bot_compactar(i.codigo) like qc || '%' then 0.8
                  else 0 end,
             -- todas las palabras tipeadas aparecen en el nombre
             case when exists (select 1 from regexp_split_to_table(q, '\s+') w where length(w) > 1)
                   and not exists (
                    select 1 from regexp_split_to_table(q, '\s+') w
                     where length(w) > 1 and position(w in public.st_bot_norm(i.nombre)) = 0
                  ) then 0.7 else 0 end
           ) as parecido
      from public.st_items i
      left join r on r.categoria = i.categoria and r.codigo = i.codigo
      left join d on d.categoria = i.categoria and d.codigo = i.codigo
     where pc is null or i.categoria = pc
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'categoria',     b.categoria,
           'codigo',        b.codigo,
           'nombre',        b.nombre,
           'tipo',          b.data ->> 'tipo',
           'unidad',        public.st_bot_unidad(b.categoria, b.data),
           'en_estante',    b.actual,
           'reservado',     b.reservado,
           'disponible',    b.actual - b.reservado,
           'por_despachar', b.por_despachar,
           'minimo',        b.minimo,
           'parecido',      round(b.parecido::numeric, 2)
         ) order by b.parecido desc, b.nombre), '[]'::jsonb)
    into res
    from (select * from base where parecido >= 0.25 order by parecido desc, nombre limit greatest(1, least(p_limite, 20))) b;

  return res;
end;
$$;

-- Ficha completa de un ítem: stock, receta y últimos movimientos.
create or replace function public.st_bot_item(p_categoria text, p_codigo text)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  it  record;
  res jsonb;
begin
  select * into it from public.st_items where categoria = p_categoria and codigo = p_codigo;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'No existe ' || p_categoria || ' ' || p_codigo);
  end if;

  select jsonb_build_object(
    'ok', true,
    'categoria', it.categoria, 'codigo', it.codigo, 'nombre', it.nombre,
    'tipo', it.data ->> 'tipo',
    'unidad', public.st_bot_unidad(it.categoria, it.data),
    'en_estante', it.actual,
    'reservado', coalesce((select cantidad from public.st_bot_reservados() r where r.categoria = it.categoria and r.codigo = it.codigo), 0),
    'por_despachar', coalesce((select cantidad from public.st_bot_por_despachar() d where d.categoria = it.categoria and d.codigo = it.codigo), 0),
    'minimo', it.minimo,
    'actualizado', it.updated_at,
    'receta', coalesce((
      select jsonb_agg(jsonb_build_object(
               'categoria', b.categoria, 'codigo', b.codigo,
               'nombre', coalesce(c.nombre, '(no está en el inventario)'),
               'por_unidad', b.cantidad,
               'unidad', public.st_bot_unidad(b.categoria, c.data),
               'en_estante', c.actual))
        from (select l ->> 'categoria' as categoria, l ->> 'codigo' as codigo,
                     sum((l ->> 'cantidad')::numeric) as cantidad
                from jsonb_array_elements(coalesce(it.data -> 'bom', '[]'::jsonb)) l
               group by 1, 2) b
        left join public.st_items c on c.categoria = b.categoria and c.codigo = b.codigo
    ), '[]'::jsonb),
    'ultimos_movimientos', coalesce((
      select jsonb_agg(m order by m ->> 'fecha' desc) from (
        select jsonb_build_object(
                 'id', mv.id,
                 'fecha', to_char(mv.fecha at time zone 'America/Argentina/Buenos_Aires', 'DD/MM HH24:MI'),
                 'tipo', mv.tipo, 'cantidad', mv.cantidad, 'usuario', mv.usuario,
                 'origen', mv.origen, 'referencia', mv.referencia,
                 'antes', mv.anterior, 'despues', mv.resultante, 'nota', mv.nota) as m
          from public.st_movimientos mv
         where mv.categoria = it.categoria and mv.codigo = it.codigo
           and mv.tipo not in ('alta', 'edicion', 'baja')
         order by mv.fecha desc limit 8) x
    ), '[]'::jsonb)
  ) into res;
  return res;
end;
$$;

-- Pedidos de la web con lo que descuentan (o van a descontar). Sin DNI, mail ni teléfono.
create or replace function public.st_bot_pedidos(p_estados text[] default array['confirmado', 'preparacion'], p_dias int default 10)
returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'pedido', o.id,
           'estado', o.status,
           'fecha', to_char(to_timestamp(o.ts / 1000.0) at time zone 'America/Argentina/Buenos_Aires', 'DD/MM HH24:MI'),
           'cliente', split_part(trim(coalesce(o.data ->> 'name', '')), ' ', 1),
           'stock', case
                      when p.ignorar then 'ya descontado a mano (no se toca)'
                      when o.status = 'confirmado' then 'reservado: todavía NO se descontó'
                      when p.aplicado then 'ya descontado'
                      else 'sin descontar' end,
           'lineas', case when o.status = 'confirmado' then coalesce(p.reservado, '[]'::jsonb)
                          else coalesce(p.lineas, '[]'::jsonb) end,
           'sin_vincular', coalesce(p.sin_mapear, '[]'::jsonb),
           'nota', p.nota
         ) order by o.ts desc), '[]'::jsonb)
    from public.ss_orders o
    left join public.st_pedidos p on p.order_id = o.id
   where o.status = any (p_estados)
     and (o.ts is null or to_timestamp(o.ts / 1000.0) > now() - make_interval(days => greatest(1, least(p_dias, 60))))
$$;

-- Movimientos recientes, para revisar o elegir cuál deshacer.
create or replace function public.st_bot_movimientos(p_horas int default 48, p_texto text default null, p_usuario text default null)
returns jsonb
language sql stable security definer set search_path = public as $$
  with f as (select nullif(trim(coalesce(p_texto, '')), '') as t, nullif(trim(coalesce(p_usuario, '')), '') as u)
  select coalesce(jsonb_agg(m order by m ->> 'orden' desc), '[]'::jsonb) from (
    select jsonb_build_object(
             'orden', to_char(mv.fecha, 'YYYYMMDDHH24MISS'),
             'id', mv.id,
             'fecha', to_char(mv.fecha at time zone 'America/Argentina/Buenos_Aires', 'DD/MM HH24:MI'),
             'tipo', mv.tipo, 'categoria', mv.categoria, 'codigo', mv.codigo, 'nombre', mv.nombre,
             'cantidad', mv.cantidad, 'antes', mv.anterior, 'despues', mv.resultante,
             'usuario', mv.usuario, 'origen', mv.origen, 'referencia', mv.referencia, 'nota', mv.nota,
             'deshecho', exists (select 1 from public.st_bot_reversiones r where r.mov_id = mv.id),
             'se_puede_deshacer', mv.origen = 'plataforma'
                                  and mv.tipo in ('produccion', 'venta', 'consumo_interno', 'ingreso', 'ajuste')
                                  and not exists (select 1 from public.st_bot_reversiones r where r.mov_id = mv.id or r.reversion_id = mv.id)
           ) as m
      from public.st_movimientos mv
     where mv.fecha > now() - make_interval(hours => greatest(1, least(p_horas, 24 * 30)))
       and mv.tipo not in ('alta', 'edicion', 'baja')
       and ((select t from f) is null or public.st_bot_compactar(mv.codigo) = public.st_bot_compactar((select t from f))
            or public.st_bot_norm(mv.nombre) like '%' || public.st_bot_norm((select t from f)) || '%')
       and ((select u from f) is null or mv.usuario = lower((select u from f)))
     order by mv.fecha desc
     limit 40
  ) x
$$;

-- Lo que pasó hoy, para la pregunta diaria.
create or replace function public.st_bot_resumen_dia(p_fecha date default null)
returns jsonb
language sql stable security definer set search_path = public as $$
  with dia as (select coalesce(p_fecha, public.st_bot_hoy()) as f),
  movs as (
    select mv.* from public.st_movimientos mv, dia
     where (mv.fecha at time zone 'America/Argentina/Buenos_Aires')::date = dia.f
       and mv.tipo in ('produccion', 'venta', 'consumo_interno', 'ingreso', 'ajuste')
  )
  select jsonb_build_object(
    'fecha', to_char((select f from dia), 'DD/MM/YYYY'),
    'producciones_cargadas', (select coalesce(jsonb_agg(jsonb_build_object('nombre', nombre, 'cantidad', cantidad, 'usuario', usuario)), '[]'::jsonb)
                                from movs where tipo = 'produccion' and origen = 'plataforma'),
    'salidas_cargadas', (select coalesce(jsonb_agg(jsonb_build_object('tipo', tipo, 'nombre', nombre, 'cantidad', cantidad, 'usuario', usuario)), '[]'::jsonb)
                           from movs where tipo in ('venta', 'consumo_interno') and origen = 'plataforma'),
    'pedidos_web_descontados_hoy', (select count(distinct referencia) from movs where origen = 'tienda'),
    'pedidos_confirmados_sin_preparar', (select count(*) from public.ss_orders where status = 'confirmado'),
    'pedidos_en_preparacion', (select count(*) from public.ss_orders where status = 'preparacion'),
    'productos_en_negativo', (select coalesce(jsonb_agg(jsonb_build_object('codigo', codigo, 'nombre', nombre, 'en_estante', actual) order by actual), '[]'::jsonb)
                                from public.st_items where categoria = 'producto' and actual < 0),
    'productos_bajo_minimo', (select count(*) from public.st_items where categoria = 'producto' and minimo > 0 and actual < minimo)
  )
$$;

-- A quién mandarle la pregunta diaria (y queda anotado que se le mandó).
create or replace function public.st_bot_destinatarios_resumen()
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  res jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object('chat_id', b.chat_id, 'nombre', b.nombre)), '[]'::jsonb)
    into res
    from public.st_bot_usuarios b
    join public.st_users u on u.email = b.email and u.activo and u.rol = 'admin'
   where b.activo and b.resumen_diario;

  insert into public.st_bot_checkins (fecha, chat_id, enviado_at)
  select public.st_bot_hoy(), (x ->> 'chat_id')::bigint, now()
    from jsonb_array_elements(res) x
  on conflict (fecha, chat_id) do update set enviado_at = excluded.enviado_at;

  return res;
end;
$$;

-- Anota que la persona respondió hoy (con texto o con "Sin novedades").
create or replace function public.st_bot_checkin(p_chat_id bigint, p_sin_novedades boolean default false)
returns jsonb
language sql security definer set search_path = public as $$
  insert into public.st_bot_checkins (fecha, chat_id, respondido_at, sin_novedades)
  values (public.st_bot_hoy(), p_chat_id, now(), p_sin_novedades)
  on conflict (fecha, chat_id) do update
    set respondido_at = coalesce(public.st_bot_checkins.respondido_at, now()),
        sin_novedades = public.st_bot_checkins.sin_novedades or excluded.sin_novedades
  returning jsonb_build_object('ok', true)
$$;

-- ---------- 4. Preparar una propuesta (no toca stock) ----------
--
-- p_acciones: lista de
--   {tipo:'produccion',      codigo, cantidad, nota?}              (solo productos; descuenta la receta)
--   {tipo:'venta',           codigo, cantidad, nota?}              (venta FUERA de la web)
--   {tipo:'consumo_interno', categoria, codigo, cantidad, nota?}
--   {tipo:'ingreso',         categoria, codigo, cantidad, nota?}   (llegó una compra)
--   {tipo:'ajuste',          categoria, codigo, cantidad, nota?}   (conteo físico: el estante tiene `cantidad`)
--   {tipo:'pasar_a_preparacion', pedido}                           (pedido web Confirmado → En preparación)
--   {tipo:'revertir',        movimiento}                           (deshace un movimiento de la plataforma)
create or replace function public.st_bot_preparar(p_chat_id bigint, p_acciones jsonb, p_nota text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  usr      jsonb := public.st_bot_usuario(p_chat_id);
  a        jsonb;
  tipo     text;
  cat      text;
  cod      text;
  cant     numeric;
  it       record;
  ped      record;
  mv       record;
  lineas   text[] := '{}';
  errores  text[] := '{}';
  avisos   text[] := '{}';
  limpias  jsonb := '[]'::jsonb;
  comp     record;
  unidad   text;
  tok      uuid;
  resumen  text;
  vistos   text[] := '{}';
  sim      jsonb := '{}'::jsonb;
  ant      numeric;
  ant_c    numeric;
begin
  if usr is null then
    return jsonb_build_object('ok', false, 'errores', jsonb_build_array('Este chat no está habilitado para cargar stock.'));
  end if;
  if jsonb_typeof(p_acciones) <> 'array' or jsonb_array_length(p_acciones) = 0 then
    return jsonb_build_object('ok', false, 'errores', jsonb_build_array('No hay nada para cargar.'));
  end if;
  if jsonb_array_length(p_acciones) > 25 then
    return jsonb_build_object('ok', false, 'errores', jsonb_build_array('Son demasiados movimientos juntos: mandalos en tandas de hasta 25.'));
  end if;

  for a in select value from jsonb_array_elements(p_acciones) loop
    tipo := lower(coalesce(a ->> 'tipo', ''));

    -- ----- pasar un pedido de la web a En preparación -----
    if tipo = 'pasar_a_preparacion' then
      select o.*, p.reservado into ped
        from public.ss_orders o left join public.st_pedidos p on p.order_id = o.id
       where o.id = a ->> 'pedido';
      if not found then
        errores := errores || format('No encuentro el pedido %s.', a ->> 'pedido');
      elsif ped.status <> 'confirmado' then
        errores := errores || format('El pedido %s está en "%s", no en Confirmado: no hace falta pasarlo.', ped.id, ped.status);
      elsif ped.id = any (vistos) then
        errores := errores || format('El pedido %s está repetido.', ped.id);
      else
        vistos := vistos || ped.id;
        lineas := lineas || format('• Pasar el pedido web %s (%s) a En preparación → la plataforma descuenta: %s',
          ped.id,
          coalesce(nullif(split_part(trim(coalesce(ped.data ->> 'name', '')), ' ', 1), ''), 'sin nombre'),
          coalesce((select string_agg(format('%s × %s', public.st_bot_num((l ->> 'cantidad')::numeric), coalesce(l ->> 'descripcion', l ->> 'codigo')), ', ')
                      from jsonb_array_elements(coalesce(ped.reservado, '[]'::jsonb)) l), 'nada vinculado al stock'));
        limpias := limpias || jsonb_build_object('tipo', tipo, 'pedido', ped.id);
      end if;
      continue;
    end if;

    -- ----- deshacer un movimiento -----
    if tipo = 'revertir' then
      select * into mv from public.st_movimientos where id = a ->> 'movimiento';
      if not found then
        errores := errores || format('No encuentro el movimiento %s.', a ->> 'movimiento');
      elsif mv.origen <> 'plataforma' then
        errores := errores || format('El movimiento %s viene de un pedido de la web: se corrige cambiando el estado del pedido %s en el panel.', mv.id, coalesce(mv.referencia, ''));
      elsif mv.tipo not in ('produccion', 'venta', 'consumo_interno', 'ingreso', 'ajuste') then
        errores := errores || format('El movimiento %s es de tipo "%s" y no se deshace desde el bot.', mv.id, mv.tipo);
      elsif exists (select 1 from public.st_bot_reversiones r where r.mov_id = mv.id) then
        errores := errores || format('El movimiento %s ya fue deshecho.', mv.id);
      elsif exists (select 1 from public.st_bot_reversiones r where r.reversion_id = mv.id) then
        errores := errores || format('El movimiento %s ya es una corrección: si querés volver atrás, cargá el movimiento de nuevo.', mv.id);
      elsif mv.id = any (vistos) then
        errores := errores || format('El movimiento %s está repetido.', mv.id);
      else
        vistos := vistos || mv.id;
        lineas := lineas || format('• Deshacer %s del %s: %s %s de %s (%s)%s',
          case mv.tipo when 'produccion' then 'la producción' when 'venta' then 'la venta'
                       when 'consumo_interno' then 'el consumo interno' when 'ingreso' then 'el ingreso'
                       else 'el ajuste' end,
          to_char(mv.fecha at time zone 'America/Argentina/Buenos_Aires', 'DD/MM HH24:MI'),
          case when mv.tipo in ('venta', 'consumo_interno') then 'vuelven' when mv.tipo = 'ajuste' then 'se corrige en' else 'se quitan' end,
          public.st_bot_num(abs(mv.cantidad)),
          mv.nombre, mv.codigo,
          case when mv.tipo = 'produccion' and jsonb_array_length(mv.componentes) > 0
               then ' y se devuelven los insumos de la receta' else '' end);
        limpias := limpias || jsonb_build_object('tipo', tipo, 'movimiento', mv.id);
      end if;
      continue;
    end if;

    -- ----- movimientos de stock -----
    if tipo not in ('produccion', 'venta', 'consumo_interno', 'ingreso', 'ajuste') then
      errores := errores || format('No sé qué es el movimiento "%s".', a ->> 'tipo');
      continue;
    end if;

    cat := coalesce(nullif(a ->> 'categoria', ''), 'producto');
    cod := a ->> 'codigo';
    if tipo in ('produccion', 'venta') then cat := 'producto'; end if;

    select * into it from public.st_items where categoria = cat and codigo = cod;
    if not found then
      -- Tolerar el código escrito con otros separadores ("pol 39").
      select * into it from public.st_items
       where categoria = cat and public.st_bot_compactar(codigo) = public.st_bot_compactar(cod)
       limit 1;
    end if;
    if not found then
      errores := errores || format('No existe el ítem %s en %s. Buscalo primero.', coalesce(cod, '(sin código)'), cat);
      continue;
    end if;

    begin
      cant := (a ->> 'cantidad')::numeric;
    exception when others then
      cant := null;
    end;
    unidad := public.st_bot_unidad(it.categoria, it.data);

    if cant is null or cant < 0 or (cant = 0 and tipo <> 'ajuste') then
      errores := errores || format('La cantidad de %s tiene que ser un número mayor a cero.', it.nombre);
      continue;
    end if;
    if cant > 100000 then
      errores := errores || format('La cantidad de %s (%s) parece un error de tipeo.', it.nombre, cant);
      continue;
    end if;
    if not public.st_bot_acepta_decimales(it.categoria, it.data) and cant <> trunc(cant) then
      errores := errores || format('%s se cuenta en unidades enteras: %s no es válido.', it.nombre, cant);
      continue;
    end if;

    -- Stock "simulado": si la misma tanda toca dos veces un ítem (p. ej. una
    -- producción que gasta frascos y después el conteo de frascos), la vista
    -- previa muestra lo que va a quedar en el orden en que se aplica.
    ant := coalesce((sim ->> (it.categoria || '|' || it.codigo))::numeric, it.actual);

    if tipo = 'produccion' then
      lineas := lineas || format('• Producción: +%s %s (%s) · estante %s → %s',
        public.st_bot_num(cant), it.nombre, it.codigo,
        public.st_bot_num(ant), public.st_bot_num(ant + cant));
      sim := sim || jsonb_build_object(it.categoria || '|' || it.codigo, ant + cant);
      if jsonb_array_length(coalesce(it.data -> 'bom', '[]'::jsonb)) = 0 then
        avisos := avisos || format('%s no tiene receta: la producción no descuenta insumos.', it.nombre);
      end if;
      for comp in
        select b.categoria, b.codigo, b.cantidad * cant as consumo, c.nombre, c.actual, c.data
          from (select l ->> 'categoria' as categoria, l ->> 'codigo' as codigo,
                       sum((l ->> 'cantidad')::numeric) as cantidad
                  from jsonb_array_elements(coalesce(it.data -> 'bom', '[]'::jsonb)) l
                 group by 1, 2) b
          left join public.st_items c on c.categoria = b.categoria and c.codigo = b.codigo
      loop
        if comp.nombre is null then
          avisos := avisos || format('La receta de %s pide %s, que no está en el inventario: no se descuenta.', it.nombre, comp.codigo);
        else
          ant_c := coalesce((sim ->> (comp.categoria || '|' || comp.codigo))::numeric, comp.actual);
          sim := sim || jsonb_build_object(comp.categoria || '|' || comp.codigo, ant_c - comp.consumo);
          lineas := lineas || format('    descuenta %s%s de %s → queda %s%s',
            public.st_bot_num(comp.consumo),
            case when public.st_bot_unidad(comp.categoria, comp.data) = 'u' then ''
                 else ' ' || public.st_bot_unidad(comp.categoria, comp.data) end,
            comp.nombre, public.st_bot_num(ant_c - comp.consumo),
            case when ant_c - comp.consumo < 0 then ' ⚠️' else '' end);
          if ant_c - comp.consumo < 0 then
            avisos := avisos || format('%s quedaría en negativo (%s): conviene contarlo.', comp.nombre,
              public.st_bot_num(ant_c - comp.consumo));
          end if;
        end if;
      end loop;
    elsif tipo = 'ajuste' then
      lineas := lineas || format('• Conteo físico: %s (%s) · el sistema dice %s, el estante tiene %s (%s%s)',
        it.nombre, it.codigo, public.st_bot_num(ant), public.st_bot_num(cant),
        case when cant - ant >= 0 then '+' else '' end, public.st_bot_num(cant - ant));
      sim := sim || jsonb_build_object(it.categoria || '|' || it.codigo, cant);
      if cant = ant then
        avisos := avisos || format('%s ya tiene %s en el sistema: el conteo no cambia nada.', it.nombre, public.st_bot_num(cant));
      end if;
    else
      lineas := lineas || format('• %s: %s%s%s %s (%s) · estante %s → %s',
        case tipo when 'venta' then 'Venta fuera de la web' when 'consumo_interno' then 'Consumo interno' else 'Llegó compra' end,
        case when tipo = 'ingreso' then '+' else '−' end,
        public.st_bot_num(cant), case when unidad = 'u' then '' else ' ' || unidad end,
        it.nombre, it.codigo, public.st_bot_num(ant),
        public.st_bot_num(case when tipo = 'ingreso' then ant + cant else ant - cant end));
      sim := sim || jsonb_build_object(it.categoria || '|' || it.codigo,
                                       case when tipo = 'ingreso' then ant + cant else ant - cant end);
      if tipo <> 'ingreso' and ant - cant < 0 then
        avisos := avisos || format('%s quedaría en negativo: ¿seguro que salieron %s?', it.nombre, public.st_bot_num(cant));
      end if;
      if tipo = 'ingreso' and it.categoria = 'producto' then
        avisos := avisos || format('Un ingreso de %s no descuenta receta. Si lo fabricaron ustedes, es una producción.', it.nombre);
      end if;
    end if;

    limpias := limpias || jsonb_build_object(
      'tipo', tipo, 'categoria', it.categoria, 'codigo', it.codigo, 'nombre', it.nombre,
      'cantidad', cant, 'nota', nullif(trim(coalesce(a ->> 'nota', p_nota, '')), ''));
  end loop;

  if array_length(errores, 1) > 0 then
    return jsonb_build_object('ok', false, 'errores', to_jsonb(errores), 'avisos', to_jsonb(avisos));
  end if;

  resumen := array_to_string(lineas, E'\n');
  if array_length(avisos, 1) > 0 then
    resumen := resumen || E'\n\n⚠️ ' || array_to_string(avisos, E'\n⚠️ ');
  end if;

  -- Una sola propuesta abierta por chat: la anterior queda vencida.
  update public.st_bot_pendientes
     set estado = 'vencido', resuelto_at = now()
   where chat_id = p_chat_id and estado = 'pendiente';

  insert into public.st_bot_pendientes (chat_id, email, acciones, resumen)
  values (p_chat_id, usr ->> 'email', limpias, resumen)
  returning token into tok;

  return jsonb_build_object(
    'ok', true,
    'token', tok,
    'resumen', resumen,
    'avisos', to_jsonb(avisos),
    'importante', 'Todavía NO se cargó nada. Abajo de tu respuesta aparecen los botones Confirmar / Cancelar.'
  );
end;
$$;

-- ---------- 5. Confirmar (lo llama n8n cuando tocan el botón) ----------
create or replace function public.st_bot_confirmar(p_token uuid, p_chat_id bigint)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  pend      record;
  usr       jsonb := public.st_bot_usuario(p_chat_id);
  a         jsonb;
  it        record;
  mv        record;
  deltas    jsonb;
  comps     jsonb;
  movid     text;
  r         jsonb;
  hechos    text[] := '{}';
  previo    text := coalesce(current_setting('request.jwt.claims', true), '');
  n         int;
begin
  select * into pend from public.st_bot_pendientes where token = p_token for update;
  if not found or pend.chat_id <> p_chat_id then
    return jsonb_build_object('ok', false, 'error', 'No encuentro esa propuesta.');
  end if;
  if pend.estado <> 'pendiente' then
    return jsonb_build_object('ok', false, 'error',
      case pend.estado
        when 'confirmado' then 'Esa propuesta ya estaba confirmada: no la cargo dos veces.'
        when 'cancelado'  then 'Esa propuesta fue cancelada.'
        when 'vencido'    then 'Esa propuesta quedó vieja (hubo otra después). Pedímela de nuevo.'
        else 'Esa propuesta no se pudo cargar antes. Pedímela de nuevo.' end);
  end if;
  if pend.created_at < now() - interval '3 hours' then
    update public.st_bot_pendientes set estado = 'vencido', resuelto_at = now() where token = p_token;
    return jsonb_build_object('ok', false, 'error', 'Pasaron más de 3 horas y el stock pudo cambiar. Pedime la propuesta de nuevo.');
  end if;
  if usr is null or usr ->> 'email' <> pend.email then
    return jsonb_build_object('ok', false, 'error', 'Este chat ya no está habilitado para cargar stock.');
  end if;

  begin
    -- st_aplicar toma el usuario del token: el movimiento queda a nombre de quien confirmó.
    perform set_config('request.jwt.claims',
      jsonb_build_object('email', pend.email, 'role', 'authenticated')::text, true);

    for a in select value from jsonb_array_elements(pend.acciones) loop

      if a ->> 'tipo' = 'pasar_a_preparacion' then
        update public.ss_orders
           set status = 'preparacion',
               data   = jsonb_set(data, '{status}', '"preparacion"')
         where id = a ->> 'pedido' and status = 'confirmado';
        get diagnostics n = row_count;
        if n = 0 then
          raise exception 'El pedido % cambió de estado mientras tanto: no lo toqué.', a ->> 'pedido';
        end if;
        hechos := hechos || format('Pedido %s → En preparación (la plataforma descontó el stock).', a ->> 'pedido');
        continue;
      end if;

      if a ->> 'tipo' = 'revertir' then
        select * into mv from public.st_movimientos where id = a ->> 'movimiento';
        if not found or exists (select 1 from public.st_bot_reversiones x where x.mov_id = mv.id) then
          raise exception 'El movimiento % ya no se puede deshacer.', a ->> 'movimiento';
        end if;
        movid := 'bot-' || gen_random_uuid()::text;
        if mv.tipo = 'produccion' then
          deltas := jsonb_build_array(jsonb_build_object('categoria', mv.categoria, 'codigo', mv.codigo, 'delta', -mv.cantidad));
          select coalesce(jsonb_agg(jsonb_build_object('categoria', c ->> 'categoria', 'codigo', c ->> 'codigo', 'delta', (c ->> 'cantidad')::numeric)), '[]'::jsonb),
                 coalesce(jsonb_agg(jsonb_build_object('categoria', c ->> 'categoria', 'codigo', c ->> 'codigo', 'nombre', c ->> 'nombre', 'cantidad', -(c ->> 'cantidad')::numeric)), '[]'::jsonb)
            into r, comps
            from jsonb_array_elements(mv.componentes) c
           where not coalesce((c ->> 'inexistente')::boolean, false);
          deltas := deltas || r;
        elsif mv.tipo in ('venta', 'consumo_interno') then
          deltas := jsonb_build_array(jsonb_build_object('categoria', mv.categoria, 'codigo', mv.codigo, 'delta', mv.cantidad));
          comps := '[]'::jsonb;
        else -- ingreso y ajuste: cantidad = lo que sumó (o restó) de verdad
          deltas := jsonb_build_array(jsonb_build_object('categoria', mv.categoria, 'codigo', mv.codigo, 'delta', -mv.cantidad));
          comps := '[]'::jsonb;
        end if;
        r := public.st_aplicar(deltas, jsonb_build_object(
          'id', movid, 'tipo', mv.tipo, 'categoria', mv.categoria, 'codigo', mv.codigo,
          'nombre', mv.nombre, 'cantidad', -mv.cantidad, 'componentes', comps,
          'nota', format('[bot] Deshace el movimiento del %s (%s)',
                         to_char(mv.fecha at time zone 'America/Argentina/Buenos_Aires', 'DD/MM HH24:MI'), mv.id),
          'origen', 'plataforma', 'referencia', mv.id));
        insert into public.st_bot_reversiones (mov_id, reversion_id, token) values (mv.id, movid, p_token);
        hechos := hechos || format('Deshecho: %s de %s (%s → %s).', mv.tipo, mv.nombre,
          public.st_bot_num((r ->> 'anterior')::numeric), public.st_bot_num((r ->> 'resultante')::numeric));
        continue;
      end if;

      -- produccion / venta / consumo_interno / ingreso / ajuste
      select * into it from public.st_items where categoria = a ->> 'categoria' and codigo = a ->> 'codigo';
      if not found then
        raise exception 'El ítem % ya no existe en el inventario.', a ->> 'codigo';
      end if;
      movid := 'bot-' || gen_random_uuid()::text;
      comps := '[]'::jsonb;

      if a ->> 'tipo' = 'produccion' then
        deltas := jsonb_build_array(jsonb_build_object('categoria', 'producto', 'codigo', it.codigo, 'delta', (a ->> 'cantidad')::numeric));
        select coalesce(jsonb_agg(jsonb_build_object('categoria', b.categoria, 'codigo', b.codigo, 'delta', -b.cantidad * (a ->> 'cantidad')::numeric)), '[]'::jsonb),
               coalesce(jsonb_agg(jsonb_build_object('categoria', b.categoria, 'codigo', b.codigo,
                                                     'nombre', coalesce(c.nombre, '(no encontrado)'),
                                                     'cantidad', b.cantidad * (a ->> 'cantidad')::numeric)), '[]'::jsonb)
          into r, comps
          from (select l ->> 'categoria' as categoria, l ->> 'codigo' as codigo, sum((l ->> 'cantidad')::numeric) as cantidad
                  from jsonb_array_elements(coalesce(it.data -> 'bom', '[]'::jsonb)) l group by 1, 2) b
          left join public.st_items c on c.categoria = b.categoria and c.codigo = b.codigo;
        deltas := deltas || r;
      elsif a ->> 'tipo' in ('venta', 'consumo_interno') then
        deltas := jsonb_build_array(jsonb_build_object('categoria', it.categoria, 'codigo', it.codigo, 'delta', -(a ->> 'cantidad')::numeric));
      elsif a ->> 'tipo' = 'ingreso' then
        deltas := jsonb_build_array(jsonb_build_object('categoria', it.categoria, 'codigo', it.codigo, 'delta', (a ->> 'cantidad')::numeric));
      else -- ajuste: el conteo manda
        deltas := jsonb_build_array(jsonb_build_object('categoria', it.categoria, 'codigo', it.codigo, 'set', (a ->> 'cantidad')::numeric));
      end if;

      r := public.st_aplicar(deltas, jsonb_build_object(
        'id', movid, 'tipo', a ->> 'tipo', 'categoria', it.categoria, 'codigo', it.codigo,
        'nombre', it.nombre, 'cantidad', (a ->> 'cantidad')::numeric, 'componentes', comps,
        'nota', trim('[bot] ' || coalesce(a ->> 'nota', '')), 'origen', 'plataforma'));

      hechos := hechos || (format('%s: %s (%s) %s → %s',
        case a ->> 'tipo' when 'produccion' then 'Producción' when 'venta' then 'Venta'
                         when 'consumo_interno' then 'Consumo interno' when 'ingreso' then 'Ingreso' else 'Conteo' end,
        it.nombre, it.codigo,
        public.st_bot_num((r ->> 'anterior')::numeric),
        public.st_bot_num((r ->> 'resultante')::numeric))
        || coalesce(' · ' || (r ->> 'incidencia'), ''));
    end loop;

    perform set_config('request.jwt.claims', previo, true);
  exception when others then
    -- Todo o nada: si una línea falla, no queda cargada ninguna.
    perform set_config('request.jwt.claims', previo, true);
    update public.st_bot_pendientes
       set estado = 'fallido', resuelto_at = now(), resultado = jsonb_build_object('error', sqlerrm)
     where token = p_token;
    return jsonb_build_object('ok', false, 'error', 'No se cargó nada: ' || sqlerrm);
  end;

  update public.st_bot_pendientes
     set estado = 'confirmado', resuelto_at = now(), resultado = jsonb_build_object('hechos', to_jsonb(hechos))
   where token = p_token;
  perform public.st_bot_checkin(p_chat_id, false);

  return jsonb_build_object('ok', true, 'hechos', to_jsonb(hechos), 'texto', array_to_string(hechos, E'\n'));
end;
$$;

create or replace function public.st_bot_cancelar(p_token uuid, p_chat_id bigint)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  n int;
begin
  update public.st_bot_pendientes
     set estado = 'cancelado', resuelto_at = now()
   where token = p_token and chat_id = p_chat_id and estado = 'pendiente';
  get diagnostics n = row_count;
  return jsonb_build_object('ok', n > 0);
end;
$$;

-- La propuesta que el agente acaba de armar y todavía no se mostró con botones.
create or replace function public.st_bot_pendiente_para_mostrar(p_chat_id bigint)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  pend record;
begin
  select * into pend from public.st_bot_pendientes
   where chat_id = p_chat_id and estado = 'pendiente' and not mostrado
     and created_at > now() - interval '15 minutes'
   order by created_at desc limit 1
   for update;
  if not found then
    return jsonb_build_object('hay', false);
  end if;
  update public.st_bot_pendientes set mostrado = true where token = pend.token;
  return jsonb_build_object('hay', true, 'token', pend.token, 'resumen', pend.resumen);
end;
$$;

-- ---------- 6. Permisos: solo la clave secreta (n8n) llama a estas funciones ----------
do $$
declare
  f text;
begin
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    raise notice 'No existe el rol service_role (¿no es Supabase?): no se otorgan permisos.';
    return;
  end if;
  foreach f in array array[
    'public.st_bot_reservados()',
    'public.st_bot_por_despachar()',
    'public.st_bot_usuario(bigint)',
    'public.st_bot_quien(bigint)',
    'public.st_bot_buscar(text, text, int)',
    'public.st_bot_item(text, text)',
    'public.st_bot_pedidos(text[], int)',
    'public.st_bot_movimientos(int, text, text)',
    'public.st_bot_resumen_dia(date)',
    'public.st_bot_destinatarios_resumen()',
    'public.st_bot_checkin(bigint, boolean)',
    'public.st_bot_preparar(bigint, jsonb, text)',
    'public.st_bot_confirmar(uuid, bigint)',
    'public.st_bot_cancelar(uuid, bigint)',
    'public.st_bot_pendiente_para_mostrar(bigint)'
  ] loop
    execute format('revoke all on function %s from public', f);
    execute format('revoke all on function %s from anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;

-- ---------- 7. Control ----------
select concat_ws(' | ',
  'funciones del bot: ' || (select count(*) from pg_proc where proname like 'st\_bot\_%'),
  'usuarios del bot: '  || (select count(*) from public.st_bot_usuarios)
) as resultado;
