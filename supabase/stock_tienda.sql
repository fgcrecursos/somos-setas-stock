-- =====================================================================
-- SOMOS SETAS · PUENTE TIENDA ↔ STOCK
-- ---------------------------------------------------------------------
-- Ejecutar UNA vez en el SQL Editor de Supabase (proyecto muuqqbocpumdvhvxsigz),
-- DESPUÉS de stock_schema.sql. Se puede volver a ejecutar sin romper nada.
--
-- Qué resuelve:
--   1. Cuando un pedido de la tienda pasa a CONFIRMADO, el stock se descuenta
--      solo. Si el pedido se anula, el stock vuelve. Si se edita el remito
--      después de confirmarlo, se ajusta la diferencia.
--   2. La web puede preguntar cuántas unidades quedan disponibles de cada
--      presentación, sin exponer el inventario completo.
--   3. Los pedidos de consumo interno (sin precio) descuentan igual, pero se
--      registran como consumo, no como venta.
--   4. El historial de movimientos pasa a registrar TODO: altas, ediciones,
--      bajas y consumo interno, además de ventas, producción, ingresos y ajustes.
--
-- IMPORTANTE: los pedidos que YA estaban confirmados antes de correr esto no se
-- descuentan solos (sería descontar dos veces lo que ya se descontó a mano).
-- Quedan listados en la sección "Pedidos de la tienda" de la plataforma de stock
-- para aplicarlos de a uno o marcarlos como ya descontados.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. MOVIMIENTOS: más tipos y de dónde vino cada uno
--    origen: 'plataforma' (cargado a mano acá) · 'tienda' (pedido web)
--    referencia: el id del pedido, cuando viene de la tienda
-- ---------------------------------------------------------------------
alter table public.st_movimientos add column if not exists origen text not null default 'plataforma';
alter table public.st_movimientos add column if not exists referencia text;

alter table public.st_movimientos drop constraint if exists st_movimientos_tipo_check;
alter table public.st_movimientos add constraint st_movimientos_tipo_check
  check (tipo in (
    'venta',            -- salió vendido
    'produccion',       -- se fabricó (suma producto, descuenta receta)
    'ingreso',          -- entró (compra, reposición)
    'ajuste',           -- conteo físico / corrección
    'consumo_interno',  -- lo usó el equipo, no se vendió
    'alta',             -- se dio de alta un ítem nuevo
    'edicion',          -- se modificó la ficha de un ítem
    'baja'              -- se eliminó un ítem del sistema
  ));

alter table public.st_movimientos drop constraint if exists st_movimientos_origen_check;
alter table public.st_movimientos add constraint st_movimientos_origen_check
  check (origen in ('plataforma', 'tienda'));

create index if not exists st_movimientos_referencia_idx on public.st_movimientos (referencia);


-- ---------------------------------------------------------------------
-- 2. MAPEO SKU DE LA TIENDA → ÍTEM DEL INVENTARIO
--    La tienda vende "melena-de-leon / caps"; el inventario lo llama "CAP-06".
--    `unidades` es cuántas unidades de inventario consume una unidad vendida
--    (normalmente 1; sirve para packs).
--    `revisar` marca los pares donde la presentación de la web y la del
--    inventario no coinciden (ej. la web vende 10 ml y el stock cuenta 30 cc).
-- ---------------------------------------------------------------------
create table if not exists public.st_sku_map (
  producto_id text not null,
  pres_id     text not null,
  categoria   text not null default 'producto',
  codigo      text not null,
  unidades    numeric not null default 1,
  activo      boolean not null default true,
  revisar     boolean not null default false,
  etiqueta    text,
  updated_at  timestamptz not null default now(),
  updated_by  text,
  primary key (producto_id, pres_id)
);

create index if not exists st_sku_map_codigo_idx on public.st_sku_map (categoria, codigo);


-- ---------------------------------------------------------------------
-- 3. PEDIDOS YA PROCESADOS
--    Una fila por pedido de la tienda: qué se descontó y cuándo. Es lo que
--    hace que confirmar dos veces el mismo pedido no descuente dos veces.
--    `lineas` guarda exactamente lo aplicado, para poder revertir o corregir.
-- ---------------------------------------------------------------------
create table if not exists public.st_pedidos (
  order_id    text primary key,
  estado      text,                                   -- estado del pedido en la tienda
  interno     boolean not null default false,         -- consumo interno (sin venta)
  aplicado    boolean not null default false,         -- ¿está descontado del stock ahora?
  ignorar     boolean not null default false,         -- ya se había descontado a mano: no tocar
  lineas      jsonb   not null default '[]'::jsonb,   -- [{codigo, categoria, cantidad, descripcion}]
  sin_mapear  jsonb   not null default '[]'::jsonb,   -- líneas que no se pudieron descontar
  aplicado_at timestamptz,
  nota        text,
  updated_at  timestamptz not null default now()
);

alter table public.st_pedidos add column if not exists ignorar boolean not null default false;

create index if not exists st_pedidos_aplicado_idx on public.st_pedidos (aplicado);


-- ---------------------------------------------------------------------
-- 4. RLS de las tablas nuevas: lee quien esté dado de alta, escribe el admin.
-- ---------------------------------------------------------------------
alter table public.st_sku_map enable row level security;
alter table public.st_pedidos enable row level security;

drop policy if exists "st_sku_map lectura" on public.st_sku_map;
create policy "st_sku_map lectura"
  on public.st_sku_map for select to authenticated using (public.st_can_read());

drop policy if exists "st_sku_map escritura admin" on public.st_sku_map;
create policy "st_sku_map escritura admin"
  on public.st_sku_map for all to authenticated
  using (public.st_is_admin()) with check (public.st_is_admin());

drop policy if exists "st_pedidos lectura" on public.st_pedidos;
create policy "st_pedidos lectura"
  on public.st_pedidos for select to authenticated using (public.st_can_read());

drop policy if exists "st_pedidos escritura admin" on public.st_pedidos;
create policy "st_pedidos escritura admin"
  on public.st_pedidos for all to authenticated
  using (public.st_is_admin()) with check (public.st_is_admin());


-- ---------------------------------------------------------------------
-- 5. st_aplicar — se le agregan origen y referencia, y la corrección de
--    cantidad de los ajustes vale también para las ediciones de ficha.
--    (El resto es idéntico a stock_schema.sql: reemplaza esa versión.)
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

  for d in
    select value from jsonb_array_elements(coalesce(p_deltas, '[]'::jsonb)) as t(value)
    order by (value ->> 'categoria'), (value ->> 'codigo')
  loop
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

  -- En un ajuste (y en una edición de ficha que cambió el stock) la cantidad es
  -- la diferencia real contra lo que había en la base.
  if (p_mov ->> 'tipo') in ('ajuste', 'edicion') and ajuste_delta is not null then
    cantidad := ajuste_delta;
  end if;

  if p_mov is not null and p_mov ->> 'id' is not null then
    insert into public.st_movimientos
      (id, fecha, tipo, categoria, codigo, nombre, cantidad, nota, componentes, usuario, origen, referencia)
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
      quien,
      coalesce(p_mov ->> 'origen', 'plataforma'),
      p_mov ->> 'referencia'
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
-- 6. EL MOTOR: sincronizar un pedido con el stock
--
--    Idea central: el pedido tiene un "objetivo" (cuántas unidades de cada
--    código deberían estar descontadas por él). En st_pedidos guardamos lo que
--    YA descontamos. La diferencia entre ambos es lo único que se toca:
--
--        delta = ya_descontado − objetivo
--
--    · Pedido nuevo confirmado → ya=0, objetivo=N  → delta=−N (descuenta)
--    · Pedido anulado          → objetivo=0        → delta=+N (devuelve)
--    · Remito editado          → ajusta solo la diferencia
--    · Confirmar dos veces     → delta=0, no hace nada
--
--    Nunca lanza excepción hacia afuera: si algo no se puede descontar (un SKU
--    sin mapeo, un producto borrado), lo anota en st_pedidos.sin_mapear y sigue.
--    El pedido de la tienda se guarda igual: el stock nunca bloquea una venta.
-- ---------------------------------------------------------------------
create or replace function public.st_sync_pedido(p_order_id text, p_revertir boolean default false)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  fila         record;
  it           jsonb;
  mapeo        record;
  objetivo     jsonb := '{}'::jsonb;   -- clave "categoria|codigo" → {cantidad, descripcion}
  yatenemos    jsonb := '{}'::jsonb;
  sin_mapear   jsonb := '[]'::jsonb;
  lineas       jsonb := '[]'::jsonb;
  clave        text;
  k            text;
  cant_obj     numeric;
  cant_ya      numeric;
  delta        numeric;
  viejo        numeric;
  es_interno   boolean := false;
  se_ignora    boolean := false;
  tipo_mov     text;
  nota_mov     text;
  qty          numeric;
  descr        text;
  cat          text;
  cod          text;
begin
  select * into fila from public.ss_orders where id = p_order_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'El pedido no existe');
  end if;

  es_interno := coalesce((fila.data ->> 'consumoInterno')::boolean, false);

  -- Lo que este pedido ya tiene descontado (según nuestro registro)
  select coalesce(p.lineas, '[]'::jsonb), coalesce(p.ignorar, false)
    into lineas, se_ignora
    from public.st_pedidos p where p.order_id = p_order_id;

  lineas    := coalesce(lineas, '[]'::jsonb);      -- si el pedido es nuevo para nosotros
  se_ignora := coalesce(se_ignora, false);

  -- Pedido marcado como "ya lo descontamos a mano": no se toca nunca más solo.
  if se_ignora then
    return jsonb_build_object('ok', true, 'aplicado', false, 'ignorado', true);
  end if;

  for it in select value from jsonb_array_elements(coalesce(lineas, '[]'::jsonb)) as t(value) loop
    clave := (it ->> 'categoria') || '|' || (it ->> 'codigo');
    yatenemos := jsonb_set(
      yatenemos, array[clave],
      to_jsonb(coalesce((yatenemos -> clave)::numeric, 0) + coalesce((it ->> 'cantidad')::numeric, 0)),
      true
    );
  end loop;

  -- Objetivo: lo que el pedido debería tener descontado ahora
  if not p_revertir then
    for it in select value from jsonb_array_elements(coalesce(fila.data -> 'items', '[]'::jsonb)) as t(value) loop
      qty := coalesce((it ->> 'qty')::numeric, 0);
      descr := coalesce(nullif(it ->> 'productName', ''), it ->> 'desc', '(sin descripción)');
      if qty <= 0 then continue; end if;

      select m.categoria, m.codigo, m.unidades into mapeo
        from public.st_sku_map m
       where m.producto_id = coalesce(it ->> 'productId', '')
         and m.pres_id     = coalesce(it ->> 'presId', '')
         and m.activo;

      if not found then
        sin_mapear := sin_mapear || jsonb_build_object(
          'producto_id', it ->> 'productId',
          'pres_id',     it ->> 'presId',
          'descripcion', descr,
          'cantidad',    qty,
          'motivo',      case
                           when coalesce(it ->> 'productId', '') = ''
                             then 'Línea cargada a mano, sin producto del catálogo'
                           else 'El SKU no está vinculado a ningún ítem del inventario'
                         end
        );
        continue;
      end if;

      -- ¿existe el ítem en el inventario?
      perform 1 from public.st_items i where i.categoria = mapeo.categoria and i.codigo = mapeo.codigo;
      if not found then
        sin_mapear := sin_mapear || jsonb_build_object(
          'producto_id', it ->> 'productId',
          'pres_id',     it ->> 'presId',
          'descripcion', descr,
          'cantidad',    qty,
          'motivo',      'El ítem ' || mapeo.codigo || ' ya no está en el inventario'
        );
        continue;
      end if;

      clave := mapeo.categoria || '|' || mapeo.codigo;
      objetivo := jsonb_set(
        objetivo, array[clave],
        to_jsonb(coalesce((objetivo -> clave)::numeric, 0) + qty * coalesce(mapeo.unidades, 1)),
        true
      );
    end loop;
  end if;

  -- Aplicar SOLO la diferencia contra lo ya descontado.
  -- Ordenado por clave para tomar los locks en el mismo orden que st_aplicar y
  -- no trabarse con una venta simultánea cargada desde la plataforma.
  for k in
    select key from jsonb_object_keys(objetivo || yatenemos) as t(key) order by key
  loop
    cat := split_part(k, '|', 1);
    cod := split_part(k, '|', 2);
    cant_obj := coalesce((objetivo -> k)::numeric, 0);
    cant_ya  := coalesce((yatenemos -> k)::numeric, 0);
    delta    := cant_ya - cant_obj;          -- lo que hay que SUMAR al stock
    if delta = 0 then continue; end if;

    select actual into viejo
      from public.st_items
     where categoria = cat and codigo = cod
       for update;
    if not found then continue; end if;

    update public.st_items
       set actual = viejo + delta, updated_at = now(), updated_by = 'tienda'
     where categoria = cat and codigo = cod;

    -- Qué clase de movimiento fue
    if cant_ya = 0 then
      tipo_mov := case when es_interno then 'consumo_interno' else 'venta' end;
      nota_mov := 'Pedido ' || p_order_id ||
                  coalesce(' · ' || nullif(fila.data ->> 'name', ''), '') ||
                  case when es_interno then ' · consumo interno' else '' end;
    elsif cant_obj = 0 then
      tipo_mov := 'ajuste';
      nota_mov := 'Pedido ' || p_order_id || ' anulado: vuelven ' || cant_ya || ' al stock';
    else
      tipo_mov := 'ajuste';
      nota_mov := 'Pedido ' || p_order_id || ' editado: pasó de ' || cant_ya || ' a ' || cant_obj;
    end if;

    insert into public.st_movimientos
      (id, fecha, tipo, categoria, codigo, nombre, cantidad, nota, componentes, usuario, origen, referencia)
    values (
      p_order_id || '-' || cod || '-' || floor(extract(epoch from clock_timestamp()) * 1000)::bigint::text,
      now(), tipo_mov, cat, cod,
      coalesce((select i.nombre from public.st_items i where i.categoria = cat and i.codigo = cod), cod),
      case when tipo_mov = 'ajuste' then delta else cant_obj end,
      nota_mov, '[]'::jsonb, 'tienda', 'tienda', p_order_id
    )
    on conflict (id) do nothing;
  end loop;

  -- Dejar registrado qué quedó descontado por este pedido
  lineas := '[]'::jsonb;
  for k in select key from jsonb_object_keys(objetivo) as t(key) loop
    lineas := lineas || jsonb_build_object(
      'categoria', split_part(k, '|', 1),
      'codigo',    split_part(k, '|', 2),
      'cantidad',  (objetivo -> k)::numeric
    );
  end loop;

  insert into public.st_pedidos (order_id, estado, interno, aplicado, lineas, sin_mapear, aplicado_at, nota, updated_at)
  values (
    p_order_id, fila.status, es_interno,
    jsonb_array_length(lineas) > 0,
    lineas, sin_mapear,
    case when jsonb_array_length(lineas) > 0 then now() else null end,
    null, now()
  )
  on conflict (order_id) do update set
    estado      = excluded.estado,
    interno     = excluded.interno,
    aplicado    = excluded.aplicado,
    lineas      = excluded.lineas,
    sin_mapear  = excluded.sin_mapear,
    aplicado_at = coalesce(excluded.aplicado_at, public.st_pedidos.aplicado_at),
    nota        = null,
    updated_at  = now();

  return jsonb_build_object(
    'ok', true,
    'aplicado', jsonb_array_length(lineas) > 0,
    'lineas', lineas,
    'sin_mapear', sin_mapear
  );
end;
$$;

revoke all on function public.st_sync_pedido(text, boolean) from public;


-- Puerta de entrada para la plataforma de stock (botón "Aplicar al stock").
create or replace function public.st_aplicar_pedido(p_order_id text, p_revertir boolean default false)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
begin
  if not public.st_is_admin() then
    raise exception 'Sin permiso para modificar el stock';
  end if;
  return public.st_sync_pedido(p_order_id, p_revertir);
end;
$$;

revoke all on function public.st_aplicar_pedido(text, boolean) from public;
grant execute on function public.st_aplicar_pedido(text, boolean) to authenticated;


-- Marcar un pedido como "ya descontado a mano": no toca el stock y no vuelve a
-- aparecer como pendiente. Con p_ignorar = false se deshace la marca.
create or replace function public.st_ignorar_pedido(
  p_order_id text,
  p_ignorar  boolean default true,
  p_nota     text default null
)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
begin
  if not public.st_is_admin() then
    raise exception 'Sin permiso para modificar el stock';
  end if;
  insert into public.st_pedidos (order_id, estado, aplicado, ignorar, lineas, nota, updated_at)
  values (
    p_order_id,
    (select status from public.ss_orders where id = p_order_id),
    false, p_ignorar, '[]'::jsonb,
    case when p_ignorar then coalesce(p_nota, 'Marcado como ya descontado a mano') else null end,
    now()
  )
  on conflict (order_id) do update set
    ignorar    = p_ignorar,
    nota       = case when p_ignorar then coalesce(p_nota, 'Marcado como ya descontado a mano') else null end,
    updated_at = now();
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.st_ignorar_pedido(text, boolean, text) from public;
grant execute on function public.st_ignorar_pedido(text, boolean, text) to authenticated;


-- ---------------------------------------------------------------------
-- 7. EL DISPARADOR: confirmar un pedido descuenta el stock
--    Sólo actúa de 'confirmado' en adelante. 'nuevo' no descuenta nada:
--    recién cuando alguien lo confirma se considera venta real.
--
--    Si algo falla, se anota y se deja pasar: guardar el pedido nunca puede
--    fallar por un problema de stock.
-- ---------------------------------------------------------------------
create or replace function public.ss_orders_sync_stock()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  if new.status in ('confirmado', 'preparacion', 'enviado', 'entregado') then
    perform public.st_sync_pedido(new.id, false);
  elsif new.status in ('anulado', 'nuevo') then
    -- 'nuevo' sólo revierte si antes se había descontado (volvieron el pedido atrás)
    if exists (select 1 from public.st_pedidos p where p.order_id = new.id and p.aplicado) then
      perform public.st_sync_pedido(new.id, true);
    end if;
  end if;
  return new;
exception when others then
  begin
    insert into public.st_pedidos (order_id, estado, aplicado, nota, updated_at)
    values (new.id, new.status, false, 'No se pudo sincronizar con el stock: ' || sqlerrm, now())
    on conflict (order_id) do update set
      nota = 'No se pudo sincronizar con el stock: ' || sqlerrm,
      updated_at = now();
  exception when others then
    null;  -- ni siquiera el registro del error puede tumbar el guardado del pedido
  end;
  return new;
end;
$$;

drop trigger if exists ss_orders_sync_stock_trg on public.ss_orders;
create trigger ss_orders_sync_stock_trg
  after insert or update on public.ss_orders
  for each row execute function public.ss_orders_sync_stock();


-- ---------------------------------------------------------------------
-- 8. DISPONIBILIDAD PÚBLICA PARA LA WEB
--    Devuelve cuántas unidades quedan de cada presentación que se vende online.
--    Se recorta en 20: la web sólo necesita saber si queda poco, no el
--    inventario real de la empresa.
--
--    OJO: que esta función exista no hace que la web muestre nada. La tienda
--    sólo la usa si está encendido el interruptor del panel
--    (Configuración → Mostrar disponibilidad en la web), que arranca APAGADO
--    justamente porque hoy hay ítems cargados en cero que no están agotados de
--    verdad: se enciende cuando el inventario esté al día.
-- ---------------------------------------------------------------------
create or replace function public.ss_disponibilidad()
returns table (producto_id text, pres_id text, disponible int)
language sql security definer stable
set search_path = public
as $$
  select m.producto_id,
         m.pres_id,
         least(
           greatest(floor(coalesce(i.actual, 0) / coalesce(nullif(m.unidades, 0), 1))::int, 0),
           20
         ) as disponible
    from public.st_sku_map m
    join public.st_items i
      on i.categoria = m.categoria and i.codigo = m.codigo
   where m.activo;
$$;

revoke all on function public.ss_disponibilidad() from public;
grant execute on function public.ss_disponibilidad() to anon, authenticated;


-- ---------------------------------------------------------------------
-- 9. MAPEO INICIAL SKU → INVENTARIO
--    Generado el 11/08/2026 cruzando el catálogo REAL de la tienda (60
--    productos, 125 presentaciones) con el inventario REAL (102 productos).
--    Se inserta sólo si no existe (on conflict do nothing), así las
--    correcciones que se hagan desde la plataforma no se pisan al volver a
--    ejecutar el script.
--
--    Los 10 marcados `revisar` son vínculos donde la web y el inventario no
--    coinciden en el tamaño (la web vende aceite de 10 ml y el inventario
--    cuenta frascos de 30 cc; el "Doy pack" de setas no dice cuántos gramos
--    trae). Descuentan igual, 1 a 1, pero conviene confirmarlos a mano en
--    Pedidos → Vínculo con la tienda.
-- ---------------------------------------------------------------------
insert into public.st_sku_map (producto_id, pres_id, categoria, codigo, unidades, revisar, etiqueta) values
  ('bisglicinato', 'Cáps', 'producto', 'CAP-32', 1, false, 'Bisglicinato — Cápsulas 60u x 500 mg'),
  ('creatina-monohidrato', 'polvo', 'producto', 'POL-37', 1, false, 'Creatina Monohidrato — Envase 150 g'),
  ('creatina-monohidrato', 'polvo-2', 'producto', 'POL-38', 1, false, 'Creatina Monohidrato — Envase 300 g'),
  ('tremella-plus', 'caps', 'producto', 'CAP-13', 1, false, 'Tremella Plus — Cápsulas — 60u x 500 mg'),
  ('flor-de-hibiscus', 'gotas', 'producto', 'EXT-07', 1, false, 'Flor de Hibiscus — Extracto en gotas — 60 ml'),
  ('flor-de-hibiscus', 'caps', 'producto', 'CAP-20', 1, false, 'Flor de Hibiscus — Cápsulas x 500mg x 60 unidades'),
  ('flor-de-hibiscus', 'pol', 'producto', 'POL-16', 1, false, 'Flor de Hibiscus — Polvo x 50g'),
  ('hongo-de-pino-entero', 'enteros', 'producto', 'ENT-03', 1, false, 'Hongo de pino Entero — Hongos Enteros — 100 g'),
  ('girgola-disecadas', 'enteros', 'producto', 'ENT-02', 1, false, 'Hongos Girgolas Disecadas — Hongos disecados — 50 g'),
  ('extracto-cardo-mariano', 'gotas', 'producto', 'EXT-03', 1, false, 'Cardo Mariano — Extracto en gotas — 60 ml'),
  ('extracto-concentrado-amargon', 'gotas', 'producto', 'EXT-02', 1, false, 'Extracto concentrado Amargón — Extracto en gotas — 60 ml'),
  ('extracto-concentrado-amargon-copia-mq63qyw5', 'gotas', 'producto', 'EXT-18', 1, false, 'Extracto concentrado Pasiflora — Extracto en gotas — 60 ml'),
  ('cacao-amargo-reishi', 'polvo', 'producto', 'POL-14', 1, false, 'Cacao amargo + Reishi — Polvo — 125 g'),
  ('cacao-amargo-melena-de-leon', 'Polvo ', 'producto', 'POL-13', 1, false, 'Cacao amargo + Melena de León — Polvo — 125 g'),
  ('melena-de-leon', 'gotas', 'producto', 'EXT-09', 1, false, 'Melena de León — Extracto en gotas — 60 ml'),
  ('melena-de-leon', 'polvo', 'producto', 'POL-04', 1, false, 'Melena de León — Polvo micronizado — 30 gr'),
  ('melena-de-leon', 'caps', 'producto', 'CAP-04', 1, false, 'Melena de León — Cápsulas — 60u × 500 mg'),
  ('melena-de-leon', 'desh', 'producto', 'ENT-05', 1, true, 'Melena de León — Setas enteras deshidratadas — Doy pack'),
  ('cordyceps', 'gotas', 'producto', 'EXT-06', 1, false, 'Cordyceps — Extracto en gotas — 60 ml'),
  ('cordyceps', 'desh', 'producto', 'ENT-01', 1, true, 'Cordyceps — Setas enteras deshidratadas — Doy pack'),
  ('maitake', 'gotas', 'producto', 'EXT-08', 1, false, 'Maitake — Extracto en gotas — 60 ml'),
  ('maitake', 'polvo', 'producto', 'POL-03', 1, false, 'Maitake — Polvo micronizado — 30 gr'),
  ('maitake', 'caps', 'producto', 'CAP-03', 1, false, 'Maitake — Cápsulas — 60u × 500 mg'),
  ('maitake', 'desh', 'producto', 'ENT-04', 1, true, 'Maitake — Setas enteras deshidratadas — Doy pack'),
  ('reishi', 'gotas', 'producto', 'EXT-10', 1, false, 'Reishi — Extracto en gotas — 60 ml'),
  ('reishi', 'polvo', 'producto', 'POL-05', 1, false, 'Reishi — Polvo micronizado — 30 gr'),
  ('reishi', 'caps', 'producto', 'CAP-05', 1, false, 'Reishi — Cápsulas — 60u × 500 mg'),
  ('ashwagandha', 'gotas', 'producto', 'EXT-01', 1, false, 'Ashwagandha — Extracto en gotas — 60 ml'),
  ('ashwagandha', 'polvo', 'producto', 'POL-01', 1, false, 'Ashwagandha — Polvo micronizado — 30 gr'),
  ('ashwagandha', 'caps', 'producto', 'CAP-01', 1, false, 'Ashwagandha — Cápsulas — 60u × 500 mg'),
  ('tremella', 'gotas', 'producto', 'EXT-14', 1, false, 'Tremella — Extracto en gotas — 60 ml'),
  ('tremella', 'polvo', 'producto', 'POL-09', 1, false, 'Tremella — Polvo micronizado — 30 gr'),
  ('tremella', 'caps', 'producto', 'CAP-09', 1, false, 'Tremella — Cápsulas — 60u × 500 mg'),
  ('tremella', 'desh-1kg', 'producto', 'ENT-08', 1, false, 'Tremella — Entera deshidratada — 1 kg'),
  ('shiitake', 'gotas', 'producto', 'EXT-13', 1, false, 'Shiitake — Extracto en gotas — 60 ml'),
  ('shiitake', 'polvo', 'producto', 'POL-08', 1, false, 'Shiitake — Polvo micronizado — 30 gr'),
  ('shiitake', 'caps', 'producto', 'CAP-08', 1, false, 'Shiitake — Cápsulas — 60u × 500 mg'),
  ('shiitake', 'desh', 'producto', 'ENT-06', 1, true, 'Shiitake — Setas enteras y laminadas deshidratadas — Doy pack'),
  ('shiitake', 'laminado-50g', 'producto', 'ENT-06', 1, false, 'Shiitake — Laminado deshidratado — 50 g'),
  ('cola-de-pavo', 'gotas', 'producto', 'EXT-05', 1, false, 'Cola de Pavo — Extracto en gotas — 60 ml'),
  ('rhodiola-rosea', 'gotas', 'producto', 'EXT-11', 1, false, 'Rhodiola Rosea — Extracto en gotas — 60 ml'),
  ('rhodiola-rosea', 'polvo', 'producto', 'POL-06', 1, false, 'Rhodiola Rosea — Polvo micronizado — 30 gr'),
  ('rhodiola-rosea', 'caps', 'producto', 'CAP-06', 1, false, 'Rhodiola Rosea — Cápsulas — 60u × 500 mg'),
  ('schisandra', 'gotas', 'producto', 'EXT-12', 1, false, 'Schisandra — Extracto en gotas — 60 ml'),
  ('schisandra', 'polvo', 'producto', 'POL-07', 1, false, 'Schisandra — Polvo micronizado — 30 gr'),
  ('schisandra', 'caps', 'producto', 'CAP-07', 1, false, 'Schisandra — Cápsulas — 60u × 500 mg'),
  ('chaga', 'gotas', 'producto', 'EXT-04', 1, false, 'Chaga — Extracto en gotas — 60 ml'),
  ('chaga', 'polvo', 'producto', 'POL-02', 1, false, 'Chaga — Polvo micronizado — 30 gr'),
  ('chaga', 'caps', 'producto', 'CAP-02', 1, false, 'Chaga — Cápsulas — 60u × 500 mg'),
  ('melena-reishi', 'gotas', 'producto', 'EXT-15', 1, false, 'Melena de León + Reishi — Extracto en gotas — 60 ml'),
  ('melena-reishi', 'polvo', 'producto', 'POL-10', 1, false, 'Melena de León + Reishi — Polvo micronizado — 30 gr'),
  ('melena-reishi', 'caps', 'producto', 'CAP-10', 1, false, 'Melena de León + Reishi — Cápsulas — 60u × 500 mg'),
  ('melena-ashwagandha', 'gotas', 'producto', 'EXT-17', 1, false, 'Melena de León + Ashwagandha — Extracto en gotas — 60 ml'),
  ('melena-ashwagandha', 'polvo', 'producto', 'POL-11', 1, false, 'Melena de León + Ashwagandha — Polvo micronizado — 30 gr'),
  ('melena-ashwagandha', 'caps', 'producto', 'CAP-12', 1, false, 'Melena de León + Ashwagandha — Cápsulas — 60u × 500 mg'),
  ('melena-cordyceps', 'gotas', 'producto', 'EXT-16', 1, false, 'Melena de León + Cordyceps — Extracto en gotas — 60 ml'),
  ('melena-cordyceps', 'polvo', 'producto', 'POL-12', 1, false, 'Melena de León + Cordyceps — Polvo micronizado — 30 gr'),
  ('melena-cordyceps', 'caps', 'producto', 'CAP-11', 1, false, 'Melena de León + Cordyceps — Cápsulas — 60u × 500 mg'),
  ('aceite-menta', '10ml', 'producto', 'ACE-06', 1, true, 'Aceite de Menta — Frasco gotero — 10 ml'),
  ('aceite-lavanda', '10ml', 'producto', 'ACE-05', 1, true, 'Aceite de Lavanda — Frasco gotero — 10 ml'),
  ('aceite-oregano', '10ml', 'producto', 'ACE-07', 1, true, 'Aceite de Orégano — Frasco gotero — 10 ml'),
  ('aceite-curcuma', '10ml', 'producto', 'ACE-03', 1, true, 'Aceite de Cúrcuma + Pimienta Negra — Frasco gotero — 10 ml'),
  ('aceite-hibiscus', '10ml', 'producto', 'ACE-04', 1, true, 'Aceite de Hibiscus — Jamaica — Frasco gotero — 10 ml'),
  ('aceite-clavo', '10ml', 'producto', 'ACE-02', 1, true, 'Aceite de Clavo de Olor — Frasco gotero — 10 ml'),
  ('caps-ajo-vitc', '60', 'producto', 'CAP-14', 1, false, 'Ajo + Vitamina C — 60 cápsulas × 500 mg'),
  ('caps-curcuma', '60', 'producto', 'CAP-16', 1, false, 'Cúrcuma + Pimienta Negra — 60 cápsulas × 500 mg'),
  ('caps-curcuma-copia-mrjd6c1y', '60', 'producto', 'CAP-15', 1, false, 'Cúrcuma + Jengibre + Pimienta Negra — 60 cápsulas × 500 mg'),
  ('caps-colageno-plus', '60', 'producto', 'CAP-17', 1, false, 'Colágeno Plus — 60 cápsulas × 500 mg'),
  ('caps-colageno-hidrolizado', '60', 'producto', 'CAP-18', 1, false, 'Colágeno Hidrolizado — 60 cápsulas × 500 mg'),
  ('caps-vitc', '60', 'producto', 'CAP-19', 1, false, 'Vitamina C — 60 cápsulas × 500 mg'),
  ('caps-hibiscus', '60', 'producto', 'CAP-20', 1, false, 'Hibiscus — 60 cápsulas × 500 mg'),
  ('caps-cardo-mariano', '60', 'producto', 'CAP-21', 1, false, 'Cardo Mariano — 60 cápsulas × 500 mg'),
  ('caps-cartilago-tiburon', '60', 'producto', 'CAP-22', 1, false, 'Cartílago de Tiburón — 60 cápsulas × 500 mg'),
  ('caps-triple-mag', '60', 'producto', 'CAP-23', 1, false, 'Triple Magnesio — 60 cápsulas × 500 mg'),
  ('caps-mag-potasio', '60', 'producto', 'CAP-24', 1, false, 'Magnesio + Potasio — 60 cápsulas × 500 mg'),
  ('caps-citrato-potasio', '60', 'producto', 'CAP-25', 1, false, 'Citrato de Potasio — 60 cápsulas × 500 mg'),
  ('caps-citrato-mag', '60', 'producto', 'CAP-26', 1, false, 'Citrato de Magnesio — 60 cápsulas × 500 mg'),
  ('caps-glicinato-mag', '60', 'producto', 'CAP-27', 1, false, 'Glicinato de Magnesio — 60 cápsulas × 500 mg'),
  ('caps-malato-mag', '60', 'producto', 'CAP-29', 1, false, 'Malato de Magnesio — 60 cápsulas × 500 mg'),
  ('polvo-vitc', '50g', 'producto', 'POL-15', 1, false, 'Vitamina C — Polvo — Envase 50 g'),
  ('polvo-malato-mag', '50g', 'producto', 'POL-20', 1, false, 'Malato de Magnesio — Polvo — Envase 50 g'),
  ('polvo-malato-mag', '100g', 'producto', 'POL-26', 1, false, 'Malato de Magnesio — Polvo — Envase 100 g'),
  ('polvo-malato-mag', '500g', 'producto', 'POL-32', 1, false, 'Malato de Magnesio — Polvo — Envase 500 g'),
  ('polvo-malato-mag', '1kg', 'producto', 'POL-36', 1, false, 'Malato de Magnesio — Polvo — Envase 1 kg'),
  ('polvo-citrato-potasio', '50g', 'producto', 'POL-17', 1, false, 'Citrato de Potasio — Polvo — Envase 50 g'),
  ('polvo-citrato-potasio', '100g', 'producto', 'POL-23', 1, false, 'Citrato de Potasio — Polvo — Envase 100 g'),
  ('polvo-citrato-potasio', '500g', 'producto', 'POL-30', 1, false, 'Citrato de Potasio — Polvo — Envase 500 g'),
  ('polvo-citrato-potasio', '1kg', 'producto', 'POL-34', 1, false, 'Citrato de Potasio — Polvo — Envase 1 kg'),
  ('polvo-citrato-mag', '50g', 'producto', 'POL-18', 1, false, 'Citrato de Magnesio — Polvo — Envase 50 g'),
  ('polvo-citrato-mag', '100g', 'producto', 'POL-24', 1, false, 'Citrato de Magnesio — Polvo — Envase 100 g'),
  ('polvo-citrato-mag', '500g', 'producto', 'POL-29', 1, false, 'Citrato de Magnesio — Polvo — Envase 500 g'),
  ('polvo-citrato-mag', '1kg', 'producto', 'POL-33', 1, false, 'Citrato de Magnesio — Polvo — Envase 1 kg'),
  ('polvo-glicinato-mag', '50g', 'producto', 'POL-19', 1, false, 'Glicinato de Magnesio — Polvo — Envase 50 g'),
  ('polvo-glicinato-mag', '100g', 'producto', 'POL-25', 1, false, 'Glicinato de Magnesio — Polvo — Envase 100 g'),
  ('polvo-glicinato-mag', '500g', 'producto', 'POL-31', 1, false, 'Glicinato de Magnesio — Polvo — Envase 500 g'),
  ('polvo-glicinato-mag', '1kg', 'producto', 'POL-35', 1, false, 'Glicinato de Magnesio — Polvo — Envase 1 kg'),
  ('polvo-citrato-mag-potasio', '50g', 'producto', 'POL-21', 1, false, 'Citrato de Magnesio + Potasio — Polvo — Envase 50 g'),
  ('polvo-citrato-mag-potasio', '100g', 'producto', 'POL-27', 1, false, 'Citrato de Magnesio + Potasio — Polvo — Envase 100 g'),
  ('polvo-triple-mag', '50g', 'producto', 'POL-22', 1, false, 'Triple Magnesio — Polvo — Envase 50 g'),
  ('polvo-triple-mag', '100g', 'producto', 'POL-28', 1, false, 'Triple Magnesio — Polvo — Envase 100 g'),
  ('caps-espirulina', '60', 'producto', 'CAP-31', 1, false, 'Espirulina — 60 cápsulas × 500 mg'),
  ('caps-maca', '60', 'producto', 'CAP-30', 1, false, 'Maca — 60 cápsulas × 500 mg'),
  ('caps-zeolita', '60', 'producto', 'CAP-28', 1, false, 'Zeolita — 60 cápsulas × 500 mg')
on conflict (producto_id, pres_id) do nothing;

-- Quedan SIN vincular a propósito 22 presentaciones que la web vende y el
-- inventario no tiene (o no tiene en ese tamaño): el gel de Tremella, el aceite
-- de Cannabis, el Palo Negro Chileno, la remolacha y el bicarbonato en polvo,
-- Cola de Pavo en polvo y en cápsulas, y los formatos de 500 g / 1 kg de varios
-- productos. Esas ventas NO descuentan stock y aparecen listadas en
-- Pedidos → "Líneas que no descontaron stock", para vincularlas a mano cuando
-- el ítem exista en el inventario.
