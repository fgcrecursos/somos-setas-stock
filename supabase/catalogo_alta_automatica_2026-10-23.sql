-- =====================================================================
-- Somos Setas — todo producto del stock queda en el catálogo de la tienda
-- 2026-10-23
--
-- PROBLEMA
--   Los productos que se dan de alta en el stock (st_items, categoría
--   'producto') no aparecían en el catálogo web (ss_store.products) ni
--   quedaban vinculados (st_sku_map). Sus ventas no descontaban stock y la
--   web no los ofrecía.
--
-- QUÉ HACE
--   1. public.st_alta_en_tienda(categoria, codigo): si el producto del stock
--      no tiene un vínculo ACTIVO con la tienda, le crea una ficha en el
--      catálogo web OCULTA ("visible": false) con una sola presentación y lo
--      vincula 1 a 1. Si ya está vinculado, no hace nada.
--   2. Un disparador sobre st_items que llama a esa función por cada
--      producto nuevo. Corre al CONFIRMAR la transacción (deferred): si en la
--      misma operación el producto ya se vinculó a una ficha existente (como
--      hacen los scripts de vínculos), no se crea una ficha duplicada.
--   3. Pone al día los productos que hoy están sin vínculo.
--
-- LA FICHA NUEVA
--   * Oculta: no se ve en la web hasta activarla en el panel administrativo.
--   * Nombre = nombre del stock. Presentación = la del stock (o el nombre).
--   * Precio, precio mayorista y peso en 0; sin foto, descripción ni
--     beneficios. Completarlos ANTES de activarla.
--   * Categoría según el tipo del stock: Aceite → aceites, Setas → hongos,
--     el resto → suplementos.
--
-- No toca fichas ni vínculos existentes ni cantidades de stock.
-- Idempotente: correrlo dos veces no duplica nada.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1. Texto → identificador de la tienda ("Aceite Romero" → "aceite-romero")
-- ---------------------------------------------------------------------
create or replace function public.ss_slug(p text)
returns text
language sql immutable
as $$
  select trim(both '-' from regexp_replace(
           translate(lower(coalesce(p, '')), 'áéíóúàèìòùäëïöüâêîôûñç', 'aeiouaeiouaeiouaeiounc'),
           '[^a-z0-9]+', '-', 'g'))
$$;


-- ---------------------------------------------------------------------
-- 2. Alta de un producto del stock en el catálogo (oculto) + vínculo
--    Devuelve el id de la ficha creada, o null si no hizo falta.
-- ---------------------------------------------------------------------
create or replace function public.st_alta_en_tienda(p_categoria text, p_codigo text)
returns text
language plpgsql security definer
set search_path = public
as $$
declare
  v_item     public.st_items%rowtype;
  v_products jsonb;
  v_base     text;
  v_id       text;
  v_n        int := 1;
  v_pres     text;
  v_tipo     text;
  v_cat      text;
  v_ficha    jsonb;
begin
  if p_categoria is distinct from 'producto' then
    return null;
  end if;

  select * into v_item from public.st_items
   where categoria = p_categoria and codigo = p_codigo;
  if not found then
    return null;                                    -- se borró en la misma operación
  end if;

  if exists (select 1 from public.st_sku_map
              where categoria = p_categoria and codigo = p_codigo and activo) then
    return null;                                    -- ya está vinculado
  end if;

  -- Bloquea el catálogo mientras se elige el id y se agrega la ficha
  select products into v_products from public.ss_store where id = 1 for update;
  if not found then
    raise warning 'st_alta_en_tienda: no existe el catálogo (ss_store id 1); % queda sin alta', p_codigo;
    return null;
  end if;
  v_products := coalesce(v_products, '[]'::jsonb);

  v_base := nullif(public.ss_slug(v_item.nombre), '');
  if v_base is null then
    v_base := public.ss_slug(p_codigo);
  end if;
  v_id := v_base;
  while exists (select 1 from jsonb_array_elements(v_products) p where p->>'id' = v_id)
     or exists (select 1 from public.st_sku_map where producto_id = v_id) loop
    v_n  := v_n + 1;
    v_id := v_base || '-' || v_n;
  end loop;

  v_pres := coalesce(nullif(trim(v_item.data->>'presentacion'), ''), trim(v_item.nombre));
  v_tipo := lower(coalesce(v_item.data->>'tipo', ''));
  v_cat  := case
              when v_tipo like 'aceite%' then 'aceites'
              when v_tipo like 'seta%'   then 'hongos'
              else 'suplementos'
            end;

  v_ficha := jsonb_build_object(
    'id',          v_id,
    'name',        trim(v_item.nombre),
    'visible',     false,
    'featured',    false,
    'category',    v_cat,
    'image',       '',
    'video',       '',
    'gallery',     '[]'::jsonb,
    'tagline',     '',
    'description', '',
    'scientific',  '',
    'benefits',    '[]'::jsonb,
    'presentations', jsonb_build_array(jsonb_build_object(
      'id',             'unidad',
      'label',          v_pres,
      'pesoG',          0,
      'price',          0,
      'priceMayorista', 0
    ))
  );

  update public.ss_store
     set products = v_products || jsonb_build_array(v_ficha)
   where id = 1;

  insert into public.st_sku_map
         (producto_id, pres_id, categoria, codigo, unidades, activo, revisar, etiqueta, updated_at, updated_by)
  values (v_id, 'unidad', p_categoria, p_codigo, 1, true, false,
          trim(v_item.nombre) || ' — ' || v_pres, now(), 'alta-automatica')
  on conflict (producto_id, pres_id) do nothing;

  return v_id;
end;
$$;

revoke all on function public.st_alta_en_tienda(text, text) from public;
revoke all on function public.st_alta_en_tienda(text, text) from anon, authenticated;


-- ---------------------------------------------------------------------
-- 3. Disparador: cada producto nuevo del stock entra al catálogo (oculto)
-- ---------------------------------------------------------------------
create or replace function public.st_items_alta_tienda()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  perform public.st_alta_en_tienda(new.categoria, new.codigo);
  return null;
end;
$$;

drop trigger if exists st_items_alta_tienda_trg on public.st_items;
create constraint trigger st_items_alta_tienda_trg
  after insert on public.st_items
  deferrable initially deferred
  for each row
  when (new.categoria = 'producto')
  execute function public.st_items_alta_tienda();


-- ---------------------------------------------------------------------
-- 4. Puesta al día: los productos que hoy no están vinculados
-- ---------------------------------------------------------------------
create temp table _altas on commit drop as
select i.codigo, i.nombre, public.st_alta_en_tienda(i.categoria, i.codigo) as ficha
  from public.st_items i
 where i.categoria = 'producto'
   and not exists (select 1 from public.st_sku_map m
                    where m.categoria = i.categoria and m.codigo = i.codigo and m.activo)
 order by i.codigo;

select codigo, nombre, ficha as ficha_creada_oculta from _altas;

commit;


-- =====================================================================
-- CONTROLES — correr después
-- =====================================================================

-- A. Productos del stock SIN vínculo activo con la tienda. NO debe devolver filas.
select i.codigo, i.nombre
  from public.st_items i
 where i.categoria = 'producto'
   and not exists (select 1 from public.st_sku_map m
                    where m.categoria = i.categoria and m.codigo = i.codigo and m.activo);

-- B. Fichas creadas automáticamente que siguen ocultas o sin precio (para completar
--    en el panel antes de activarlas).
select p->>'id' as ficha, p->>'name' as nombre, p->>'visible' as visible,
       r->>'label' as presentacion, r->>'price' as precio
  from public.ss_store s
 cross join lateral jsonb_array_elements(s.products) p
 cross join lateral jsonb_array_elements(p->'presentations') r
  join public.st_sku_map m on m.producto_id = p->>'id' and m.pres_id = r->>'id'
 where s.id = 1 and m.updated_by = 'alta-automatica'
 order by 1;

-- C. Presentaciones de la tienda sin vínculo (al revés): si aparece una que es
--    el mismo producto que una ficha automática, vincular la existente y borrar
--    la automática desde el panel.
select p->>'id' as producto, r->>'id' as presentacion, p->>'name' as nombre
  from public.ss_store s
 cross join lateral jsonb_array_elements(s.products) p
 cross join lateral jsonb_array_elements(p->'presentations') r
  left join public.st_sku_map m on m.producto_id = p->>'id' and m.pres_id = r->>'id' and m.activo
 where s.id = 1 and m.codigo is null;
