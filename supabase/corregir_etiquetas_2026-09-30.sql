-- =====================================================================
-- SOMOS SETAS · STOCK — Recetas que descuentan la etiqueta equivocada
-- ---------------------------------------------------------------------
-- Correr UNA vez en el SQL Editor de Supabase (proyecto muuqqbocpumdvhvxsigz).
-- Se puede volver a correr: lo que ya está corregido se saltea.
--
-- Auditoría del 30/09/2026 (docs/auditoria-2026-09-30.md, sección
-- "Revisión de datos" de la app): los polvos de 100 g, 500 g y 1 kg
-- descontaban la etiqueta de 50 g, mientras las etiquetas de su tamaño
-- existían y nunca se movían. Tres extractos no descontaban ninguna.
--
-- QUÉ CAMBIA (sólo la línea de etiqueta de cada receta; nada de stock)
--
--   Producto                                    Descontaba            Pasa a descontar
--   POL-23 Citrato Mg + K 50 g                  ETQ-POL-31 (100 g)    ETQ-POL-26 Magnesio + Potasio 50 g
--   POL-24 Triple Magnesio 50 g                 ETQ-POL-27 (30 g)     ETQ-POL-40 Triple Magnesio 50 g
--   POL-25 Citrato de Potasio 100 g             ETQ-POL-06 (50 g)     ETQ-POL-41 Citrato de Potasio 100 g
--   POL-26 Citrato de Magnesio 100 g            ETQ-POL-23 (50 g)     ETQ-POL-33 Citrato de Magnesio 100 g
--   POL-27 Glicinato de Magnesio 100 g          ETQ-POL-24 (50 g)     ETQ-POL-30 Glicinato de Magnesio 100 g
--   POL-28 Malato de Magnesio 100 g             ETQ-POL-25 (50 g)     ETQ-POL-29 Malato de Magnesio 100 g
--   POL-30 Triple Magnesio 100 g                ETQ-POL-24 (Glicinato 50 g)  ETQ-POL-32 Triple Magnesio 100 g
--   POL-31 Citrato de Magnesio 500 g            ETQ-POL-23 (50 g)     ETQ-POL-36 Citrato de Magnesio 500 g
--   POL-33 Glicinato de Magnesio 500 g          ETQ-POL-24 (50 g)     ETQ-POL-34 Glicinato de Magnesio 500 g
--   POL-34 Malato de Magnesio 500 g             ETQ-POL-25 (50 g)     ETQ-POL-35 Malato de Magnesio 500 g
--   POL-36 Citrato de Potasio 1 kg              ETQ-POL-06 (50 g)     ETQ-POL-37 Citrato de Potasio 1 kg
--   POL-37 Glicinato de Magnesio 1 kg           ETQ-POL-24 (50 g)     ETQ-POL-38 Glicinato de Magnesio 1 kg
--   POL-38 Malato de Magnesio 1 kg              ETQ-POL-25 (50 g)     ETQ-POL-39 Malato de Magnesio 1 kg
--   CAP-15 Tremella Plus cápsulas               ETQ-CAP-10 (Colágeno) ETQ-CAP-30 Tremella Plus
--   CAP-17 Cúrcuma+Jengibre+Pimienta+Vit C      ETQ-CAP-09 (Cúrcuma+PN) ETQ-CAP-15 Cúrcuma+PN+C+Jen
--   EXT-04 Chaga extracto                       (ninguna)             ETQ-EXT-12 Chaga Extracto
--   EXT-14 Tremella extracto                    (ninguna)             ETQ-EXT-08 Tremella Extracto
--   EXT-18 Pasiflora extracto                   (ninguna)             ETQ-EXT-44 Pasiflora
--
--   Y la ficha de la etiqueta ETQ.ENT-7 "Cordyceps entero x 100grs" decía
--   presentación "50 gr": pasa a "100 gr" (el producto ENT-01 es de 100 g).
--
-- QUÉ NO TOCA (no hay etiqueta de ese tamaño; hay que darla de alta o decidir)
--   POL-32 Citrato de Potasio 500 g · POL-35 Citrato de Magnesio 1 kg ·
--   POL-15 / POL-16 cacaos 125 g · CAP-33 Maca (la etiqueta dice 90 u) ·
--   ENT-07 Shiitake entero (usa la de laminado) · ENT-08 Tremella entera ·
--   GEL-1 / GEL-2 · CAP-36 Bisglicinato · ACE-01 (descuenta también ETQ-01
--   "Etiquetas llegué", de envíos).
--
-- CONTROLES
--   · Si una receta ya no tiene la etiqueta vieja (alguien la corrigió a mano
--     desde la app), se saltea: no pisa trabajo ajeno.
--   · Si la etiqueta nueva no existe o cambió de nombre, ABORTA sin tocar nada.
--   · El stock (`actual`) no se toca en ningún caso.
--   · Cada producto corregido deja un movimiento "edición" en el historial.
--
-- DESPUÉS DE CORRERLO: contar las etiquetas de 50 g y las de los otros
-- tamaños y cargar el número real ("Corrección por conteo físico"): hasta
-- hoy las de 50 g bajaban por ventas de otros tamaños.
-- =====================================================================

begin;

create temp table st_tmp_etq (
  orden         int,
  producto      text,
  vieja         text,   -- null = la receta no tenía etiqueta: se agrega
  nueva         text,
  nombre_nueva  text,   -- nombre que tiene que tener la etiqueta nueva
  motivo        text
) on commit drop;

insert into st_tmp_etq values
  ( 1, 'POL-23', 'ETQ-POL-31', 'ETQ-POL-26', 'Magnesio + Potasio',            'es de 50 g y descontaba la de 100 g'),
  ( 2, 'POL-24', 'ETQ-POL-27', 'ETQ-POL-40', 'Triple Magnesio',               'es de 50 g y descontaba la de 30 g'),
  ( 3, 'POL-25', 'ETQ-POL-06', 'ETQ-POL-41', 'CITRATO DE POTASIO',            'es de 100 g y descontaba la de 50 g'),
  ( 4, 'POL-26', 'ETQ-POL-23', 'ETQ-POL-33', 'Citrato de Magnesio',           'es de 100 g y descontaba la de 50 g'),
  ( 5, 'POL-27', 'ETQ-POL-24', 'ETQ-POL-30', 'Glicinato de Magnesio',         'es de 100 g y descontaba la de 50 g'),
  ( 6, 'POL-28', 'ETQ-POL-25', 'ETQ-POL-29', 'Malato de Magnesio',            'es de 100 g y descontaba la de 50 g'),
  ( 7, 'POL-30', 'ETQ-POL-24', 'ETQ-POL-32', 'Triple Magnesio',               'es Triple Magnesio 100 g y descontaba la de Glicinato 50 g'),
  ( 8, 'POL-31', 'ETQ-POL-23', 'ETQ-POL-36', 'Citrato de Magnesio',           'es de 500 g y descontaba la de 50 g'),
  ( 9, 'POL-33', 'ETQ-POL-24', 'ETQ-POL-34', 'Glicinato de Magnesio',         'es de 500 g y descontaba la de 50 g'),
  (10, 'POL-34', 'ETQ-POL-25', 'ETQ-POL-35', 'Malato de Magnesio',            'es de 500 g y descontaba la de 50 g'),
  (11, 'POL-36', 'ETQ-POL-06', 'ETQ-POL-37', 'Citrato de Potasio',            'es de 1 kg y descontaba la de 50 g'),
  (12, 'POL-37', 'ETQ-POL-24', 'ETQ-POL-38', 'Glicinato de Magnesio',         'es de 1 kg y descontaba la de 50 g'),
  (13, 'POL-38', 'ETQ-POL-25', 'ETQ-POL-39', 'Malato de Magnesio',            'es de 1 kg y descontaba la de 50 g'),
  (14, 'CAP-15', 'ETQ-CAP-10', 'ETQ-CAP-30', 'Tremella Plus+ col+A+c+e',      'descontaba la de Colágeno Hidrolizado'),
  (15, 'CAP-17', 'ETQ-CAP-09', 'ETQ-CAP-15', 'Curcuma +P.N+C + Jen',          'descontaba la de Cúrcuma + Pimienta (sin jengibre ni vit C)'),
  (16, 'EXT-04', null,         'ETQ-EXT-12', 'Chago Extracto',                'no descontaba ninguna etiqueta'),
  (17, 'EXT-14', null,         'ETQ-EXT-08', 'Tremela Extracto',              'no descontaba ninguna etiqueta'),
  (18, 'EXT-18', null,         'ETQ-EXT-44', 'PASIFLORA',                     'no descontaba ninguna etiqueta');

create temp table st_tmp_resultado (orden int, producto text, cambio text, resultado text) on commit drop;

do $$
declare
  r            record;
  v_bom        jsonb;
  v_prod       text;
  v_nombre_etq text;
  v_cambio     text;
  -- Mismo criterio para comparar nombres: minúsculas y espacios simples
  norm         constant text := '\s+';
begin
  -- 1) Primero se verifican TODAS las etiquetas nuevas: si alguna no está como
  --    se auditó, no se toca ninguna receta.
  for r in select * from st_tmp_etq order by orden loop
    select nombre into v_nombre_etq
      from public.st_items
     where categoria = 'etiqueta' and codigo = r.nueva;
    if not found then
      raise exception 'No existe la etiqueta % (iba para %). No se cambió nada.', r.nueva, r.producto;
    end if;
    if lower(btrim(regexp_replace(v_nombre_etq, norm, ' ', 'g')))
       <> lower(btrim(regexp_replace(r.nombre_nueva, norm, ' ', 'g'))) then
      raise exception 'La etiqueta % ahora se llama "%" (se esperaba "%"). No se cambió nada.',
        r.nueva, v_nombre_etq, r.nombre_nueva;
    end if;
  end loop;

  -- 2) Recetas, una por una
  for r in select * from st_tmp_etq order by orden loop
    v_cambio := coalesce(r.vieja, '(ninguna)') || ' → ' || r.nueva;

    select coalesce(data -> 'bom', '[]'::jsonb), nombre into v_bom, v_prod
      from public.st_items
     where categoria = 'producto' and codigo = r.producto
       for update;
    if not found then
      insert into st_tmp_resultado values (r.orden, r.producto, v_cambio, 'SALTEADO: el producto ya no existe');
      continue;
    end if;

    -- Ya descuenta la etiqueta nueva: nada que hacer (script corrido antes)
    if v_bom @> jsonb_build_array(jsonb_build_object('categoria', 'etiqueta', 'codigo', r.nueva)) then
      insert into st_tmp_resultado values (r.orden, r.producto, v_cambio, 'ya estaba corregido');
      continue;
    end if;

    if r.vieja is not null then
      if not v_bom @> jsonb_build_array(jsonb_build_object('categoria', 'etiqueta', 'codigo', r.vieja)) then
        insert into st_tmp_resultado values (r.orden, r.producto, v_cambio,
          'SALTEADO: la receta ya no tiene ' || r.vieja || ' (alguien la cambió): revisarla a mano');
        continue;
      end if;
      -- Se reemplaza sólo el código de esa línea; la cantidad y el orden quedan
      select jsonb_agg(
               case when e ->> 'categoria' = 'etiqueta' and e ->> 'codigo' = r.vieja
                    then jsonb_set(e, '{codigo}', to_jsonb(r.nueva))
                    else e end
               order by ord)
        into v_bom
        from jsonb_array_elements(v_bom) with ordinality as t(e, ord);
    else
      if v_bom @> '[{"categoria": "etiqueta"}]'::jsonb then
        insert into st_tmp_resultado values (r.orden, r.producto, v_cambio,
          'SALTEADO: ya tiene otra etiqueta en la receta: revisarla a mano');
        continue;
      end if;
      v_bom := v_bom || jsonb_build_array(
        jsonb_build_object('categoria', 'etiqueta', 'codigo', r.nueva, 'cantidad', 1));
    end if;

    update public.st_items
       set data       = jsonb_set(data, '{bom}', v_bom),
           updated_at = now(),
           updated_by = 'corregir-etiquetas-2026-09-30'
     where categoria = 'producto' and codigo = r.producto;

    insert into public.st_movimientos
      (id, fecha, tipo, categoria, codigo, nombre, cantidad, nota, componentes, usuario, origen)
    values (
      'etq-2026-09-30-' || r.producto, now(), 'edicion', 'producto', r.producto, v_prod, 0,
      'receta: etiqueta ' || v_cambio || ' (' || r.motivo || ')',
      '[]'::jsonb, 'corregir-etiquetas-2026-09-30', 'plataforma'
    )
    on conflict (id) do nothing;

    insert into st_tmp_resultado values (r.orden, r.producto, v_cambio, 'corregido');
  end loop;

  -- 3) La ficha de ETQ.ENT-7 decía 50 gr y es la de 100 gr
  update public.st_items
     set data       = jsonb_set(data, '{presentacion}', '"100 gr"'),
         updated_at = now(),
         updated_by = 'corregir-etiquetas-2026-09-30'
   where categoria = 'etiqueta'
     and codigo = 'ETQ.ENT-7'
     and nombre ilike '%100%gr%'
     and data ->> 'presentacion' = '50 gr';
  if found then
    insert into public.st_movimientos
      (id, fecha, tipo, categoria, codigo, nombre, cantidad, nota, componentes, usuario, origen)
    select 'etq-2026-09-30-ETQ.ENT-7', now(), 'edicion', 'etiqueta', codigo, nombre, 0,
           'presentación: 50 gr → 100 gr (el nombre y el producto ENT-01 son de 100 g)',
           '[]'::jsonb, 'corregir-etiquetas-2026-09-30', 'plataforma'
      from public.st_items where categoria = 'etiqueta' and codigo = 'ETQ.ENT-7'
    on conflict (id) do nothing;
    insert into st_tmp_resultado values (99, 'ETQ.ENT-7', 'presentación 50 gr → 100 gr', 'corregido');
  else
    insert into st_tmp_resultado values (99, 'ETQ.ENT-7', 'presentación 50 gr → 100 gr', 'ya estaba corregido o cambió');
  end if;
end $$;

-- Resumen: "corregido", "ya estaba corregido" o "SALTEADO: …" (revisar a mano)
select producto, cambio, resultado from st_tmp_resultado order by orden;

commit;

-- Control: la etiqueta que descuenta hoy cada producto tocado
select p.codigo, p.nombre, p.data ->> 'presentacion' as presentacion,
       e.codigo as etiqueta, e.nombre as etiqueta_nombre, e.data ->> 'presentacion' as etiqueta_tamano
  from public.st_items p
  cross join lateral jsonb_array_elements(p.data -> 'bom') b
  join public.st_items e on e.categoria = 'etiqueta' and e.codigo = b ->> 'codigo'
 where p.categoria = 'producto'
   and b ->> 'categoria' = 'etiqueta'
   and p.codigo in ('POL-23','POL-24','POL-25','POL-26','POL-27','POL-28','POL-30','POL-31',
                    'POL-33','POL-34','POL-36','POL-37','POL-38','CAP-15','CAP-17',
                    'EXT-04','EXT-14','EXT-18','ENT-01')
 order by p.codigo;
