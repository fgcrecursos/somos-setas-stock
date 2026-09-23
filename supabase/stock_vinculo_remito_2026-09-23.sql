-- =====================================================================
-- SOMOS SETAS · VENTAS DEL PANEL QUE NO DESCONTABAN STOCK
-- ---------------------------------------------------------------------
-- Ejecutar UNA vez en el SQL Editor de Supabase (proyecto muuqqbocpumdvhvxsigz),
-- DESPUÉS de stock_remito_receta_2026-09-18.sql. Se puede volver a ejecutar.
--
-- Qué pasaba (auditado contra la base el 2026-09-23):
--   El stock sabe qué descontar de una línea de pedido solo por su
--   productId/presId. El remito del panel de administración los perdía:
--     · Al generar el remito de un pedido WEB, las líneas se armaban sin
--       productId. Guardar el remito reescribía el pedido y el disparador
--       DEVOLVÍA lo que se había descontado al confirmarlo (85 de 86 líneas
--       web desde el 11/08 quedaron así).
--     · En un remito manual, tocar la descripción de una línea elegida del
--       catálogo (sumarle " (SIN ETIQUETA)", " (ZIPLOC)"…) la desvinculaba en
--       silencio. Unas 270 líneas desde el 11/08.
--   Los IDs de la tienda y del stock están bien vinculados (st_sku_map): lo
--   que se cortaba era el camino del remito al pedido.
--   El panel ya está corregido (admin.jsx). Este script cubre la base:
--
--   1. st_sync_pedido reconoce una línea sin productId cuya descripción es
--      EXACTAMENTE "Producto — Presentación" del catálogo (sin tildes ni
--      mayúsculas). Mismo criterio que el panel al reabrir un remito viejo.
--   2. Vuelve a guardar el antes/después en cada movimiento de la tienda
--      (la versión del 18/09 lo había perdido: desde el 19/09 los movimientos
--      de pedidos quedan sin "antes → después").
--   3. Repara los pedidos YA confirmados SIN MOVER STOCK: deja registrado que
--      esas líneas corresponden a tal ítem, como si ya estuvieran descontadas.
--      Motivo: el equipo corrigió los conteos a mano muchas veces desde agosto
--      (196 correcciones de stock en fichas de productos), así que descontar
--      ahora esas ventas viejas restaría dos veces lo que ya se ajustó.
--      Sin esto, reabrir y guardar un remito viejo descontaría de golpe una
--      venta de hace semanas.
--      El resultado final lista cuántas unidades quedaron "absorbidas" por
--      ítem: son las que conviene mirar en el próximo conteo físico.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1. Normalización de descripciones (igual que normLinea() del panel)
-- ---------------------------------------------------------------------
create or replace function public.st_norm_linea(p text)
returns text
language sql immutable
as $$
  select btrim(regexp_replace(
    translate(lower(coalesce(p, '')),
              'áéíóúüñàèìòùâêîôûäëïö',
              'aeiouunaeiouaeiouaeio'),
    '\s+', ' ', 'g'))
$$;


-- ---------------------------------------------------------------------
-- 2. st_sync_pedido — reemplaza la versión de stock_remito_receta_2026-09-18.sql
--    Cambios: vínculo por descripción exacta, antes/después en los
--    movimientos, y modo "sin mover stock" (st.sin_mover) para la reparación.
-- ---------------------------------------------------------------------
create or replace function public.st_sync_pedido(p_order_id text, p_revertir boolean default false)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  fila         record;
  it           jsonb;
  comp         jsonb;
  comps        jsonb;
  objetivo     jsonb := '{}'::jsonb;   -- clave "categoria|codigo" → cantidad
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
  sin_mover    boolean := coalesce(current_setting('st.sin_mover', true), '') = 'on';
  tipo_mov     text;
  nota_mov     text;
  nombre_it    text;
  qty          numeric;
  descr        text;
  cat          text;
  cod          text;
  v_pid        text;    -- productId de la línea (o el deducido por descripción)
  v_prid       text;    -- presId de la línea (o el deducido por descripción)
  v_cat        text;    -- categoría resuelta de un componente
  v_cod        text;    -- código resuelto de un componente
  v_cant_comp  numeric; -- cantidad del componente por unidad vendida
  hubo_link    boolean; -- ¿algún componente de la receta ad-hoc se pudo aplicar?
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

      comps := coalesce(it -> 'stockComponentes', '[]'::jsonb);
      -- Compatibilidad con el vínculo simple anterior (un solo ítem, sin array).
      if jsonb_array_length(comps) = 0
         and coalesce(it ->> 'stockCategoria', '') <> ''
         and coalesce(it ->> 'stockCodigo', '') <> '' then
        comps := jsonb_build_array(jsonb_build_object(
          'categoria', it ->> 'stockCategoria', 'codigo', it ->> 'stockCodigo', 'cantidad', 1
        ));
      end if;

      if jsonb_array_length(comps) > 0 then
        -- Línea con receta ad-hoc: uno o más ítems del inventario, cada uno
        -- con su cantidad por unidad vendida. Se salta st_sku_map: ya dice
        -- exactamente qué descontar.
        hubo_link := false;
        for comp in select value from jsonb_array_elements(comps) as t(value) loop
          v_cat := comp ->> 'categoria';
          v_cod := comp ->> 'codigo';
          v_cant_comp := coalesce((comp ->> 'cantidad')::numeric, 0);
          if coalesce(v_cat, '') = '' or coalesce(v_cod, '') = '' or v_cant_comp = 0 then continue; end if;

          perform 1 from public.st_items i where i.categoria = v_cat and i.codigo = v_cod;
          if not found then
            sin_mapear := sin_mapear || jsonb_build_object(
              'producto_id', it ->> 'productId',
              'pres_id',     it ->> 'presId',
              'descripcion', descr,
              'cantidad',    qty,
              'motivo',      'El ítem ' || v_cod || ' (de la receta ad-hoc) ya no está en el inventario'
            );
            continue;
          end if;

          hubo_link := true;
          clave := v_cat || '|' || v_cod;
          objetivo := jsonb_set(
            objetivo, array[clave],
            to_jsonb(coalesce((objetivo -> clave)::numeric, 0) + qty * v_cant_comp),
            true
          );
        end loop;
        if not hubo_link then continue; end if;
      else
        -- Sin receta ad-hoc: catálogo web, vía st_sku_map.
        v_pid  := coalesce(it ->> 'productId', '');
        v_prid := coalesce(it ->> 'presId', '');

        -- Línea sin productId pero con la descripción exacta de una
        -- presentación del catálogo ("Melena de León — Extracto en gotas —
        -- 60 ml"): es ese producto, que perdió el vínculo en el remito. Una
        -- descripción con agregados o cambiada NO se adivina.
        if v_pid = '' then
          select p ->> 'id', pr ->> 'id' into v_pid, v_prid
            from public.ss_store s,
                 jsonb_array_elements(coalesce(s.products::jsonb, '[]'::jsonb)) as p,
                 jsonb_array_elements(coalesce(p -> 'presentations', '[]'::jsonb)) as pr
           where s.id = 1
             and public.st_norm_linea((p ->> 'name') || ' — ' || coalesce(pr ->> 'label', ''))
                 = public.st_norm_linea(descr)
           limit 1;
          v_pid  := coalesce(v_pid, '');
          v_prid := coalesce(v_prid, '');
        end if;

        select m.categoria, m.codigo, m.unidades into v_cat, v_cod, v_cant_comp
          from public.st_sku_map m
         where m.producto_id = v_pid
           and m.pres_id     = v_prid
           and m.activo;

        if not found then
          sin_mapear := sin_mapear || jsonb_build_object(
            'producto_id', nullif(v_pid, ''),
            'pres_id',     nullif(v_prid, ''),
            'descripcion', descr,
            'cantidad',    qty,
            'motivo',      case
                             when v_pid = ''
                               then 'Línea cargada a mano, sin producto del catálogo ni receta ad-hoc'
                             else 'El SKU no está vinculado a ningún ítem del inventario'
                           end
          );
          continue;
        end if;

        perform 1 from public.st_items i where i.categoria = v_cat and i.codigo = v_cod;
        if not found then
          sin_mapear := sin_mapear || jsonb_build_object(
            'producto_id', v_pid,
            'pres_id',     v_prid,
            'descripcion', descr,
            'cantidad',    qty,
            'motivo',      'El ítem ' || v_cod || ' ya no está en el inventario'
          );
          continue;
        end if;

        clave := v_cat || '|' || v_cod;
        objetivo := jsonb_set(
          objetivo, array[clave],
          to_jsonb(coalesce((objetivo -> clave)::numeric, 0) + qty * coalesce(v_cant_comp, 1)),
          true
        );
      end if;
    end loop;
  end if;

  -- Aplicar SOLO la diferencia contra lo ya descontado.
  -- Ordenado por clave para tomar los locks en el mismo orden que st_aplicar y
  -- no trabarse con una venta simultánea cargada desde la plataforma.
  -- En modo reparación (st.sin_mover = 'on') no se toca el stock: solo se
  -- registra más abajo qué corresponde a este pedido.
  if not sin_mover then
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

      -- El movimiento SIEMPRE es del mismo tipo que la operación original (venta
      -- o consumo interno), con la cantidad firmada: positiva cuando salió y
      -- NEGATIVA cuando volvió.
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
  end if;

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
    case when sin_mover then 'Reparado el 2026-09-23 sin mover stock (ver stock_vinculo_remito_2026-09-23.sql)' else null end,
    now()
  )
  on conflict (order_id) do update set
    estado      = excluded.estado,
    interno     = excluded.interno,
    aplicado    = excluded.aplicado,
    lineas      = excluded.lineas,
    sin_mapear  = excluded.sin_mapear,
    aplicado_at = coalesce(excluded.aplicado_at, public.st_pedidos.aplicado_at),
    nota        = excluded.nota,
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


-- ---------------------------------------------------------------------
-- 3. Reparación de los pedidos ya confirmados, SIN mover stock.
--    Solo pedidos desde que existe el puente (11/08) y en estado que
--    descuenta. Guarda en una tabla temporal qué cambió, para el resumen.
-- ---------------------------------------------------------------------
create temp table st_tmp_reparacion (codigo text, nombre text, unidades numeric) on commit drop;

do $$
declare
  o        record;
  antes    jsonb;
  despues  jsonb;
begin
  perform set_config('st.sin_mover', 'on', true);   -- solo dura esta transacción

  for o in
    select id from public.ss_orders
     where status in ('confirmado', 'preparacion', 'enviado', 'entregado')
       and created_at >= '2026-08-11'
     order by id
  loop
    select coalesce(p.lineas, '[]'::jsonb) into antes from public.st_pedidos p where p.order_id = o.id;
    antes := coalesce(antes, '[]'::jsonb);

    despues := public.st_sync_pedido(o.id, false) -> 'lineas';

    -- Diferencia por ítem entre lo registrado antes y ahora. Positiva: se
    -- vendió y el stock no lo descontó. Negativa: el stock descontó ese ítem
    -- por una venta que era de otro (los vínculos corregidos el 15/09).
    insert into st_tmp_reparacion (codigo, nombre, unidades)
    select coalesce(d.codigo, a.codigo), i.nombre, coalesce(d.cant, 0) - coalesce(a.cant, 0)
      from (select e ->> 'categoria' as categoria, e ->> 'codigo' as codigo, sum((e ->> 'cantidad')::numeric) as cant
              from jsonb_array_elements(coalesce(despues, '[]'::jsonb)) e group by 1, 2) d
      full join (select e ->> 'categoria' as categoria, e ->> 'codigo' as codigo, sum((e ->> 'cantidad')::numeric) as cant
                   from jsonb_array_elements(antes) e group by 1, 2) a
        on a.categoria = d.categoria and a.codigo = d.codigo
      left join public.st_items i
        on i.categoria = coalesce(d.categoria, a.categoria) and i.codigo = coalesce(d.codigo, a.codigo)
     where coalesce(d.cant, 0) - coalesce(a.cant, 0) <> 0;
  end loop;

  perform set_config('st.sin_mover', 'off', true);
end;
$$;

-- Resumen por ítem. Positivo: unidades vendidas que el stock nunca descontó.
-- Negativo: descontadas de más. NADA de esto se movió ahora: sirve de guía
-- para el próximo conteo físico.
select codigo, nombre, sum(unidades) as unidades_no_descontadas
  from st_tmp_reparacion
 group by codigo, nombre
having sum(unidades) <> 0
 order by sum(unidades) desc;

commit;
