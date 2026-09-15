-- =====================================================================
-- Somos Setas — puente tienda <-> inventario + alta de Creatina
-- Generado el 2026-09-15 leyendo los datos VIVOS de ss_store.products y st_items.
--
-- QUÉ ARREGLA
--   1. El mapa st_sku_map. El fix del 2026-08-27 nunca se corrió en producción:
--      las 103 filas siguen con updated_at del 2026-08-11 y ninguna desactivada,
--      así que los 64 vínculos cruzados siguen vivos y cada pedido de la tienda
--      descuenta el ítem de al lado. Re-verificado hoy contra los datos vivos:
--      los 114 vínculos apuntan a ítems que existen (0 rotos, 0 claves repetidas).
--   2. La Creatina, que se vende en la tienda y no tenía producto en el
--      inventario: sus ventas venían descontando magnesio (POL-37 y POL-38,
--      hoy en -21 y -29).
--   3. Bisglicinato en cápsulas, que descontaba CAP-32 Malato de Magnesio.
--      El mapeo del 27/08 lo mandaba a CAP-30 Glicinato porque el ítem propio
--      todavía no existía; CAP-36 "Bisglisinato de magnesio" se dio de alta el
--      2026-09-12, así que ahora cada uno tiene el suyo.
--
-- CÓMO CORRERLO
--   Entero, en el SQL Editor de Supabase. Es idempotente: se puede correr dos
--   veces sin duplicar nada. NO pisa el stock (`actual`) de ningún ítem que ya
--   exista, solo crea los que faltan.
--
-- OJO: al generarlo había gente trabajando en la plataforma (15 ítems tocados
-- hoy entre las 12:12 y las 14:24). Conviene correrlo en un momento tranquilo y
-- avisar, porque cambia qué se descuenta en cada venta.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1. VÍNCULOS CORRECTOS (114 presentaciones)
--    Mapeo derivado el 2026-08-27 leyendo datos vivos, re-verificado hoy.
-- ---------------------------------------------------------------------
insert into public.st_sku_map
  (producto_id, pres_id, categoria, codigo, unidades, activo, revisar, etiqueta, updated_at, updated_by)
values
  ('melena-de-leon', 'gotas', 'producto', 'EXT-09', 1, true, false, 'Melena de León — Extracto en gotas — 60 ml', now(), 'fix-2026-09-15'),  -- EXT-09 Melena de León  [ok]
  ('melena-de-leon', 'polvo', 'producto', 'POL-06', 1, true, false, 'Melena de León — Polvo micronizado — 30 gr', now(), 'fix-2026-09-15'),  -- POL-06 Melena de León  [CORREGIDO, antes POL-04]
  ('melena-de-leon', 'caps', 'producto', 'CAP-06', 1, true, false, 'Melena de León — Cápsulas — 60u × 500 mg', now(), 'fix-2026-09-15'),  -- CAP-06 Melena de León  [CORREGIDO, antes CAP-04]
  ('cordyceps', 'gotas', 'producto', 'EXT-06', 1, true, false, 'Cordyceps — Extracto en gotas — 60 ml', now(), 'fix-2026-09-15'),  -- EXT-06 Cordyceps  [ok]
  ('cordyceps', 'polvo', 'producto', 'POL-04', 1, true, false, 'Cordyceps — Polvo micronizado — 30 gr', now(), 'fix-2026-09-15'),  -- POL-04 Cordyceps  [NUEVO]
  ('cordyceps', 'caps', 'producto', 'CAP-04', 1, true, false, 'Cordyceps — Cápsulas — 60u × 500 mg', now(), 'fix-2026-09-15'),  -- CAP-04 Cordyceps  [NUEVO]
  ('maitake', 'gotas', 'producto', 'EXT-08', 1, true, false, 'Maitake — Extracto en gotas — 60 ml', now(), 'fix-2026-09-15'),  -- EXT-08 Maitake  [ok]
  ('maitake', 'polvo', 'producto', 'POL-05', 1, true, false, 'Maitake — Polvo micronizado — 30 gr', now(), 'fix-2026-09-15'),  -- POL-05 Maitake  [CORREGIDO, antes POL-03]
  ('maitake', 'caps', 'producto', 'CAP-05', 1, true, false, 'Maitake — Cápsulas — 60u × 500 mg', now(), 'fix-2026-09-15'),  -- CAP-05 Maitake  [CORREGIDO, antes CAP-03]
  ('reishi', 'gotas', 'producto', 'EXT-10', 1, true, false, 'Reishi — Extracto en gotas — 60 ml', now(), 'fix-2026-09-15'),  -- EXT-10 Reishi  [ok]
  ('reishi', 'polvo', 'producto', 'POL-07', 1, true, false, 'Reishi — Polvo micronizado — 30 gr', now(), 'fix-2026-09-15'),  -- POL-07 Reishi  [CORREGIDO, antes POL-05]
  ('reishi', 'caps', 'producto', 'CAP-07', 1, true, false, 'Reishi — Cápsulas — 60u × 500 mg', now(), 'fix-2026-09-15'),  -- CAP-07 Reishi  [CORREGIDO, antes CAP-05]
  ('ashwagandha', 'gotas', 'producto', 'EXT-01', 1, true, false, 'Ashwagandha — Extracto en gotas — 60 ml', now(), 'fix-2026-09-15'),  -- EXT-01 Ashwagandha  [ok]
  ('ashwagandha', 'polvo', 'producto', 'POL-01', 1, true, false, 'Ashwagandha — Polvo micronizado — 30 gr', now(), 'fix-2026-09-15'),  -- POL-01 Ashwagandha  [ok]
  ('ashwagandha', 'caps', 'producto', 'CAP-01', 1, true, false, 'Ashwagandha — Cápsulas — 60u × 500 mg', now(), 'fix-2026-09-15'),  -- CAP-01 Ashwagandha  [ok]
  ('tremella', 'gotas', 'producto', 'EXT-14', 1, true, false, 'Tremella — Extracto en gotas — 60 ml', now(), 'fix-2026-09-15'),  -- EXT-14 Tremella  [ok]
  ('tremella', 'polvo', 'producto', 'POL-11', 1, true, false, 'Tremella — Polvo micronizado — 30 gr', now(), 'fix-2026-09-15'),  -- POL-11 Tremella  [CORREGIDO, antes POL-09]
  ('tremella', 'caps', 'producto', 'CAP-11', 1, true, false, 'Tremella — Cápsulas — 60u × 500 mg', now(), 'fix-2026-09-15'),  -- CAP-11 Tremella  [CORREGIDO, antes CAP-09]
  ('shiitake', 'gotas', 'producto', 'EXT-13', 1, true, false, 'Shiitake — Extracto en gotas — 60 ml', now(), 'fix-2026-09-15'),  -- EXT-13 Shitake  [ok]
  ('shiitake', 'polvo', 'producto', 'POL-10', 1, true, false, 'Shiitake — Polvo micronizado — 30 gr', now(), 'fix-2026-09-15'),  -- POL-10 Shitake  [CORREGIDO, antes POL-08]
  ('shiitake', 'caps', 'producto', 'CAP-10', 1, true, false, 'Shiitake — Cápsulas — 60u × 500 mg', now(), 'fix-2026-09-15'),  -- CAP-10 Shitake cápsulas  [CORREGIDO, antes CAP-08]
  ('cola-de-pavo', 'gotas', 'producto', 'EXT-05', 1, true, false, 'Cola de Pavo — Extracto en gotas — 60 ml', now(), 'fix-2026-09-15'),  -- EXT-05 Cola de Pavo  [ok]
  ('cola-de-pavo', 'polvo', 'producto', 'POL-03', 1, true, false, 'Cola de Pavo — Polvo micronizado — 30 gr', now(), 'fix-2026-09-15'),  -- POL-03 Cola de Pavo  [NUEVO]
  ('cola-de-pavo', 'caps', 'producto', 'CAP-03', 1, true, false, 'Cola de Pavo — Cápsulas — 60u × 500 mg', now(), 'fix-2026-09-15'),  -- CAP-03 Cola de Pavo  [NUEVO]
  ('rhodiola-rosea', 'gotas', 'producto', 'EXT-11', 1, true, false, 'Rhodiola Rosea — Extracto en gotas — 60 ml', now(), 'fix-2026-09-15'),  -- EXT-11 Rhodiola Rosea  [ok]
  ('rhodiola-rosea', 'polvo', 'producto', 'POL-08', 1, true, false, 'Rhodiola Rosea — Polvo micronizado — 30 gr', now(), 'fix-2026-09-15'),  -- POL-08 Rhoriola Rosea  [CORREGIDO, antes POL-06]
  ('rhodiola-rosea', 'caps', 'producto', 'CAP-08', 1, true, false, 'Rhodiola Rosea — Cápsulas — 60u × 500 mg', now(), 'fix-2026-09-15'),  -- CAP-08 Rhodiola  [CORREGIDO, antes CAP-06]
  ('schisandra', 'gotas', 'producto', 'EXT-12', 1, true, false, 'Schisandra — Extracto en gotas — 60 ml', now(), 'fix-2026-09-15'),  -- EXT-12 Schisandra  [ok]
  ('schisandra', 'polvo', 'producto', 'POL-09', 1, true, false, 'Schisandra — Polvo micronizado — 30 gr', now(), 'fix-2026-09-15'),  -- POL-09 Schisandra  [CORREGIDO, antes POL-07]
  ('schisandra', 'caps', 'producto', 'CAP-09', 1, true, false, 'Schisandra — Cápsulas — 60u × 500 mg', now(), 'fix-2026-09-15'),  -- CAP-09 Schisandra  [CORREGIDO, antes CAP-07]
  ('chaga', 'gotas', 'producto', 'EXT-04', 1, true, false, 'Chaga — Extracto en gotas — 60 ml', now(), 'fix-2026-09-15'),  -- EXT-04 Chaga  [ok]
  ('chaga', 'polvo', 'producto', 'POL-02', 1, true, false, 'Chaga — Polvo micronizado — 30 gr', now(), 'fix-2026-09-15'),  -- POL-02 Chaga  [ok]
  ('chaga', 'caps', 'producto', 'CAP-02', 1, true, false, 'Chaga — Cápsulas — 60u × 500 mg', now(), 'fix-2026-09-15'),  -- CAP-02 Chaga  [ok]
  ('melena-reishi', 'gotas', 'producto', 'EXT-15', 1, true, false, 'Melena de León + Reishi — Extracto en gotas — 60 ml', now(), 'fix-2026-09-15'),  -- EXT-15 Melena + Reishi  [ok]
  ('melena-reishi', 'polvo', 'producto', 'POL-12', 1, true, false, 'Melena de León + Reishi — Polvo micronizado — 30 gr', now(), 'fix-2026-09-15'),  -- POL-12 Melena de león + Reishi  [CORREGIDO, antes POL-10]
  ('melena-reishi', 'caps', 'producto', 'CAP-12', 1, true, false, 'Melena de León + Reishi — Cápsulas — 60u × 500 mg', now(), 'fix-2026-09-15'),  -- CAP-12 Melena de León + Reishi cápsulas  [CORREGIDO, antes CAP-10]
  ('melena-ashwagandha', 'gotas', 'producto', 'EXT-17', 1, true, false, 'Melena de León + Ashwagandha — Extracto en gotas — 60 ml', now(), 'fix-2026-09-15'),  -- EXT-17 Melena + Ashwagandha  [ok]
  ('melena-ashwagandha', 'polvo', 'producto', 'POL-13', 1, true, false, 'Melena de León + Ashwagandha — Polvo micronizado — 30 gr', now(), 'fix-2026-09-15'),  -- POL-13 Melena de león + Ashwagandha  [CORREGIDO, antes POL-11]
  ('melena-ashwagandha', 'caps', 'producto', 'CAP-14', 1, true, false, 'Melena de León + Ashwagandha — Cápsulas — 60u × 500 mg', now(), 'fix-2026-09-15'),  -- CAP-14 Melena de león + Ashwaganda  [CORREGIDO, antes CAP-12]
  ('melena-cordyceps', 'gotas', 'producto', 'EXT-16', 1, true, false, 'Melena de León + Cordyceps — Extracto en gotas — 60 ml', now(), 'fix-2026-09-15'),  -- EXT-16 Melena + Cordyceps  [ok]
  ('melena-cordyceps', 'polvo', 'producto', 'POL-14', 1, true, false, 'Melena de León + Cordyceps — Polvo micronizado — 30 gr', now(), 'fix-2026-09-15'),  -- POL-14 Melena de león + Cordyceps  [CORREGIDO, antes POL-12]
  ('melena-cordyceps', 'caps', 'producto', 'CAP-13', 1, true, false, 'Melena de León + Cordyceps — Cápsulas — 60u × 500 mg', now(), 'fix-2026-09-15'),  -- CAP-13 Melena de león + Cordyceps  [CORREGIDO, antes CAP-11]
  ('melena-de-leon', 'desh', 'producto', 'ENT-05', 1, true, false, 'Melena de León — Setas enteras deshidratadas — Doy pack', now(), 'fix-2026-09-15'),  -- ENT-05 Melena de León  [ok]
  ('melena-de-leon', 'desh-1kg', 'producto', 'ENT-05', 1, true, true , 'Melena de León — Entera deshidratada — 1 kg', now(), 'fix-2026-09-15'),  -- ENT-05 Melena de León  [NUEVO]
  ('cordyceps', 'desh', 'producto', 'ENT-01', 1, true, false, 'Cordyceps — Setas enteras deshidratadas — Doy pack', now(), 'fix-2026-09-15'),  -- ENT-01 Cordyceps Entero  [ok]
  ('cordyceps', 'desh-1kg', 'producto', 'ENT-01', 1, true, true , 'Cordyceps — Entero deshidratado — 1 kg', now(), 'fix-2026-09-15'),  -- ENT-01 Cordyceps Entero  [NUEVO]
  ('maitake', 'desh', 'producto', 'ENT-04', 1, true, false, 'Maitake — Setas enteras deshidratadas — Doy pack', now(), 'fix-2026-09-15'),  -- ENT-04 Maitake  [ok]
  ('shiitake', 'desh', 'producto', 'ENT-06', 1, true, true , 'Shiitake — Setas enteras y laminadas deshidratadas — Doy pack', now(), 'fix-2026-09-15'),  -- ENT-06 Shitake Laminado  [ok]
  ('shiitake', 'laminado-50g', 'producto', 'ENT-06', 1, true, false, 'Shiitake — Laminado deshidratado — 50 g', now(), 'fix-2026-09-15'),  -- ENT-06 Shitake Laminado  [ok]
  ('shiitake', 'laminado-1kg', 'producto', 'ENT-06', 1, true, true , 'Shiitake — Laminado deshidratado — 1 kg', now(), 'fix-2026-09-15'),  -- ENT-06 Shitake Laminado  [NUEVO]
  ('shiitake', 'entero-1kg', 'producto', 'ENT-07', 1, true, true , 'Shiitake — Entero deshidratado — 1 kg', now(), 'fix-2026-09-15'),  -- ENT-07 Shitake Setas Entero  [NUEVO]
  ('tremella', 'desh-1kg', 'producto', 'ENT-08', 1, true, false, 'Tremella — Entera deshidratada — 1 kg', now(), 'fix-2026-09-15'),  -- ENT-08 Tremella Entera  [ok]
  ('hongo-de-pino-entero', 'enteros', 'producto', 'ENT-03', 1, true, false, 'Hongo de pino Entero — Hongos Enteros — 100 g', now(), 'fix-2026-09-15'),  -- ENT-03 Hongos de Pino  [ok]
  ('hongo-de-pino-entero', 'xkg', 'producto', 'ENT-03', 1, true, true , 'Hongo de pino Entero — Hongos Enteros — 1kg', now(), 'fix-2026-09-15'),  -- ENT-03 Hongos de Pino  [NUEVO]
  ('girgola-disecadas', 'enteros', 'producto', 'ENT-02', 1, true, false, 'Hongos Girgolas Disecadas — Hongos disecados — 50 g', now(), 'fix-2026-09-15'),  -- ENT-02 Girgolas  [ok]
  ('girgola-disecadas', 'xkg', 'producto', 'ENT-02', 1, true, true , 'Hongos Girgolas Disecadas — Hongos deshidratados — 1kg', now(), 'fix-2026-09-15'),  -- ENT-02 Girgolas  [NUEVO]
  ('aceite-de-cannabis', 'gotas', 'producto', 'ACE-01', 1, true, false, 'Aceite de Cannabis — 30ml en gotas — 60 ml', now(), 'fix-2026-09-15'),  -- ACE-01 Cannabis Medicinal  [NUEVO]
  ('aceite-clavo', '10ml', 'producto', 'ACE-02', 1, true, false, 'Aceite de Clavo de Olor — Frasco gotero — 30 ml', now(), 'fix-2026-09-15'),  -- ACE-02 Clavo de olor  [ok]
  ('aceite-curcuma', '10ml', 'producto', 'ACE-03', 1, true, false, 'Aceite de Cúrcuma + Pimienta Negra — Frasco gotero — 30 ml', now(), 'fix-2026-09-15'),  -- ACE-03 Curcuma + Pimienta Negra  [ok]
  ('aceite-lavanda', '10ml', 'producto', 'ACE-05', 1, true, false, 'Aceite de Lavanda — Frasco gotero — 30 ml', now(), 'fix-2026-09-15'),  -- ACE-05 Lavanda  [ok]
  ('aceite-menta', '10ml', 'producto', 'ACE-06', 1, true, false, 'Aceite de Menta — Frasco gotero — 30 ml', now(), 'fix-2026-09-15'),  -- ACE-06 Menta  [ok]
  ('aceite-oregano', '10ml', 'producto', 'ACE-07', 1, true, false, 'Aceite de Orégano — Frasco gotero — 30 ml', now(), 'fix-2026-09-15'),  -- ACE-07 Orégano  [ok]
  ('extracto-cardo-mariano', 'gotas', 'producto', 'EXT-03', 1, true, false, 'Cardo Mariano — Extracto en gotas — 60 ml', now(), 'fix-2026-09-15'),  -- EXT-03 Cardo Mariano  [ok]
  ('extracto-concentrado-amargon', 'gotas', 'producto', 'EXT-02', 1, true, false, 'Extracto concentrado Amargón — Extracto en gotas — 60 ml', now(), 'fix-2026-09-15'),  -- EXT-02 Amargon  [ok]
  ('extracto-concentrado-amargon-copia-mq63qyw5', 'gotas', 'producto', 'EXT-18', 1, true, false, 'Extracto concentrado Pasiflora — Extracto en gotas — 60 ml', now(), 'fix-2026-09-15'),  -- EXT-18 Pasiflora  [ok]
  ('flor-de-hibiscus', 'gotas', 'producto', 'EXT-07', 1, true, false, 'Flor de Hibiscus — Extracto en gotas — 60 ml', now(), 'fix-2026-09-15'),  -- EXT-07 Hibiscus  [ok]
  ('flor-de-hibiscus', 'caps', 'producto', 'CAP-23', 1, true, false, 'Flor de Hibiscus — Cápsulas x 500mg x 60 unidades', now(), 'fix-2026-09-15'),  -- CAP-23 Hibiscus Capsulas  [CORREGIDO, antes CAP-20]
  ('flor-de-hibiscus', 'pol', 'producto', 'POL-18', 1, true, false, 'Flor de Hibiscus — Polvo x 50g', now(), 'fix-2026-09-15'),  -- POL-18 HIBUSCUS/FLOR DE JAMAICA  [CORREGIDO, antes POL-16]
  ('cacao-amargo-melena-de-leon', 'Polvo ', 'producto', 'POL-15', 1, true, false, 'Cacao amargo + Melena de León — Polvo — 125 g', now(), 'fix-2026-09-15'),  -- POL-15 Cacao amargo con MELENA DE LEON  [CORREGIDO, antes POL-13]
  ('cacao-amargo-reishi', 'polvo', 'producto', 'POL-16', 1, true, false, 'Cacao amargo + Reishi — Polvo — 125 g', now(), 'fix-2026-09-15'),  -- POL-16 Cacao amargo con REISHI  [CORREGIDO, antes POL-14]
  ('tremella-plus', 'caps', 'producto', 'CAP-15', 1, true, false, 'Tremella Plus — Cápsulas — 60u x 500 mg', now(), 'fix-2026-09-15'),  -- CAP-15 Tremella (Plus) + Colageno Hidrolizado+ Vit A,C y E  [CORREGIDO, antes CAP-13]
  ('caps-ajo-vitc', '60', 'producto', 'CAP-16', 1, true, false, 'Ajo + Vitamina C — 60 cápsulas × 500 mg', now(), 'fix-2026-09-15'),  -- CAP-16 Ajo + Vit C  [CORREGIDO, antes CAP-14]
  ('caps-curcuma-copia-mrjd6c1y', '60', 'producto', 'CAP-17', 1, true, false, 'Cúrcuma + Jengibre + Pimienta Negra — 60 cápsulas × 500 mg', now(), 'fix-2026-09-15'),  -- CAP-17 Curcuma + Jengibre + Pimienta + Vit c  [CORREGIDO, antes CAP-15]
  ('caps-curcuma', '60', 'producto', 'CAP-18', 1, true, false, 'Cúrcuma + Pimienta Negra — 60 cápsulas × 500 mg', now(), 'fix-2026-09-15'),  -- CAP-18 Curcuma + Pimienta negra  [CORREGIDO, antes CAP-16]
  ('caps-colageno-plus', '60', 'producto', 'CAP-19', 1, true, false, 'Colágeno Plus — 60 cápsulas × 500 mg', now(), 'fix-2026-09-15'),  -- CAP-19 Colágeno PLUS (Curcuma + P. Negra + Cart. Tiburon+ vit C y D3 + Citrato de Zinc)  [CORREGIDO, antes CAP-17]
  ('caps-colageno-hidrolizado', '60', 'producto', 'CAP-20', 1, true, false, 'Colágeno Hidrolizado — 60 cápsulas × 500 mg', now(), 'fix-2026-09-15'),  -- CAP-20 Colágeno Hidrolizado tipo I y III + Vitamina C  [CORREGIDO, antes CAP-18]
  ('caps-vitc', '60', 'producto', 'CAP-21', 1, true, false, 'Vitamina C — 60 cápsulas × 500 mg', now(), 'fix-2026-09-15'),  -- CAP-21 Vitamina C  [CORREGIDO, antes CAP-19]
  ('caps-palo-negro', '90', 'producto', 'CAP-22', 1, true, false, 'Palo Negro Chileno — 90 cápsulas × 150 mg', now(), 'fix-2026-09-15'),  -- CAP-22 Palo Negro Chileno  [NUEVO]
  ('caps-hibiscus', '60', 'producto', 'CAP-23', 1, true, true , 'Hibiscus — 60 cápsulas × 500 mg', now(), 'fix-2026-09-15'),  -- CAP-23 Hibiscus Capsulas  [CORREGIDO, antes CAP-20]
  ('caps-cardo-mariano', '60', 'producto', 'CAP-24', 1, true, false, 'Cardo Mariano — 60 cápsulas × 500 mg', now(), 'fix-2026-09-15'),  -- CAP-24 Cardo Mariano  [CORREGIDO, antes CAP-21]
  ('caps-cartilago-tiburon', '60', 'producto', 'CAP-25', 1, true, false, 'Cartílago de Tiburón — 60 cápsulas × 500 mg', now(), 'fix-2026-09-15'),  -- CAP-25 Cartilago de Tiburon  [CORREGIDO, antes CAP-22]
  ('caps-triple-mag', '60', 'producto', 'CAP-26', 1, true, false, 'Triple Magnesio — 60 cápsulas × 500 mg', now(), 'fix-2026-09-15'),  -- CAP-26 Triple MAGNESIO ( Citrato+ Malato+ Glisinato)  [CORREGIDO, antes CAP-23]
  ('caps-mag-potasio', '60', 'producto', 'CAP-27', 1, true, false, 'Magnesio + Potasio — 60 cápsulas × 500 mg', now(), 'fix-2026-09-15'),  -- CAP-27 MAGNESIO + POTASIO (Citratos)  [CORREGIDO, antes CAP-24]
  ('caps-citrato-potasio', '60', 'producto', 'CAP-28', 1, true, false, 'Citrato de Potasio — 60 cápsulas × 500 mg', now(), 'fix-2026-09-15'),  -- CAP-28 Citrato de POTASIO  [CORREGIDO, antes CAP-25]
  ('caps-citrato-mag', '60', 'producto', 'CAP-29', 1, true, false, 'Citrato de Magnesio — 60 cápsulas × 500 mg', now(), 'fix-2026-09-15'),  -- CAP-29 Citrato de MAGNESIO  [CORREGIDO, antes CAP-26]
  ('caps-glicinato-mag', '60', 'producto', 'CAP-30', 1, true, false, 'Glicinato de Magnesio — 60 cápsulas × 500 mg', now(), 'fix-2026-09-15'),  -- CAP-30 Glicinato de MAGNESIO  [CORREGIDO, antes CAP-27]
  ('caps-zeolita', '60', 'producto', 'CAP-31', 1, true, false, 'Zeolita — 60 cápsulas × 500 mg', now(), 'fix-2026-09-15'),  -- CAP-31 Zeolita  [CORREGIDO, antes CAP-28]
  ('caps-malato-mag', '60', 'producto', 'CAP-32', 1, true, false, 'Malato de Magnesio — 60 cápsulas × 500 mg', now(), 'fix-2026-09-15'),  -- CAP-32 Malato de MAGNESIO  [CORREGIDO, antes CAP-29]
  ('caps-maca', '60', 'producto', 'CAP-33', 1, true, false, 'Maca — 60 cápsulas × 500 mg', now(), 'fix-2026-09-15'),  -- CAP-33 Maca  [CORREGIDO, antes CAP-30]
  ('bisglicinato', 'Cáps', 'producto', 'CAP-36', 1, true, false, 'Bisglicinato de magnesio — Cápsulas 60u x 500 mg', now(), 'fix-2026-09-15'),  -- CAP-36 Bisglisinato de magnesio  [CORREGIDO 2026-09-15: apuntaba a CAP-30 Glicinato, que ahora queda solo para caps-glicinato-mag]
  ('polvo-vitc', '50g', 'producto', 'POL-17', 1, true, false, 'Vitamina C — Polvo — Envase 50 g', now(), 'fix-2026-09-15'),  -- POL-17 VITAMINA C  [CORREGIDO, antes POL-15]
  ('polvo-vitc', '1kg', 'producto', 'POL-41', 1, true, false, 'Vitamina C — Polvo — Envase 1 kg', now(), 'fix-2026-09-15'),  -- POL-41 Vitamina C  [NUEVO]
  ('polvo-citrato-potasio', '50g', 'producto', 'POL-19', 1, true, false, 'Citrato de Potasio — Polvo — Envase 50 g', now(), 'fix-2026-09-15'),  -- POL-19 Citrato de POTASIO  [CORREGIDO, antes POL-17]
  ('polvo-citrato-potasio', '100g', 'producto', 'POL-25', 1, true, false, 'Citrato de Potasio — Polvo — Envase 100 g', now(), 'fix-2026-09-15'),  -- POL-25 Citrato de POTASIO  [CORREGIDO, antes POL-23]
  ('polvo-citrato-potasio', '500g', 'producto', 'POL-32', 1, true, false, 'Citrato de Potasio — Polvo — Envase 500 g', now(), 'fix-2026-09-15'),  -- POL-32 Citrato de POTASIO  [CORREGIDO, antes POL-30]
  ('polvo-citrato-potasio', '1kg', 'producto', 'POL-36', 1, true, false, 'Citrato de Potasio — Polvo — Envase 1 kg', now(), 'fix-2026-09-15'),  -- POL-36 Citrato de POTASIO  [CORREGIDO, antes POL-34]
  ('polvo-citrato-mag', '50g', 'producto', 'POL-20', 1, true, false, 'Citrato de Magnesio — Polvo — Envase 50 g', now(), 'fix-2026-09-15'),  -- POL-20 Citrato de MAGNESIO  [CORREGIDO, antes POL-18]
  ('polvo-citrato-mag', '100g', 'producto', 'POL-26', 1, true, false, 'Citrato de Magnesio — Polvo — Envase 100 g', now(), 'fix-2026-09-15'),  -- POL-26 Citrato de MAGNESIO  [CORREGIDO, antes POL-24]
  ('polvo-citrato-mag', '500g', 'producto', 'POL-31', 1, true, false, 'Citrato de Magnesio — Polvo — Envase 500 g', now(), 'fix-2026-09-15'),  -- POL-31 Citrato de MAGNESIO  [CORREGIDO, antes POL-29]
  ('polvo-citrato-mag', '1kg', 'producto', 'POL-35', 1, true, false, 'Citrato de Magnesio — Polvo — Envase 1 kg', now(), 'fix-2026-09-15'),  -- POL-35 Citrato de MAGNESIO  [CORREGIDO, antes POL-33]
  ('polvo-glicinato-mag', '50g', 'producto', 'POL-21', 1, true, false, 'Glicinato de Magnesio — Polvo — Envase 50 g', now(), 'fix-2026-09-15'),  -- POL-21 Glicinato de MAGNESIO  [CORREGIDO, antes POL-19]
  ('polvo-glicinato-mag', '100g', 'producto', 'POL-27', 1, true, false, 'Glicinato de Magnesio — Polvo — Envase 100 g', now(), 'fix-2026-09-15'),  -- POL-27 Glicinato de MAGNESIO  [CORREGIDO, antes POL-25]
  ('polvo-glicinato-mag', '500g', 'producto', 'POL-33', 1, true, false, 'Glicinato de Magnesio — Polvo — Envase 500 g', now(), 'fix-2026-09-15'),  -- POL-33 Glicinato de MAGNESIO  [CORREGIDO, antes POL-31]
  ('polvo-glicinato-mag', '1kg', 'producto', 'POL-37', 1, true, false, 'Glicinato de Magnesio — Polvo — Envase 1 kg', now(), 'fix-2026-09-15'),  -- POL-37 Glicinato de MAGNESIO  [CORREGIDO, antes POL-35]
  ('polvo-malato-mag', '50g', 'producto', 'POL-22', 1, true, false, 'Malato de Magnesio — Polvo — Envase 50 g', now(), 'fix-2026-09-15'),  -- POL-22 Malato de MAGNESIO  [CORREGIDO, antes POL-20]
  ('polvo-malato-mag', '100g', 'producto', 'POL-28', 1, true, false, 'Malato de Magnesio — Polvo — Envase 100 g', now(), 'fix-2026-09-15'),  -- POL-28 Malato de MAGNESIO  [CORREGIDO, antes POL-26]
  ('polvo-malato-mag', '500g', 'producto', 'POL-34', 1, true, false, 'Malato de Magnesio — Polvo — Envase 500 g', now(), 'fix-2026-09-15'),  -- POL-34 Malato de MAGNESIO  [CORREGIDO, antes POL-32]
  ('polvo-malato-mag', '1kg', 'producto', 'POL-38', 1, true, false, 'Malato de Magnesio — Polvo — Envase 1 kg', now(), 'fix-2026-09-15'),  -- POL-38 Malato de MAGNESIO  [CORREGIDO, antes POL-36]
  ('polvo-citrato-mag-potasio', '50g', 'producto', 'POL-23', 1, true, false, 'Citrato de Magnesio + Potasio — Polvo — Envase 50 g', now(), 'fix-2026-09-15'),  -- POL-23 Citrato de MAGNESIO + POTASIO POLVO  [CORREGIDO, antes POL-21]
  ('polvo-citrato-mag-potasio', '100g', 'producto', 'POL-29', 1, true, false, 'Citrato de Magnesio + Potasio — Polvo — Envase 100 g', now(), 'fix-2026-09-15'),  -- POL-29 Citrato de MAGNESIO + POTASIO POLVO  [CORREGIDO, antes POL-27]
  ('polvo-triple-mag', '50g', 'producto', 'POL-24', 1, true, false, 'Triple Magnesio — Polvo — Envase 50 g', now(), 'fix-2026-09-15'),  -- POL-24 Triple MAGNESIO  [CORREGIDO, antes POL-22]
  ('polvo-triple-mag', '100g', 'producto', 'POL-30', 1, true, false, 'Triple Magnesio — Polvo — Envase 100 g', now(), 'fix-2026-09-15'),  -- POL-30 Triple MAGNESIO ( Citrato+ Malato+ Glicinato)  [CORREGIDO, antes POL-28]
  ('polvo-remolacha', '1kg', 'producto', 'POL- 39', 1, true, false, 'Remolacha — Polvo — Envase 1 kg', now(), 'fix-2026-09-15'),  -- POL- 39 Remolacha  [NUEVO]
  ('polvo-bicarbonato', '1kg', 'producto', 'POL-40', 1, true, false, 'Bicarbonato de Sodio — Envase 1 kg', now(), 'fix-2026-09-15')  -- POL-40 Bicarbonato de Sodio  [NUEVO]
on conflict (producto_id, pres_id) do update set
  categoria  = excluded.categoria,
  codigo     = excluded.codigo,
  unidades   = excluded.unidades,
  activo     = excluded.activo,
  revisar    = excluded.revisar,
  etiqueta   = excluded.etiqueta,
  updated_at = now(),
  updated_by = excluded.updated_by;


-- ---------------------------------------------------------------------
-- 2. ALTA DE LA CREATINA COMO PRODUCTO
--
--    La tienda vende 4 tamaños (150 g, 300 g, 500 g y 1 kg) pero en el
--    inventario solo existen las etiquetas de 150 g y 300 g:
--       ETQ-POL-2  CREATINA  150 g  (26 u)
--       ETQ-POL-1  CREATINA  300 g  (40 u)
--    Por eso se dan de alta solo esos dos. Los de 500 g y 1 kg quedan sin
--    vincular más abajo, para que no descuenten nada equivocado.
--
--    La receta sigue la convención del resto del sistema: 1 etiqueta +
--    1 bolsa + 1 materia prima, SIN gramaje. Los 4 glicinatos (50 g, 100 g,
--    500 g, 1 kg) tienen exactamente la misma receta entre sí, así que el BOM
--    acá no representa kilos consumidos: es la unidad de armado.
--
--    `actual` arranca en 0 a propósito: nunca se contó creatina terminada en
--    la plataforma. Hay que hacer un conteo físico y cargarlo con "Fijar
--    actual". Si el script se vuelve a correr, el stock NO se pisa.
-- ---------------------------------------------------------------------
insert into public.st_items (categoria, codigo, nombre, actual, minimo, data, updated_at, updated_by)
values
  ('producto', 'POL-42', 'Creatina Monohidrato', 0, 2,
   '{"bom": [{"codigo": "ETQ-POL-2", "cantidad": 1, "categoria": "etiqueta"},
             {"codigo": "INS-18", "cantidad": 1, "categoria": "insumo"},
             {"codigo": "MP-61", "cantidad": 1, "categoria": "materia_prima"}],
     "tipo": "Polvo", "presentacion": "Bolsa 150g"}'::jsonb,
   now(), 'fix-2026-09-15'),
  ('producto', 'POL-43', 'Creatina Monohidrato', 0, 2,
   '{"bom": [{"codigo": "ETQ-POL-1", "cantidad": 1, "categoria": "etiqueta"},
             {"codigo": "INS-18", "cantidad": 1, "categoria": "insumo"},
             {"codigo": "MP-61", "cantidad": 1, "categoria": "materia_prima"}],
     "tipo": "Polvo", "presentacion": "Bolsa 300g"}'::jsonb,
   now(), 'fix-2026-09-15')
on conflict (categoria, codigo) do update set
  nombre     = excluded.nombre,
  minimo     = excluded.minimo,
  data       = excluded.data,
  updated_at = now(),
  updated_by = excluded.updated_by;
  -- `actual` queda deliberadamente afuera: correr esto de nuevo no pisa el stock.


-- ---------------------------------------------------------------------
-- 3. VÍNCULOS DE LA CREATINA
--    150 g y 300 g quedan vinculados a los ítems recién creados.
--    500 g y 1 kg entran desactivados: hoy no tienen ni siquiera fila en el
--    mapa, así que no descuentan nada; dejándolos como fila apagada aparecen
--    en Pedidos → "Vínculo con la tienda" como pendientes, en vez de ser
--    invisibles. Apuntan a POL-44 y POL-45, los códigos que les corresponderían:
--    el día que se creen esos ítems alcanza con poner activo = true.
-- ---------------------------------------------------------------------
insert into public.st_sku_map
  (producto_id, pres_id, categoria, codigo, unidades, activo, revisar, etiqueta, updated_at, updated_by)
values
  ('creatina-monohidrato', 'polvo',   'producto', 'POL-42', 1, true,  false, 'Creatina Monohidrato — Envase 150 g', now(), 'fix-2026-09-15'),
  ('creatina-monohidrato', 'polvo-2', 'producto', 'POL-43', 1, true,  false, 'Creatina Monohidrato — Envase 300 g', now(), 'fix-2026-09-15'),
  ('creatina-monohidrato', 'polvo-3', 'producto', 'POL-44', 1, false, true,  'SIN VINCULAR — falta crear POL-44 (500 g) y su etiqueta. Activar recién cuando exista', now(), 'fix-2026-09-15'),
  ('creatina-monohidrato', 'polvo-4', 'producto', 'POL-45', 1, false, true,  'SIN VINCULAR — falta crear POL-45 (1 kg) y su etiqueta. Activar recién cuando exista', now(), 'fix-2026-09-15')
on conflict (producto_id, pres_id) do update set
  categoria  = excluded.categoria,
  codigo     = excluded.codigo,
  unidades   = excluded.unidades,
  activo     = excluded.activo,
  revisar    = excluded.revisar,
  etiqueta   = excluded.etiqueta,
  updated_at = now(),
  updated_by = excluded.updated_by;


-- ---------------------------------------------------------------------
-- 4. VÍNCULOS QUE HAY QUE APAGAR
--    Apuntaban a un ítem equivocado y el ítem correcto no existe.
-- ---------------------------------------------------------------------
update public.st_sku_map set activo = false, revisar = true,
  etiqueta = 'SIN VINCULAR — descontaba CAP-31 Zeolita. Falta dar de alta la Espirulina como producto',
  updated_at = now(), updated_by = 'fix-2026-09-15'
 where producto_id = 'caps-espirulina' and pres_id = '60';

update public.st_sku_map set activo = false, revisar = true,
  etiqueta = 'SIN VINCULAR — apunta a ACE-04, que no existe en st_items. El producto está oculto en la tienda',
  updated_at = now(), updated_by = 'fix-2026-09-15'
 where producto_id = 'aceite-hibiscus' and pres_id = '10ml';

commit;


-- =====================================================================
-- CONTROLES — correr después y mirar los cuatro resultados
-- =====================================================================

-- A. Cuántas filas del mapa tocó el script. Debe dar 120.
select count(*) as filas_tocadas
  from public.st_sku_map where updated_by = 'fix-2026-09-15';

-- B. Vínculos activos que apuntan a un ítem inexistente. NO debe devolver filas.
select m.producto_id, m.pres_id, m.categoria, m.codigo
  from public.st_sku_map m
  left join public.st_items i on i.categoria = m.categoria and i.codigo = m.codigo
 where i.codigo is null and m.activo;

-- C. Cómo quedó la creatina.
select m.pres_id, m.codigo, m.activo, i.nombre, i.actual,
       i.data ->> 'presentacion' as presentacion
  from public.st_sku_map m
  left join public.st_items i on i.categoria = m.categoria and i.codigo = m.codigo
 where m.producto_id = 'creatina-monohidrato'
 order by m.pres_id;

-- D. Todo lo que queda marcado para revisar.
select producto_id, pres_id, codigo, activo, etiqueta
  from public.st_sku_map where revisar order by activo desc, producto_id;


-- =====================================================================
-- PENDIENTE — lo que este script NO resuelve, a propósito
-- =====================================================================
--
-- (a) EL STOCK EN NEGATIVO NO SE ARREGLA SOLO.
--     Corregir el mapa evita el error de acá en adelante, pero no deshace lo
--     que ya se descontó mal. POL-37 (-21), POL-38 (-29), CAP-16 (-29),
--     CAP-23 (-18), EXT-14 (-13) y varios más vienen de meses de ventas
--     descontando el ítem equivocado. La única salida es un conteo físico y
--     cargarlo con "Fijar actual", que no toca el BOM. No se puede calcular
--     desde los datos: no hay forma de saber cuánto de cada negativo es error
--     de mapeo y cuánto es faltante real.
--
-- (b) 12 PRESENTACIONES SIGUEN SIN DESCONTAR STOCK.
--     Hoy no tienen fila en el mapa, así que no descuentan nada (no hay daño
--     silencioso, pero tampoco control de stock). Falta el ítem en el
--     inventario:
--       reishi/Desh-500, reishi/Desh-1KG    (no hay ningún ENT- de Reishi)
--       tremella/gel250, gel500, gel1k      (GEL-TREMELLA existe pero como ETIQUETA)
--       tremella/desh-500g                  (ENT-08 Tremella Entera es de 1 kg)
--       melena-de-leon/desh-500             (ENT-05 es 75g/1kg)
--       cordyceps/desh-500G                 (ENT-01 es de 100 g)
--       shiitake/entero-500g                (ENT-07 es 75g/1kg)
--       polvo-vitc/500g                     (están el de 50 g y el de 1 kg)
--       polvo-remolacha/500g                (está el de 1 kg, POL- 39)
--       polvo-bicarbonato/500g              (está el de 1 kg, POL-40)
--
-- (c) CREATINA 500 g Y 1 kg. Para activarlas hay que dar de alta las etiquetas
--     (ETQ-POL-42 y ETQ-POL-43 están libres), crear POL-44 y POL-45, y
--     vincularlas. También confirmar si entran en la bolsa INS-18, que es 16x24.
--
-- (d) 7 ÍTEMS RECIBEN EL DESCUENTO DE 2 O 3 PRESENTACIONES DISTINTAS, porque un
--     mismo ítem cubre dos tamaños. Vender 1 kg descuenta lo mismo que vender
--     100 g. Se arregla con el campo `unidades` del mapa, pero primero hay que
--     saber en qué unidad está contado el stock de cada uno:
--       ENT-06 Shitake Laminado  <- shiitake/desh, /laminado-50g, /laminado-1kg
--       ENT-05 Melena de León    <- melena-de-leon/desh, /desh-1kg
--       ENT-01 Cordyceps Entero  <- cordyceps/desh, /desh-1kg
--       ENT-03 Hongos de Pino    <- hongo-de-pino-entero/enteros, /xkg
--       ENT-02 Girgolas          <- girgola-disecadas/enteros, /xkg
--       ENT-07 Shitake Entero    <- shiitake/enteros, /entero-1kg
--       CAP-23 Hibiscus Cápsulas <- flor-de-hibiscus/caps, caps-hibiscus/60
