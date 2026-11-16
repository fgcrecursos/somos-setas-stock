-- =====================================================================
-- AUDITORÍA DEL 15/11/2026 — lo único que hay que correr en Supabase
--
-- Se puede correr más de una vez: no toca stock ni borra nada.
--
--   1. ss_stock_para_remito(): le da lectura del inventario a TODO usuario
--      activo del panel de la tienda. Estaba pendiente desde el 24/09 y es lo
--      que necesita el remito para proponer "¿es alguno de estos?" en las
--      líneas escritas a mano. Sin esto, quien no está en st_users ve
--      "Tu usuario no tiene acceso al inventario del stock" y no puede
--      vincular nada.
--
--   2. Cepillo de Dientes Amarillo (Suave): la presentación
--      "cepillo-de-dientes-amarillo-suave" apunta a CAP-37, un ítem que
--      Matías eliminó el 03/11 (lo había creado con código de cápsula). El
--      cepillo real es OTR-04. Sólo se cambia si CAP-37 sigue sin existir y
--      OTR-04 sigue siendo ese cepillo.
-- =====================================================================

-- ---------- 1. Lectura del inventario para el remito ----------
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

-- ---------- 2. Cepillo amarillo → OTR-04 ----------
update public.st_sku_map m
   set codigo = 'OTR-04',
       updated_at = now(),
       updated_by = 'auditoria-2026-11-15'
 where m.producto_id = 'cepillo-de-dientes-amarillo-suave'
   and m.pres_id = 'unidad'
   and m.categoria = 'producto'
   and m.codigo = 'CAP-37'
   and not exists (
     select 1 from public.st_items i where i.categoria = 'producto' and i.codigo = 'CAP-37'
   )
   and exists (
     select 1 from public.st_items i
      where i.categoria = 'producto' and i.codigo = 'OTR-04'
        and i.nombre ilike '%cepillo%amarillo%'
   );

-- ---------- Comprobación ----------
select 'ss_stock_para_remito creada' as chequeo,
       (select count(*) from pg_proc where proname = 'ss_stock_para_remito')::text as resultado
union all
select 'vínculos activos que apuntan a un ítem que no existe (tiene que dar 0)',
       (select count(*)::text
          from public.st_sku_map m
          left join public.st_items i on i.categoria = m.categoria and i.codigo = m.codigo
         where m.activo and i.codigo is null)
union all
select 'cepillo amarillo descuenta de',
       (select m.codigo from public.st_sku_map m
         where m.producto_id = 'cepillo-de-dientes-amarillo-suave' and m.pres_id = 'unidad');
