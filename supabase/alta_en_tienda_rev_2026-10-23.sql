-- =====================================================================
-- Somos Setas — el alta automática en la tienda avanza la versión del catálogo
-- 2026-10-23 (complementa catalogo_alta_automatica_2026-10-23.sql)
--
-- PROBLEMA
--   st_alta_en_tienda agregaba la ficha a ss_store.products sin avanzar `rev`
--   ni `updated_at`. El panel guarda con compare-and-swap sobre `rev`: si
--   alguien guardaba en el panel justo mientras se creaba un producto en el
--   stock, su guardado no detectaba el cambio y la ficha nueva se perdía.
--
-- QUÉ HACE
--   Redefine st_alta_en_tienda igual que antes, pero el UPDATE de ss_store
--   ahora hace rev = rev + 1 y updated_at = now(). No toca datos, no cambia
--   el disparador ni los permisos. Idempotente.
-- =====================================================================

begin;

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

  -- rev + 1: un guardado del panel hecho con la versión anterior falla el
  -- compare-and-swap, relee y conserva la ficha nueva.
  update public.ss_store
     set products   = v_products || jsonb_build_array(v_ficha),
         rev        = rev + 1,
         updated_at = now()
   where id = 1;

  insert into public.st_sku_map
         (producto_id, pres_id, categoria, codigo, unidades, activo, revisar, etiqueta, updated_at, updated_by)
  values (v_id, 'unidad', p_categoria, p_codigo, 1, true, false,
          trim(v_item.nombre) || ' — ' || v_pres, now(), 'alta-automatica')
  on conflict (producto_id, pres_id) do nothing;

  return v_id;
end;
$$;

-- create or replace conserva los permisos, pero los reafirmamos por las dudas
revoke all on function public.st_alta_en_tienda(text, text) from public;
revoke all on function public.st_alta_en_tienda(text, text) from anon, authenticated;

commit;


-- =====================================================================
-- CONTROL — correr después. Debe devolver una fila con "true".
-- =====================================================================
select position('rev        = rev + 1' in pg_get_functiondef('public.st_alta_en_tienda(text,text)'::regprocedure)) > 0
       as alta_avanza_rev;
