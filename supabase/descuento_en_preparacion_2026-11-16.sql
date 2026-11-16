-- =====================================================================
-- DESCUENTO EN "EN PREPARACIÓN" — 16/11/2026
--
-- Hasta hoy un pedido descontaba el stock al pasar a "Confirmado". Desde
-- este script:
--
--   · Confirmado      → NO descuenta. Queda RESERVADO: se anota qué ítems
--                       y cuántos, sin tocar el stock (st_pedidos.reservado).
--   · En preparación,
--     Enviado,
--     Entregado       → descuenta (como antes). La reserva se borra.
--   · Nuevo, Anulado  → si había descontado, devuelve. La reserva se borra.
--
-- Un pedido que salta de Confirmado a Enviado descuenta igual. Un pedido
-- que vuelve de En preparación a Confirmado devuelve el stock y queda
-- reservado otra vez.
--
-- Al final pasa los pedidos que HOY están en Confirmado y ya descontaron:
-- les devuelve el stock (la mercadería sigue en el estante) y los deja
-- reservados. El 16/11 era uno solo.
--
-- Se puede correr más de una vez.
-- =====================================================================

-- ---------- 1. Columna de la reserva ----------
alter table public.st_pedidos
  add column if not exists reservado jsonb not null default '[]'::jsonb;

-- ---------- 2. Reservar un pedido confirmado ----------
-- Usa el mismo cálculo que el descuento (st_sync_pedido en modo "sin mover
-- stock"), así lo reservado es exactamente lo que se va a descontar cuando
-- pase a En preparación.
create or replace function public.st_reservar_pedido(p_order_id text)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  r        jsonb;
  previo   text := coalesce(current_setting('st.sin_mover', true), '');
begin
  -- Pedido marcado "ya descontado a mano": no se toca.
  if exists (select 1 from public.st_pedidos p where p.order_id = p_order_id and p.ignorar) then
    return jsonb_build_object('ok', true, 'aplicado', false, 'ignorado', true);
  end if;

  -- Si ya había descontado (pedido de antes de este cambio, o que volvió de
  -- En preparación), devuelve el stock: la mercadería sigue en el estante.
  if exists (select 1 from public.st_pedidos p where p.order_id = p_order_id and p.aplicado) then
    perform public.st_sync_pedido(p_order_id, true);
    update public.st_movimientos
       set nota = 'Pedido ' || p_order_id || ' confirmado sin preparar: vuelve al stock y queda reservado hasta que pase a En preparación'
     where referencia = p_order_id
       and origen = 'tienda'
       and fecha = now();
  end if;

  -- Calcular qué descontaría, sin mover stock
  perform set_config('st.sin_mover', 'on', true);
  r := public.st_sync_pedido(p_order_id, false);
  perform set_config('st.sin_mover', previo, true);

  update public.st_pedidos
     set reservado   = coalesce(r -> 'lineas', '[]'::jsonb),
         lineas      = '[]'::jsonb,
         aplicado    = false,
         aplicado_at = null,
         nota        = null,
         updated_at  = now()
   where order_id = p_order_id;

  return jsonb_build_object(
    'ok', true,
    'aplicado', false,
    'reservado', coalesce(r -> 'lineas', '[]'::jsonb),
    'sin_mapear', coalesce(r -> 'sin_mapear', '[]'::jsonb)
  );
end;
$$;

revoke all on function public.st_reservar_pedido(text) from public;

-- ---------- 3. Qué hacer con un pedido según su estado ----------
create or replace function public.st_procesar_pedido(p_order_id text, p_revertir boolean default false)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  v_estado text;
  r        jsonb;
begin
  select status into v_estado from public.ss_orders where id = p_order_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'El pedido no existe');
  end if;

  if p_revertir or v_estado in ('anulado', 'nuevo') then
    update public.st_pedidos set reservado = '[]'::jsonb where order_id = p_order_id;
    if p_revertir or exists (select 1 from public.st_pedidos p where p.order_id = p_order_id and p.aplicado) then
      return public.st_sync_pedido(p_order_id, true);
    end if;
    return jsonb_build_object('ok', true, 'aplicado', false);
  end if;

  if v_estado = 'confirmado' then
    return public.st_reservar_pedido(p_order_id);
  end if;

  if v_estado in ('preparacion', 'enviado', 'entregado') then
    r := public.st_sync_pedido(p_order_id, false);
    update public.st_pedidos set reservado = '[]'::jsonb where order_id = p_order_id;
    return r;
  end if;

  return jsonb_build_object('ok', true, 'aplicado', false);
end;
$$;

revoke all on function public.st_procesar_pedido(text, boolean) from public;

-- ---------- 4. Botón "Aplicar al stock" de la plataforma ----------
create or replace function public.st_aplicar_pedido(p_order_id text, p_revertir boolean default false)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
begin
  if not public.st_is_admin() then
    raise exception 'Sin permiso para modificar el stock';
  end if;
  return public.st_procesar_pedido(p_order_id, p_revertir);
end;
$$;

revoke all on function public.st_aplicar_pedido(text, boolean) from public;
grant execute on function public.st_aplicar_pedido(text, boolean) to authenticated;

-- ---------- 5. El disparador de los pedidos ----------
-- Si algo falla, se anota y se deja pasar: guardar el pedido nunca puede
-- fallar por un problema de stock.
create or replace function public.ss_orders_sync_stock()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  perform public.st_procesar_pedido(new.id, false);
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

-- ---------- 6. Pasar los pedidos que hoy están en Confirmado ----------
do $$
declare
  o record;
begin
  for o in select id from public.ss_orders where status = 'confirmado' order by id loop
    perform public.st_reservar_pedido(o.id);
  end loop;
end $$;

-- ---------- Comprobación ----------
select 'pedidos confirmados que todavía descuentan (tiene que dar 0)' as chequeo,
       (select count(*)::text from public.ss_orders o join public.st_pedidos p on p.order_id = o.id
         where o.status = 'confirmado' and p.aplicado) as resultado
union all
select 'pedidos confirmados con reserva',
       (select count(*)::text from public.st_pedidos p join public.ss_orders o on o.id = p.order_id
         where o.status = 'confirmado' and jsonb_array_length(p.reservado) > 0)
union all
select 'unidades reservadas',
       (select coalesce(sum((e ->> 'cantidad')::numeric), 0)::text
          from public.st_pedidos p join public.ss_orders o on o.id = p.order_id,
               jsonb_array_elements(p.reservado) e
         where o.status = 'confirmado');
