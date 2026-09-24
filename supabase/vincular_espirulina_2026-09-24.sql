-- Vincula "Espirulina — 60 cápsulas × 500 mg" de la tienda con CAP-35 ESPIRULINA.
--
-- La fila de st_sku_map (caps-espirulina / 60) apuntaba a CAP-31, que en la
-- base es Zeolita, y estaba apagada (activo=false): las ventas de Espirulina no
-- descontaban nada. CAP-35 ESPIRULINA existe como producto y no estaba vinculado.
--
-- No mueve stock: las ventas ya hechas no se descuentan en forma retroactiva
-- (el equipo corrige los conteos a mano). Desde ahora cada pedido confirmado con
-- Espirulina descuenta CAP-35.
--
-- Aborta si la fila no está exactamente como se auditó (no pisa trabajo ajeno).
-- Idempotente: si ya quedó en CAP-35 no hace nada.

do $$
declare
  v_fila st_sku_map%rowtype;
begin
  if not exists (select 1 from st_items where categoria = 'producto' and codigo = 'CAP-35' and nombre ilike '%espirulina%') then
    raise exception 'CAP-35 no existe o ya no es Espirulina: revisar antes de vincular';
  end if;

  select * into v_fila from st_sku_map where producto_id = 'caps-espirulina' and pres_id = '60';

  if not found then
    raise exception 'No existe la fila caps-espirulina / 60 en st_sku_map';
  elsif v_fila.codigo = 'CAP-35' and v_fila.activo then
    raise notice 'Ya estaba vinculado a CAP-35: nada que hacer';
    return;
  elsif v_fila.codigo <> 'CAP-31' or v_fila.activo then
    raise exception 'La fila cambió desde la auditoría (codigo=%, activo=%): revisar a mano', v_fila.codigo, v_fila.activo;
  end if;

  update st_sku_map
     set categoria = 'producto', codigo = 'CAP-35', activo = true, revisar = false,
         unidades = 1, updated_at = now()
   where producto_id = 'caps-espirulina' and pres_id = '60';

  raise notice 'Espirulina vinculada a CAP-35';
end $$;

-- Control: tiene que devolver una fila con CAP-35 / ESPIRULINA / activo = true
select m.producto_id, m.pres_id, m.codigo, i.nombre, i.actual, m.activo
  from st_sku_map m
  join st_items i on i.categoria = m.categoria and i.codigo = m.codigo
 where m.producto_id = 'caps-espirulina';
