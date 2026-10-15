-- =====================================================================
-- Somos Setas — todas las presentaciones de la tienda vinculadas al stock
-- Generado el 2026-10-15 leyendo los datos VIVOS de ss_store, st_items y
-- st_sku_map (sesión de Franco, solo lectura).
--
-- QUÉ ENCONTRÉ
--   De 135 presentaciones de la tienda, 109 descontaban bien. El resto:
--   * Espirulina descontaba CAP-35, que hoy es Citrato de Magnesio + Potasio
--     (Mayra rehízo la Espirulina como CAP-34 el 01/10 y usó CAP-35 para el
--     Citrato). Y Magnesio + Potasio cápsulas apuntaba a CAP-27, borrado.
--   * 6 productos del stock desaparecieron entre el 30/09 y el 01/10 SIN
--     movimiento de baja: POL-42 y POL-43 (Creatina 150/300 g), CAP-36
--     (Bisglicinato), POL-41 (Vitamina C 1 kg), "POL- 39" (Remolacha 1 kg) y
--     POL-40 (Bicarbonato 1 kg). Sus ventas no descontaban nada.
--   * 16 presentaciones sin vínculo y 2 apagadas (Creatina 500 g / 1 kg).
--
-- QUÉ HACE
--   1. Corrige Espirulina -> CAP-34 y Magnesio + Potasio -> CAP-35.
--   2. Vuelve a crear los 6 productos borrados CON SU MISMO CÓDIGO (así el
--      historial de movimientos sigue siendo suyo; Remolacha pasa a "POL-39"
--      sin el espacio).
--   3. Crea los que nunca existieron: Creatina 500 g (POL-44) y 1 kg (POL-45),
--      Pre-Entreno Remolacha 200 g (POL-46), DuplaCore (POL-47), Vitamina C
--      500 g (POL-48), Remolacha 500 g (POL-49), Bicarbonato 500 g (POL-50) y
--      Reishi entero 500 g (ENT-09).
--   4. Vincula lo que faltaba, incluidos el Aceite de Romero (ACE-08, ya
--      existía), los geles de Tremella (GEL-01, que se cuenta en kilos: 250 g
--      descuenta 0,25) y los deshidratados de 500 g.
--
-- STOCK: todo lo que se crea arranca en 0. No se inventa ningún conteo: hay
-- que contar el estante y cargarlo con "Contá". Lo que se vendió de estos
-- productos desde el 30/09 no se descontó y no se va a descontar ahora.
--
-- RECETAS: solo llevan componentes que existen hoy. La materia prima de la
-- Creatina (MP-61), la cucharita (INS-56) y la del Bicarbonato también se
-- borraron el 30/09, así que esas recetas quedan sin materia prima y la
-- sección "Revisión de datos" las va a marcar.
-- DuplaCore se arma: su receta es 1 Creatina 150 g + 1 Pre-Entreno. Al
-- producir DuplaCore se descuentan esos dos; al venderlo, solo DuplaCore.
--
-- Deshidratados de 500 g y 1 kg descuentan 1 unidad del mismo ítem del
-- tamaño chico (igual que ya pasaba con los de 1 kg) y quedan marcados
-- "revisar". Excepción: Tremella entera, cuyo ítem ENT-08 ya es de 1 kg,
-- así que 500 g descuenta 0,5.
--
-- GUARDAS: si un vínculo ya no está como lo encontré, o si ya existe un
-- ítem con alguno de los códigos a crear, se corta SIN CAMBIAR NADA y dice
-- cuál. Idempotente: correrlo dos veces no duplica nada.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 0. Lo que se va a hacer, en tablas temporales
-- ---------------------------------------------------------------------
create temp table _items (codigo text, nombre text, presentacion text, tipo text, bom jsonb, nota text) on commit drop;
insert into _items values
  ('POL-42', 'Creatina Monohidrato 150 g', 'Bolsa 150 g', 'Polvo',
   '[{"categoria":"etiqueta","codigo":"ETQ-POL-43","cantidad":1},{"categoria":"insumo","codigo":"INS-18","cantidad":1}]',
   'Recreado: se borró sin registro entre el 30/09 y el 01/10 (tenía 19). Falta la materia prima en la receta.'),
  ('POL-43', 'Creatina Monohidrato 300 g', 'Bolsa 300 g', 'Polvo',
   '[{"categoria":"etiqueta","codigo":"ETQ-POL-42","cantidad":1},{"categoria":"insumo","codigo":"INS-18","cantidad":1}]',
   'Recreado: se borró sin registro entre el 30/09 y el 01/10 (tenía 8). Falta la materia prima en la receta.'),
  ('POL-44', 'Creatina Monohidrato 500 g', 'Bolsa 500 g', 'Polvo',
   '[{"categoria":"etiqueta","codigo":"ETQ-POL-45","cantidad":1},{"categoria":"insumo","codigo":"INS-18","cantidad":1}]',
   'Alta para vincular la Creatina 500 g de la tienda. Falta la materia prima en la receta.'),
  ('POL-45', 'Creatina Monohidrato 1 kg', 'Bolsa 1 kg', 'Polvo',
   '[{"categoria":"etiqueta","codigo":"ETQ-POL-44","cantidad":1},{"categoria":"insumo","codigo":"INS-18","cantidad":1}]',
   'Alta para vincular la Creatina 1 kg de la tienda. Falta la materia prima en la receta.'),
  ('CAP-36', 'Bisglicinato de magnesio', 'Bolsa 60 u', 'Cápsulas',
   '[{"categoria":"insumo","codigo":"INS-14","cantidad":1},{"categoria":"materia_prima","codigo":"MP-04","cantidad":60},{"categoria":"materia_prima","codigo":"MP-50","cantidad":30}]',
   'Recreado: se borró sin registro entre el 30/09 y el 01/10. Falta la etiqueta en la receta.'),
  ('POL-41', 'Vitamina C 1 kg', 'Bolsa 1 kg', 'Polvo',
   '[{"categoria":"etiqueta","codigo":"ETQ-POL-50","cantidad":1},{"categoria":"materia_prima","codigo":"MP-38","cantidad":1}]',
   'Recreado: se borró sin registro entre el 30/09 y el 01/10.'),
  ('POL-48', 'Vitamina C 500 g', 'Bolsa 500 g', 'Polvo',
   '[{"categoria":"etiqueta","codigo":"ETQ-POL-51","cantidad":1},{"categoria":"materia_prima","codigo":"MP-38","cantidad":1}]',
   'Alta para vincular la Vitamina C 500 g de la tienda.'),
  ('POL-39', 'Remolacha 1 kg', 'Bolsa 1 kg', 'Polvo',
   '[{"categoria":"etiqueta","codigo":"ETQ-POL-46","cantidad":1}]',
   'Recreado (antes "POL- 39"): se borró sin registro entre el 30/09 y el 01/10. Falta la materia prima en la receta.'),
  ('POL-49', 'Remolacha 500 g', 'Bolsa 500 g', 'Polvo',
   '[{"categoria":"etiqueta","codigo":"ETQ-POL-47","cantidad":1}]',
   'Alta para vincular la Remolacha 500 g de la tienda. Falta la materia prima en la receta.'),
  ('POL-40', 'Bicarbonato de Sodio 1 kg', 'Bolsa 1 kg', 'Polvo',
   '[{"categoria":"etiqueta","codigo":"ETQ-POL-48","cantidad":1},{"categoria":"insumo","codigo":"INS-10","cantidad":1}]',
   'Recreado: se borró sin registro entre el 30/09 y el 01/10. Falta la materia prima en la receta.'),
  ('POL-50', 'Bicarbonato de Sodio 500 g', 'Bolsa 500 g', 'Polvo',
   '[{"categoria":"etiqueta","codigo":"ETQ-POL-49","cantidad":1},{"categoria":"insumo","codigo":"INS-10","cantidad":1}]',
   'Alta para vincular el Bicarbonato 500 g de la tienda. Falta la materia prima en la receta.'),
  ('POL-46', 'Pre-Entreno Remolacha 200 g', 'Bolsa 200 g', 'Polvo',
   '[{"categoria":"etiqueta","codigo":"ETQ-POL-52","cantidad":1}]',
   'Alta para vincular el Pre-Entreno de la tienda. Falta la materia prima en la receta.'),
  ('POL-47', 'DuplaCore (Creatina 150 g + Pre-Entreno 200 g)', 'Combo', 'Polvo',
   '[{"categoria":"producto","codigo":"POL-42","cantidad":1},{"categoria":"producto","codigo":"POL-46","cantidad":1}]',
   'Alta para vincular DuplaCore. Se arma con una Creatina 150 g y un Pre-Entreno.'),
  ('ENT-09', 'Reishi Entero', '500 g', 'Setas',
   '[{"categoria":"insumo","codigo":"INS-10","cantidad":1}]',
   'Alta para vincular el Reishi deshidratado de la tienda. Falta la materia prima en la receta.');

-- Vínculos que se corrigen: solo si siguen apuntando a lo que encontré.
create temp table _relink (producto_id text, pres_id text, codigo_viejo text, activo_viejo boolean,
                           codigo text, unidades numeric, revisar boolean) on commit drop;
insert into _relink values
  ('caps-espirulina',      '60',      'CAP-35',                  true,  'CAP-34', 1, false),
  ('caps-mag-potasio',     '60',      'CAP-27',                  true,  'CAP-35', 1, false),
  ('polvo-remolacha',      '1kg',     'POL- 39',                 true,  'POL-39', 1, false),
  ('creatina-monohidrato', 'polvo-3', 'PENDIENTE-CREATINA-500G', false, 'POL-44', 1, false),
  ('creatina-monohidrato', 'polvo-4', 'PENDIENTE-CREATINA-1KG',  false, 'POL-45', 1, false);

-- Vínculos nuevos: presentaciones que hoy no tienen fila en el mapa.
create temp table _nuevos (producto_id text, pres_id text, codigo text, unidades numeric, revisar boolean, etiqueta text) on commit drop;
insert into _nuevos values
  ('aceite-romero',         '10ml',        'ACE-08', 1,    false, 'Aceite de Romero — Frasco gotero — 30 ml'),
  ('pre-entreno-remolacha', '200g',        'POL-46', 1,    false, 'Pre-Entreno Remolacha — Envase 200 g'),
  ('duplacore',             'combo',       'POL-47', 1,    false, 'DuplaCore — Creatina 150 g + Pre-Entreno 200 g'),
  ('polvo-vitc',            '500g',        'POL-48', 1,    false, 'Vitamina C — Polvo — Envase 500 g'),
  ('polvo-remolacha',       '500g',        'POL-49', 1,    false, 'Remolacha — Polvo — Envase 500 g'),
  ('polvo-bicarbonato',     '500g',        'POL-50', 1,    false, 'Bicarbonato de Sodio — Envase 500 g'),
  ('tremella',              'gel250',      'GEL-01', 0.25, false, 'Tremella — Gel base — 250 g'),
  ('tremella',              'gel500',      'GEL-01', 0.5,  false, 'Tremella — Gel base — 500 g'),
  ('tremella',              'gel1k',       'GEL-01', 1,    false, 'Tremella — Gel base — 1 kg'),
  ('tremella',              'desh-500g',   'ENT-08', 0.5,  false, 'Tremella — Entera deshidratada — 500 g'),
  ('melena-de-leon',        'desh-500',    'ENT-05', 1,    true,  'Melena de León — Entera deshidratada — 500 g'),
  ('cordyceps',             'desh-500G',   'ENT-01', 1,    true,  'Cordyceps — Entero deshidratado — 500 g'),
  ('shiitake',              'entero-500g', 'ENT-07', 1,    true,  'Shiitake — Entero deshidratado — 500 g'),
  ('shiitake',              'p9',          'ENT-06', 1,    true,  'Shiitake — Laminado deshidratado — 500 g'),
  ('reishi',                'Desh-500',    'ENT-09', 1,    false, 'Reishi — Entero deshidratado — 500 g'),
  ('reishi',                'Desh-1KG',    'ENT-09', 2,    false, 'Reishi — Entero deshidratado — 1 kg');

-- ---------------------------------------------------------------------
-- 1. GUARDAS
-- ---------------------------------------------------------------------
do $$
declare v text;
begin
  -- a) Un código a crear ya está ocupado por otro ítem (alguien lo creó a mano).
  select string_agg(i.codigo || ' (' || s.nombre || ')', ', ') into v
    from _items i
    join public.st_items s on s.categoria = 'producto' and s.codigo = i.codigo
   where s.nombre <> i.nombre;
  if v is not null then
    raise exception 'Estos códigos ya los usa otro producto, revisarlos antes de correr: %', v;
  end if;

  -- a2) El mismo producto ya se cargó a mano con otro código: frenar en vez
  --     de duplicarlo (pasó con la creatina el 15/09).
  select string_agg(s.codigo || ' (' || s.nombre || ')', ', ') into v
    from public.st_items s
   where s.categoria = 'producto'
     and s.codigo not in (select codigo from _items)
     and (   lower(s.nombre) like '%creatina%'
          or lower(s.nombre) like '%pre%entreno%'
          or lower(s.nombre) like '%dupla%'
          or lower(s.nombre) like '%bicarbonato%'
          or lower(s.nombre) like '%remolacha%'
          or lower(s.nombre) like 'bisgli%'
          or lower(s.nombre) like '%reishi entero%');
  if v is not null then
    raise exception 'Ya hay un producto parecido a uno de los que se crean, revisarlo antes de correr: %', v;
  end if;

  -- b) Un vínculo a corregir ya no está como lo encontré.
  select string_agg(r.producto_id || ' / ' || r.pres_id || ' (hoy ' || coalesce(m.codigo, 'sin fila') || ')', ', ') into v
    from _relink r
    left join public.st_sku_map m on m.producto_id = r.producto_id and m.pres_id = r.pres_id
   where m.codigo is null
      or not ((m.codigo = r.codigo_viejo and m.activo = r.activo_viejo)
              or (m.codigo = r.codigo and m.activo));
  if v is not null then
    raise exception 'Estos vínculos cambiaron desde el 15/10, revisarlos antes de correr: %', v;
  end if;

  -- c) A una presentación "sin vínculo" alguien ya le puso uno distinto.
  select string_agg(n.producto_id || ' / ' || n.pres_id || ' (hoy ' || m.codigo || ')', ', ') into v
    from _nuevos n
    join public.st_sku_map m on m.producto_id = n.producto_id and m.pres_id = n.pres_id
   where m.codigo <> n.codigo;
  if v is not null then
    raise exception 'Estas presentaciones ya tienen otro vínculo, revisarlas antes de correr: %', v;
  end if;

  -- d) Los ítems existentes a los que se vincula tienen que seguir ahí.
  select string_agg(x.codigo, ', ') into v
    from (select codigo from _nuevos union select codigo from _relink) x
   where x.codigo not in (select codigo from _items)
     and not exists (select 1 from public.st_items s where s.categoria = 'producto' and s.codigo = x.codigo);
  if v is not null then
    raise exception 'Estos productos del stock ya no existen: %', v;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 2. ALTA DE LOS PRODUCTOS (stock en 0; si ya existen, no se tocan)
-- ---------------------------------------------------------------------
with alta as (
  insert into public.st_items (categoria, codigo, nombre, actual, minimo, data, updated_at, updated_by)
  select 'producto', i.codigo, i.nombre, 0, 0,
         jsonb_build_object('bom', i.bom, 'presentacion', i.presentacion, 'tipo', i.tipo,
                            'observaciones', i.nota),
         now(), 'vinculos-2026-10-15'
    from _items i
  on conflict (categoria, codigo) do nothing
  returning codigo, nombre
)
insert into public.st_movimientos (id, fecha, tipo, categoria, codigo, nombre, cantidad, nota, componentes, usuario, origen, anterior, resultante)
select 'vinc-2026-10-15-' || a.codigo, now(), 'alta', 'producto', a.codigo, a.nombre, 0,
       i.nota || ' Stock en 0 hasta contar el estante.', '[]'::jsonb, 'vinculos-2026-10-15', 'plataforma', null, 0
  from alta a join _items i on i.codigo = a.codigo
on conflict (id) do nothing;

-- ---------------------------------------------------------------------
-- 3. VÍNCULOS CORREGIDOS
-- ---------------------------------------------------------------------
update public.st_sku_map m
   set codigo = r.codigo, categoria = 'producto', unidades = r.unidades,
       activo = true, revisar = r.revisar,
       updated_at = now(), updated_by = 'vinculos-2026-10-15'
  from _relink r
 where m.producto_id = r.producto_id and m.pres_id = r.pres_id
   and m.codigo = r.codigo_viejo;

-- ---------------------------------------------------------------------
-- 4. VÍNCULOS NUEVOS
-- ---------------------------------------------------------------------
insert into public.st_sku_map
  (producto_id, pres_id, categoria, codigo, unidades, activo, revisar, etiqueta, updated_at, updated_by)
select n.producto_id, n.pres_id, 'producto', n.codigo, n.unidades, true, n.revisar, n.etiqueta,
       now(), 'vinculos-2026-10-15'
  from _nuevos n
on conflict (producto_id, pres_id) do nothing;

-- ---------------------------------------------------------------------
-- 5. Palo Negro: ya no está en la tienda y su ítem (CAP-22) se borró el
--    03/10. Se apaga el vínculo para que no figure como roto.
-- ---------------------------------------------------------------------
update public.st_sku_map
   set activo = false, revisar = true,
       etiqueta = 'SIN VINCULAR — CAP-22 Palo Negro se borró el 03/10 y el producto ya no está en la tienda',
       updated_at = now(), updated_by = 'vinculos-2026-10-15'
 where producto_id = 'caps-palo-negro' and pres_id = '90' and codigo = 'CAP-22' and activo;

commit;


-- =====================================================================
-- CONTROLES — correr después
-- =====================================================================

-- A. Presentaciones de la tienda SIN vínculo activo a un producto que exista.
--    Solo tiene que salir el Aceite de Hibiscus (oculto en la tienda, su
--    ítem ACE-04 se borró el 08/10).
select p->>'id' as producto, r->>'id' as presentacion, p->>'name' as nombre, m.codigo, m.activo
  from public.ss_store s
 cross join lateral jsonb_array_elements(s.products) p
 cross join lateral jsonb_array_elements(p->'presentations') r
  left join public.st_sku_map m on m.producto_id = p->>'id' and m.pres_id = r->>'id'
  left join public.st_items i on i.categoria = m.categoria and i.codigo = m.codigo
 where s.id = 1 and (m.codigo is null or not m.activo or i.codigo is null);

-- B. Vínculos activos que apuntan a un ítem inexistente. NO debe devolver filas.
select m.producto_id, m.pres_id, m.codigo
  from public.st_sku_map m
  left join public.st_items i on i.categoria = m.categoria and i.codigo = m.codigo
 where m.activo and i.codigo is null;
