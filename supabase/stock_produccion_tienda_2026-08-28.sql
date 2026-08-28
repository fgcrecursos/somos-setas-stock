-- =====================================================================
-- SOMOS SETAS · STOCK — Producción a prueba de fallos + resultante en Movimientos
-- ---------------------------------------------------------------------
-- Correr UNA vez en el SQL Editor de Supabase (proyecto muuqqbocpumdvhvxsigz),
-- DESPUÉS de stock_schema.sql y stock_tienda.sql. Es idempotente: se puede
-- volver a correr sin romper nada.
--
-- QUÉ RESUELVE
--   1. Producción: si una línea de la receta apunta a un código que ya no está
--      en el inventario (mal escrito, ítem borrado o renombrado), antes el
--      descuento se salteaba EN SILENCIO. Ahora la producción NO se bloquea
--      (nunca falla), pero el movimiento queda con una `incidencia` cargada y
--      la app muestra un cartel de precaución. El resto de la receta sí se
--      descuenta.
--   2. Movimientos: cada movimiento guarda el stock del ítem principal ANTES y
--      DESPUÉS (`anterior` / `resultante`), y los pedidos de la tienda pasan a
--      guardar el detalle línea por línea. Así se puede seguir cuántas unidades
--      entran y cuántas salen y en qué nivel quedó cada ítem.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1. COLUMNAS NUEVAS EN st_movimientos (nullables: no tocan las filas viejas)
-- ---------------------------------------------------------------------
alter table public.st_movimientos add column if not exists anterior   numeric;
alter table public.st_movimientos add column if not exists resultante numeric;
alter table public.st_movimientos add column if not exists incidencia text;


-- ---------------------------------------------------------------------
-- 2. st_aplicar — igual que en stock_tienda.sql, más:
--    · junta los deltas que no se pudieron aplicar (`omitidos`)
--    · si es una producción con componentes omitidos, deja `incidencia`
--    · guarda anterior/resultante del ítem principal en el movimiento
--    NUNCA lanza excepción ni bloquea: si algo no se puede descontar, se anota.
-- ---------------------------------------------------------------------
create or replace function public.st_aplicar(p_deltas jsonb, p_mov jsonb)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  d            jsonb;
  resultado    jsonb := '[]'::jsonb;
  omitidos     jsonb := '[]'::jsonb;
  comps        jsonb := coalesce(p_mov -> 'componentes', '[]'::jsonb);
  comps_reales jsonb;
  viejo        numeric;
  nuevo        numeric;
  cantidad     numeric := coalesce((p_mov ->> 'cantidad')::numeric, 0);
  ajuste_delta numeric := null;
  quien        text := lower(auth.jwt() ->> 'email');
  incidencia   text := null;
  faltantes    text;
  ppal_ant     numeric := null;
  ppal_res     numeric := null;
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

    -- La fila no existe: se anota como omitida y se sigue. El descuento no se
    -- pierde en silencio, queda registrado para que la app avise.
    if not found then
      omitidos := omitidos || jsonb_build_object(
        'categoria', d ->> 'categoria',
        'codigo',    d ->> 'codigo'
      );
      continue;
    end if;

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

  -- El historial guarda el stock REAL que quedó en cada componente. Los que no
  -- aparecen en `resultado` (no se pudieron descontar) se marcan `inexistente`.
  select coalesce(jsonb_agg(
           case when r.actual is null
                then t.c || jsonb_build_object('inexistente', true, 'faltante', true)
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

  -- Producción con componentes de receta que no se pudieron descontar: se deja
  -- una incidencia visible en el movimiento (la app la muestra como cartel).
  if (p_mov ->> 'tipo') = 'produccion' and jsonb_array_length(omitidos) > 0 then
    select string_agg(value ->> 'codigo', ', ')
      into faltantes
      from jsonb_array_elements(omitidos) as t(value);
    incidencia := 'No se descontó de la receta: ' || faltantes ||
                  ' (no está en el inventario). Corregí la receta en Productos.';
  end if;

  -- Stock del ítem principal, antes y después (para el tracking en Movimientos).
  select (e.value ->> 'anterior')::numeric, (e.value ->> 'actual')::numeric
    into ppal_ant, ppal_res
    from jsonb_array_elements(resultado) as e
   where e.value ->> 'categoria' = p_mov ->> 'categoria'
     and e.value ->> 'codigo'    = p_mov ->> 'codigo'
   limit 1;

  -- En un ajuste (y en una edición de ficha que cambió el stock) la cantidad es
  -- la diferencia real contra lo que había en la base.
  if (p_mov ->> 'tipo') in ('ajuste', 'edicion') and ajuste_delta is not null then
    cantidad := ajuste_delta;
  end if;

  if p_mov is not null and p_mov ->> 'id' is not null then
    insert into public.st_movimientos
      (id, fecha, tipo, categoria, codigo, nombre, cantidad, nota, componentes,
       usuario, origen, referencia, anterior, resultante, incidencia)
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
      p_mov ->> 'referencia',
      ppal_ant,
      ppal_res,
      incidencia
    )
    on conflict (id) do nothing;
  end if;

  return jsonb_build_object(
    'resultantes', resultado,
    'componentes', comps_reales,
    'omitidos',    omitidos,
    'incidencia',  incidencia,
    'anterior',    ppal_ant,
    'resultante',  ppal_res,
    'cantidad',    cantidad,
    'usuario',     quien
  );
end;
$$;

revoke all on function public.st_aplicar(jsonb, jsonb) from public;
grant execute on function public.st_aplicar(jsonb, jsonb) to authenticated;


-- ---------------------------------------------------------------------
-- 3. st_sync_pedido — igual que en stock_tienda.sql, más:
--    cada movimiento de pedido guarda anterior/resultante y un componente con
--    el detalle línea por línea, para verlo en Movimientos.
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
  objetivo     jsonb := '{}'::jsonb;   -- clave "categoria|codigo" → cantidad objetivo
  yatenemos    jsonb := '{}'::jsonb;
  sin_mapear   jsonb := '[]'::jsonb;
  lineas       jsonb := '[]'::jsonb;
  clave        text;
  k            text;
  cant_obj     numeric;
  cant_ya      numeric;
  delta        numeric;
  viejo        numeric;
  nombre_it    text;
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

  select coalesce(p.lineas, '[]'::jsonb), coalesce(p.ignorar, false)
    into lineas, se_ignora
    from public.st_pedidos p where p.order_id = p_order_id;

  lineas    := coalesce(lineas, '[]'::jsonb);
  se_ignora := coalesce(se_ignora, false);

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

    nombre_it := coalesce(
      (select i.nombre from public.st_items i where i.categoria = cat and i.codigo = cod), cod
    );

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
      (id, fecha, tipo, categoria, codigo, nombre, cantidad, nota, componentes,
       usuario, origen, referencia, anterior, resultante, incidencia)
    values (
      p_order_id || '-' || cod || '-' || floor(extract(epoch from clock_timestamp()) * 1000)::bigint::text,
      now(), tipo_mov, cat, cod,
      nombre_it,
      cant_obj - cant_ya,   -- lo que salió (+) o volvió (−) con este cambio
      nota_mov,
      jsonb_build_array(jsonb_build_object(
        'categoria',  cat,
        'codigo',     cod,
        'nombre',     nombre_it,
        'cantidad',   abs(cant_obj - cant_ya),
        'anterior',   viejo,
        'resultante', viejo + delta,
        'faltante',   (viejo + delta) < 0
      )),
      'tienda', 'tienda', p_order_id,
      viejo,
      viejo + delta,
      null
    )
    on conflict (id) do nothing;
  end loop;

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

commit;
