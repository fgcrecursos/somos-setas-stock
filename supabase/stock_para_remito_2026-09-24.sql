-- El remito del panel de la tienda necesita leer el inventario (st_items) y el
-- vínculo tienda → stock (st_sku_map) para mostrar qué descuenta cada línea y
-- para cargar recetas ad-hoc. Esas tablas solo las lee quien está en st_users.
--
-- Síntoma (2026-09-24): una persona del panel que no está en st_users veía TODAS
-- las líneas con "no está vinculado con ningún ítem del stock", aunque sí lo
-- estaban. RLS no da error: devuelve una lista vacía, y el panel la tomaba como
-- "no hay vínculo". El descuento real no se veía afectado (st_sync_pedido corre
-- como security definer), pero el aviso era falso y no dejaba cargar recetas.
--
-- Esta función deja leer las dos tablas, solo lectura, a cualquier usuario
-- activo del panel (ss_users) o de la plataforma de stock. Un cliente de la
-- tienda logueado no está en ss_users: recibe null.
--
-- Idempotente. No toca datos.

create or replace function public.ss_stock_para_remito()
returns json
language plpgsql
security definer
stable
set search_path = public
as $$
begin
  if not (
    public.st_can_read()
    or exists (
      select 1 from public.ss_users u
       where u.email = lower(auth.jwt() ->> 'email') and u.activo
    )
  ) then
    return null;
  end if;

  return json_build_object(
    'items', coalesce((
      select json_agg(json_build_object(
               'categoria', i.categoria, 'codigo', i.codigo, 'nombre', i.nombre,
               'actual', i.actual, 'data', i.data))
        from public.st_items i), '[]'::json),
    'map', coalesce((
      select json_agg(json_build_object(
               'producto_id', m.producto_id, 'pres_id', m.pres_id,
               'categoria', m.categoria, 'codigo', m.codigo, 'activo', m.activo))
        from public.st_sku_map m), '[]'::json)
  );
end;
$$;

revoke all on function public.ss_stock_para_remito() from public;
grant execute on function public.ss_stock_para_remito() to authenticated;
