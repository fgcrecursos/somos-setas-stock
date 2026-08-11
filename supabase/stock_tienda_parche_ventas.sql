-- =====================================================================
-- SOMOS SETAS · PARCHE — anular un pedido descuenta la venta
-- ---------------------------------------------------------------------
-- Ejecutar UNA vez en el SQL Editor de Supabase. Reemplaza una sola función;
-- no toca tablas, ni datos, ni los vínculos SKU que hayas corregido a mano.
--
-- QUÉ ARREGLA
-- Antes, al anular un pedido el stock volvía bien, pero las unidades seguían
-- contadas como vendidas en "Ventas y producción": la devolución se registraba
-- como 'ajuste' y el ranking sólo suma los movimientos de tipo 'venta'.
--
-- Ahora la corrección conserva el tipo original (venta o consumo interno) con
-- la cantidad firmada: +2 cuando salió, −3 cuando volvió. Se cancelan solas en
-- las estadísticas y en el stock, sin tocar el historial.
--
-- Este mismo cambio ya está incluido en stock_tienda.sql, así que si más
-- adelante volvés a correr ese archivo completo, queda igual.
-- =====================================================================

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

    -- El movimiento SIEMPRE es del mismo tipo que la operación original (venta
    -- o consumo interno), con la cantidad firmada: positiva cuando salió y
    -- NEGATIVA cuando volvió. Así, al anular un pedido, las unidades dejan de
    -- contarse como vendidas —que es lo correcto: esa venta no existió— sin
    -- necesidad de tocar el historial. Registrarlo como 'ajuste' dejaba la
    -- venta contada para siempre.
    tipo_mov := case when es_interno then 'consumo_interno' else 'venta' end;
    if cant_ya = 0 then
      nota_mov := 'Pedido ' || p_order_id ||
                  coalesce(' · ' || nullif(fila.data ->> 'name', ''), '') ||
                  case when es_interno then ' · consumo interno' else '' end;
    elsif cant_obj = 0 then
      nota_mov := 'Pedido ' || p_order_id || ' anulado: vuelven ' || cant_ya || ' al stock';
    else
      nota_mov := 'Pedido ' || p_order_id || ' editado: pasó de ' || cant_ya || ' a ' || cant_obj;
    end if;

    insert into public.st_movimientos
      (id, fecha, tipo, categoria, codigo, nombre, cantidad, nota, componentes, usuario, origen, referencia)
    values (
      p_order_id || '-' || cod || '-' || floor(extract(epoch from clock_timestamp()) * 1000)::bigint::text,
      now(), tipo_mov, cat, cod,
      coalesce((select i.nombre from public.st_items i where i.categoria = cat and i.codigo = cod), cod),
      cant_obj - cant_ya,   -- lo que salió (+) o volvió (−) con este cambio
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
