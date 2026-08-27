-- Somos Setas — corrección del vínculo tienda ↔ inventario (st_sku_map)
-- Generado el 2026-08-27 leyendo los datos VIVOS de ss_store.products y st_items.
--
-- POR QUÉ: el mapa original se armó contra src/data/seed.ts, que tiene los códigos
-- corridos respecto de producción. Resultado: 64 de 103 vínculos apuntaban al ítem
-- equivocado, así que cada pedido de la tienda venía descontando el producto de al
-- lado. Ejemplos reales: vender Melena de León en cápsulas descontaba Cordyceps
-- (CAP-04 en vez de CAP-06); vender Creatina descontaba Glicinato de Magnesio 1 kg.
-- Es la causa de los stocks en negativo (CAP-27 -5, POL-37 -8, EXT-18 -6, etc.).
--
-- Correr entero en el SQL Editor de Supabase. Es idempotente.

begin;

-- ---------------------------------------------------------------
-- 1. Vínculos correctos (114 presentaciones)
--    35 ya estaban bien · 64 se corrigen · 15 son nuevos
-- ---------------------------------------------------------------
insert into public.st_sku_map
  (producto_id, pres_id, categoria, codigo, unidades, activo, revisar, etiqueta, updated_at, updated_by)
values
  ('melena-de-leon', 'gotas', 'producto', 'EXT-09', 1, true, false, 'Melena de León — Extracto en gotas — 60 ml', now(), 'fix-mapa-2026-08-27'),  -- EXT-09 Melena de León  [ok]
  ('melena-de-leon', 'polvo', 'producto', 'POL-06', 1, true, false, 'Melena de León — Polvo micronizado — 30 gr', now(), 'fix-mapa-2026-08-27'),  -- POL-06 Melena de León  [CORREGIDO, antes POL-04]
  ('melena-de-leon', 'caps', 'producto', 'CAP-06', 1, true, false, 'Melena de León — Cápsulas — 60u × 500 mg', now(), 'fix-mapa-2026-08-27'),  -- CAP-06 Melena de León  [CORREGIDO, antes CAP-04]
  ('cordyceps', 'gotas', 'producto', 'EXT-06', 1, true, false, 'Cordyceps — Extracto en gotas — 60 ml', now(), 'fix-mapa-2026-08-27'),  -- EXT-06 Cordyceps  [ok]
  ('cordyceps', 'polvo', 'producto', 'POL-04', 1, true, false, 'Cordyceps — Polvo micronizado — 30 gr', now(), 'fix-mapa-2026-08-27'),  -- POL-04 Cordyceps  [NUEVO]
  ('cordyceps', 'caps', 'producto', 'CAP-04', 1, true, false, 'Cordyceps — Cápsulas — 60u × 500 mg', now(), 'fix-mapa-2026-08-27'),  -- CAP-04 Cordyceps  [NUEVO]
  ('maitake', 'gotas', 'producto', 'EXT-08', 1, true, false, 'Maitake — Extracto en gotas — 60 ml', now(), 'fix-mapa-2026-08-27'),  -- EXT-08 Maitake  [ok]
  ('maitake', 'polvo', 'producto', 'POL-05', 1, true, false, 'Maitake — Polvo micronizado — 30 gr', now(), 'fix-mapa-2026-08-27'),  -- POL-05 Maitake  [CORREGIDO, antes POL-03]
  ('maitake', 'caps', 'producto', 'CAP-05', 1, true, false, 'Maitake — Cápsulas — 60u × 500 mg', now(), 'fix-mapa-2026-08-27'),  -- CAP-05 Maitake  [CORREGIDO, antes CAP-03]
  ('reishi', 'gotas', 'producto', 'EXT-10', 1, true, false, 'Reishi — Extracto en gotas — 60 ml', now(), 'fix-mapa-2026-08-27'),  -- EXT-10 Reishi  [ok]
  ('reishi', 'polvo', 'producto', 'POL-07', 1, true, false, 'Reishi — Polvo micronizado — 30 gr', now(), 'fix-mapa-2026-08-27'),  -- POL-07 Reishi  [CORREGIDO, antes POL-05]
  ('reishi', 'caps', 'producto', 'CAP-07', 1, true, false, 'Reishi — Cápsulas — 60u × 500 mg', now(), 'fix-mapa-2026-08-27'),  -- CAP-07 Reishi  [CORREGIDO, antes CAP-05]
  ('ashwagandha', 'gotas', 'producto', 'EXT-01', 1, true, false, 'Ashwagandha — Extracto en gotas — 60 ml', now(), 'fix-mapa-2026-08-27'),  -- EXT-01 Ashwagandha  [ok]
  ('ashwagandha', 'polvo', 'producto', 'POL-01', 1, true, false, 'Ashwagandha — Polvo micronizado — 30 gr', now(), 'fix-mapa-2026-08-27'),  -- POL-01 Ashwagandha  [ok]
  ('ashwagandha', 'caps', 'producto', 'CAP-01', 1, true, false, 'Ashwagandha — Cápsulas — 60u × 500 mg', now(), 'fix-mapa-2026-08-27'),  -- CAP-01 Ashwagandha  [ok]
  ('tremella', 'gotas', 'producto', 'EXT-14', 1, true, false, 'Tremella — Extracto en gotas — 60 ml', now(), 'fix-mapa-2026-08-27'),  -- EXT-14 Tremella  [ok]
  ('tremella', 'polvo', 'producto', 'POL-11', 1, true, false, 'Tremella — Polvo micronizado — 30 gr', now(), 'fix-mapa-2026-08-27'),  -- POL-11 Tremella  [CORREGIDO, antes POL-09]
  ('tremella', 'caps', 'producto', 'CAP-11', 1, true, false, 'Tremella — Cápsulas — 60u × 500 mg', now(), 'fix-mapa-2026-08-27'),  -- CAP-11 Tremella  [CORREGIDO, antes CAP-09]
  ('shiitake', 'gotas', 'producto', 'EXT-13', 1, true, false, 'Shiitake — Extracto en gotas — 60 ml', now(), 'fix-mapa-2026-08-27'),  -- EXT-13 Shitake  [ok]
  ('shiitake', 'polvo', 'producto', 'POL-10', 1, true, false, 'Shiitake — Polvo micronizado — 30 gr', now(), 'fix-mapa-2026-08-27'),  -- POL-10 Shitake  [CORREGIDO, antes POL-08]
  ('shiitake', 'caps', 'producto', 'CAP-10', 1, true, false, 'Shiitake — Cápsulas — 60u × 500 mg', now(), 'fix-mapa-2026-08-27'),  -- CAP-10 Shitake cápsulas  [CORREGIDO, antes CAP-08]
  ('cola-de-pavo', 'gotas', 'producto', 'EXT-05', 1, true, false, 'Cola de Pavo — Extracto en gotas — 60 ml', now(), 'fix-mapa-2026-08-27'),  -- EXT-05 Cola de Pavo  [ok]
  ('cola-de-pavo', 'polvo', 'producto', 'POL-03', 1, true, false, 'Cola de Pavo — Polvo micronizado — 30 gr', now(), 'fix-mapa-2026-08-27'),  -- POL-03 Cola de Pavo  [NUEVO]
  ('cola-de-pavo', 'caps', 'producto', 'CAP-03', 1, true, false, 'Cola de Pavo — Cápsulas — 60u × 500 mg', now(), 'fix-mapa-2026-08-27'),  -- CAP-03 Cola de Pavo  [NUEVO]
  ('rhodiola-rosea', 'gotas', 'producto', 'EXT-11', 1, true, false, 'Rhodiola Rosea — Extracto en gotas — 60 ml', now(), 'fix-mapa-2026-08-27'),  -- EXT-11 Rhodiola Rosea  [ok]
  ('rhodiola-rosea', 'polvo', 'producto', 'POL-08', 1, true, false, 'Rhodiola Rosea — Polvo micronizado — 30 gr', now(), 'fix-mapa-2026-08-27'),  -- POL-08 Rhoriola Rosea  [CORREGIDO, antes POL-06]
  ('rhodiola-rosea', 'caps', 'producto', 'CAP-08', 1, true, false, 'Rhodiola Rosea — Cápsulas — 60u × 500 mg', now(), 'fix-mapa-2026-08-27'),  -- CAP-08 Rhodiola  [CORREGIDO, antes CAP-06]
  ('schisandra', 'gotas', 'producto', 'EXT-12', 1, true, false, 'Schisandra — Extracto en gotas — 60 ml', now(), 'fix-mapa-2026-08-27'),  -- EXT-12 Schisandra  [ok]
  ('schisandra', 'polvo', 'producto', 'POL-09', 1, true, false, 'Schisandra — Polvo micronizado — 30 gr', now(), 'fix-mapa-2026-08-27'),  -- POL-09 Schisandra  [CORREGIDO, antes POL-07]
  ('schisandra', 'caps', 'producto', 'CAP-09', 1, true, false, 'Schisandra — Cápsulas — 60u × 500 mg', now(), 'fix-mapa-2026-08-27'),  -- CAP-09 Schisandra  [CORREGIDO, antes CAP-07]
  ('chaga', 'gotas', 'producto', 'EXT-04', 1, true, false, 'Chaga — Extracto en gotas — 60 ml', now(), 'fix-mapa-2026-08-27'),  -- EXT-04 Chaga  [ok]
  ('chaga', 'polvo', 'producto', 'POL-02', 1, true, false, 'Chaga — Polvo micronizado — 30 gr', now(), 'fix-mapa-2026-08-27'),  -- POL-02 Chaga  [ok]
  ('chaga', 'caps', 'producto', 'CAP-02', 1, true, false, 'Chaga — Cápsulas — 60u × 500 mg', now(), 'fix-mapa-2026-08-27'),  -- CAP-02 Chaga  [ok]
  ('melena-reishi', 'gotas', 'producto', 'EXT-15', 1, true, false, 'Melena de León + Reishi — Extracto en gotas — 60 ml', now(), 'fix-mapa-2026-08-27'),  -- EXT-15 Melena + Reishi  [ok]
  ('melena-reishi', 'polvo', 'producto', 'POL-12', 1, true, false, 'Melena de León + Reishi — Polvo micronizado — 30 gr', now(), 'fix-mapa-2026-08-27'),  -- POL-12 Melena de león + Reishi  [CORREGIDO, antes POL-10]
  ('melena-reishi', 'caps', 'producto', 'CAP-12', 1, true, false, 'Melena de León + Reishi — Cápsulas — 60u × 500 mg', now(), 'fix-mapa-2026-08-27'),  -- CAP-12 Melena de León + Reishi cápsulas  [CORREGIDO, antes CAP-10]
  ('melena-ashwagandha', 'gotas', 'producto', 'EXT-17', 1, true, false, 'Melena de León + Ashwagandha — Extracto en gotas — 60 ml', now(), 'fix-mapa-2026-08-27'),  -- EXT-17 Melena + Ashwagandha  [ok]
  ('melena-ashwagandha', 'polvo', 'producto', 'POL-13', 1, true, false, 'Melena de León + Ashwagandha — Polvo micronizado — 30 gr', now(), 'fix-mapa-2026-08-27'),  -- POL-13 Melena de león + Ashwagandha  [CORREGIDO, antes POL-11]
  ('melena-ashwagandha', 'caps', 'producto', 'CAP-14', 1, true, false, 'Melena de León + Ashwagandha — Cápsulas — 60u × 500 mg', now(), 'fix-mapa-2026-08-27'),  -- CAP-14 Melena de león + Ashwaganda  [CORREGIDO, antes CAP-12]
  ('melena-cordyceps', 'gotas', 'producto', 'EXT-16', 1, true, false, 'Melena de León + Cordyceps — Extracto en gotas — 60 ml', now(), 'fix-mapa-2026-08-27'),  -- EXT-16 Melena + Cordyceps  [ok]
  ('melena-cordyceps', 'polvo', 'producto', 'POL-14', 1, true, false, 'Melena de León + Cordyceps — Polvo micronizado — 30 gr', now(), 'fix-mapa-2026-08-27'),  -- POL-14 Melena de león + Cordyceps  [CORREGIDO, antes POL-12]
  ('melena-cordyceps', 'caps', 'producto', 'CAP-13', 1, true, false, 'Melena de León + Cordyceps — Cápsulas — 60u × 500 mg', now(), 'fix-mapa-2026-08-27'),  -- CAP-13 Melena de león + Cordyceps  [CORREGIDO, antes CAP-11]
  ('melena-de-leon', 'desh', 'producto', 'ENT-05', 1, true, false, 'Melena de León — Setas enteras deshidratadas — Doy pack', now(), 'fix-mapa-2026-08-27'),  -- ENT-05 Melena de León  [ok]
  ('melena-de-leon', 'desh-1kg', 'producto', 'ENT-05', 1, true, true , 'Melena de León — Entera deshidratada — 1 kg', now(), 'fix-mapa-2026-08-27'),  -- ENT-05 Melena de León  [NUEVO]
  ('cordyceps', 'desh', 'producto', 'ENT-01', 1, true, false, 'Cordyceps — Setas enteras deshidratadas — Doy pack', now(), 'fix-mapa-2026-08-27'),  -- ENT-01 Cordyceps Entero  [ok]
  ('cordyceps', 'desh-1kg', 'producto', 'ENT-01', 1, true, true , 'Cordyceps — Entero deshidratado — 1 kg', now(), 'fix-mapa-2026-08-27'),  -- ENT-01 Cordyceps Entero  [NUEVO]
  ('maitake', 'desh', 'producto', 'ENT-04', 1, true, false, 'Maitake — Setas enteras deshidratadas — Doy pack', now(), 'fix-mapa-2026-08-27'),  -- ENT-04 Maitake  [ok]
  ('shiitake', 'desh', 'producto', 'ENT-06', 1, true, true , 'Shiitake — Setas enteras y laminadas deshidratadas — Doy pack', now(), 'fix-mapa-2026-08-27'),  -- ENT-06 Shitake Laminado  [ok]
  ('shiitake', 'laminado-50g', 'producto', 'ENT-06', 1, true, false, 'Shiitake — Laminado deshidratado — 50 g', now(), 'fix-mapa-2026-08-27'),  -- ENT-06 Shitake Laminado  [ok]
  ('shiitake', 'laminado-1kg', 'producto', 'ENT-06', 1, true, true , 'Shiitake — Laminado deshidratado — 1 kg', now(), 'fix-mapa-2026-08-27'),  -- ENT-06 Shitake Laminado  [NUEVO]
  ('shiitake', 'entero-1kg', 'producto', 'ENT-07', 1, true, true , 'Shiitake — Entero deshidratado — 1 kg', now(), 'fix-mapa-2026-08-27'),  -- ENT-07 Shitake Setas Entero  [NUEVO]
  ('tremella', 'desh-1kg', 'producto', 'ENT-08', 1, true, false, 'Tremella — Entera deshidratada — 1 kg', now(), 'fix-mapa-2026-08-27'),  -- ENT-08 Tremella Entera  [ok]
  ('hongo-de-pino-entero', 'enteros', 'producto', 'ENT-03', 1, true, false, 'Hongo de pino Entero — Hongos Enteros — 100 g', now(), 'fix-mapa-2026-08-27'),  -- ENT-03 Hongos de Pino  [ok]
  ('hongo-de-pino-entero', 'xkg', 'producto', 'ENT-03', 1, true, true , 'Hongo de pino Entero — Hongos Enteros — 1kg', now(), 'fix-mapa-2026-08-27'),  -- ENT-03 Hongos de Pino  [NUEVO]
  ('girgola-disecadas', 'enteros', 'producto', 'ENT-02', 1, true, false, 'Hongos Girgolas Disecadas — Hongos disecados — 50 g', now(), 'fix-mapa-2026-08-27'),  -- ENT-02 Girgolas  [ok]
  ('girgola-disecadas', 'xkg', 'producto', 'ENT-02', 1, true, true , 'Hongos Girgolas Disecadas — Hongos deshidratados — 1kg', now(), 'fix-mapa-2026-08-27'),  -- ENT-02 Girgolas  [NUEVO]
  ('aceite-de-cannabis', 'gotas', 'producto', 'ACE-01', 1, true, false, 'Aceite de Cannabis — 30ml en gotas — 60 ml', now(), 'fix-mapa-2026-08-27'),  -- ACE-01 Cannabis Medicinal  [NUEVO]
  ('aceite-clavo', '10ml', 'producto', 'ACE-02', 1, true, false, 'Aceite de Clavo de Olor — Frasco gotero — 30 ml', now(), 'fix-mapa-2026-08-27'),  -- ACE-02 Clavo de olor  [ok]
  ('aceite-curcuma', '10ml', 'producto', 'ACE-03', 1, true, false, 'Aceite de Cúrcuma + Pimienta Negra — Frasco gotero — 30 ml', now(), 'fix-mapa-2026-08-27'),  -- ACE-03 Curcuma + Pimienta Negra  [ok]
  ('aceite-lavanda', '10ml', 'producto', 'ACE-05', 1, true, false, 'Aceite de Lavanda — Frasco gotero — 30 ml', now(), 'fix-mapa-2026-08-27'),  -- ACE-05 Lavanda  [ok]
  ('aceite-menta', '10ml', 'producto', 'ACE-06', 1, true, false, 'Aceite de Menta — Frasco gotero — 30 ml', now(), 'fix-mapa-2026-08-27'),  -- ACE-06 Menta  [ok]
  ('aceite-oregano', '10ml', 'producto', 'ACE-07', 1, true, false, 'Aceite de Orégano — Frasco gotero — 30 ml', now(), 'fix-mapa-2026-08-27'),  -- ACE-07 Orégano  [ok]
  ('extracto-cardo-mariano', 'gotas', 'producto', 'EXT-03', 1, true, false, 'Cardo Mariano — Extracto en gotas — 60 ml', now(), 'fix-mapa-2026-08-27'),  -- EXT-03 Cardo Mariano  [ok]
  ('extracto-concentrado-amargon', 'gotas', 'producto', 'EXT-02', 1, true, false, 'Extracto concentrado Amargón — Extracto en gotas — 60 ml', now(), 'fix-mapa-2026-08-27'),  -- EXT-02 Amargon  [ok]
  ('extracto-concentrado-amargon-copia-mq63qyw5', 'gotas', 'producto', 'EXT-18', 1, true, false, 'Extracto concentrado Pasiflora — Extracto en gotas — 60 ml', now(), 'fix-mapa-2026-08-27'),  -- EXT-18 Pasiflora  [ok]
  ('flor-de-hibiscus', 'gotas', 'producto', 'EXT-07', 1, true, false, 'Flor de Hibiscus — Extracto en gotas — 60 ml', now(), 'fix-mapa-2026-08-27'),  -- EXT-07 Hibiscus  [ok]
  ('flor-de-hibiscus', 'caps', 'producto', 'CAP-23', 1, true, false, 'Flor de Hibiscus — Cápsulas x 500mg x 60 unidades', now(), 'fix-mapa-2026-08-27'),  -- CAP-23 Hibiscus Capsulas  [CORREGIDO, antes CAP-20]
  ('flor-de-hibiscus', 'pol', 'producto', 'POL-18', 1, true, false, 'Flor de Hibiscus — Polvo x 50g', now(), 'fix-mapa-2026-08-27'),  -- POL-18 HIBUSCUS/FLOR DE JAMAICA  [CORREGIDO, antes POL-16]
  ('cacao-amargo-melena-de-leon', 'Polvo ', 'producto', 'POL-15', 1, true, false, 'Cacao amargo + Melena de León — Polvo — 125 g', now(), 'fix-mapa-2026-08-27'),  -- POL-15 Cacao amargo con MELENA DE LEON  [CORREGIDO, antes POL-13]
  ('cacao-amargo-reishi', 'polvo', 'producto', 'POL-16', 1, true, false, 'Cacao amargo + Reishi — Polvo — 125 g', now(), 'fix-mapa-2026-08-27'),  -- POL-16 Cacao amargo con REISHI  [CORREGIDO, antes POL-14]
  ('tremella-plus', 'caps', 'producto', 'CAP-15', 1, true, false, 'Tremella Plus — Cápsulas — 60u x 500 mg', now(), 'fix-mapa-2026-08-27'),  -- CAP-15 Tremella (Plus) + Colageno Hidrolizado+ Vit A,C y E  [CORREGIDO, antes CAP-13]
  ('caps-ajo-vitc', '60', 'producto', 'CAP-16', 1, true, false, 'Ajo + Vitamina C — 60 cápsulas × 500 mg', now(), 'fix-mapa-2026-08-27'),  -- CAP-16 Ajo + Vit C  [CORREGIDO, antes CAP-14]
  ('caps-curcuma-copia-mrjd6c1y', '60', 'producto', 'CAP-17', 1, true, false, 'Cúrcuma + Jengibre + Pimienta Negra — 60 cápsulas × 500 mg', now(), 'fix-mapa-2026-08-27'),  -- CAP-17 Curcuma + Jengibre + Pimienta + Vit c  [CORREGIDO, antes CAP-15]
  ('caps-curcuma', '60', 'producto', 'CAP-18', 1, true, false, 'Cúrcuma + Pimienta Negra — 60 cápsulas × 500 mg', now(), 'fix-mapa-2026-08-27'),  -- CAP-18 Curcuma + Pimienta negra  [CORREGIDO, antes CAP-16]
  ('caps-colageno-plus', '60', 'producto', 'CAP-19', 1, true, false, 'Colágeno Plus — 60 cápsulas × 500 mg', now(), 'fix-mapa-2026-08-27'),  -- CAP-19 Colágeno PLUS (Curcuma + P. Negra + Cart. Tiburon+ vit C y D3 + Citrato de Zinc)  [CORREGIDO, antes CAP-17]
  ('caps-colageno-hidrolizado', '60', 'producto', 'CAP-20', 1, true, false, 'Colágeno Hidrolizado — 60 cápsulas × 500 mg', now(), 'fix-mapa-2026-08-27'),  -- CAP-20 Colágeno Hidrolizado tipo I y III + Vitamina C  [CORREGIDO, antes CAP-18]
  ('caps-vitc', '60', 'producto', 'CAP-21', 1, true, false, 'Vitamina C — 60 cápsulas × 500 mg', now(), 'fix-mapa-2026-08-27'),  -- CAP-21 Vitamina C  [CORREGIDO, antes CAP-19]
  ('caps-palo-negro', '90', 'producto', 'CAP-22', 1, true, false, 'Palo Negro Chileno — 90 cápsulas × 150 mg', now(), 'fix-mapa-2026-08-27'),  -- CAP-22 Palo Negro Chileno  [NUEVO]
  ('caps-hibiscus', '60', 'producto', 'CAP-23', 1, true, true , 'Hibiscus — 60 cápsulas × 500 mg', now(), 'fix-mapa-2026-08-27'),  -- CAP-23 Hibiscus Capsulas  [CORREGIDO, antes CAP-20]
  ('caps-cardo-mariano', '60', 'producto', 'CAP-24', 1, true, false, 'Cardo Mariano — 60 cápsulas × 500 mg', now(), 'fix-mapa-2026-08-27'),  -- CAP-24 Cardo Mariano  [CORREGIDO, antes CAP-21]
  ('caps-cartilago-tiburon', '60', 'producto', 'CAP-25', 1, true, false, 'Cartílago de Tiburón — 60 cápsulas × 500 mg', now(), 'fix-mapa-2026-08-27'),  -- CAP-25 Cartilago de Tiburon  [CORREGIDO, antes CAP-22]
  ('caps-triple-mag', '60', 'producto', 'CAP-26', 1, true, false, 'Triple Magnesio — 60 cápsulas × 500 mg', now(), 'fix-mapa-2026-08-27'),  -- CAP-26 Triple MAGNESIO ( Citrato+ Malato+ Glisinato)  [CORREGIDO, antes CAP-23]
  ('caps-mag-potasio', '60', 'producto', 'CAP-27', 1, true, false, 'Magnesio + Potasio — 60 cápsulas × 500 mg', now(), 'fix-mapa-2026-08-27'),  -- CAP-27 MAGNESIO + POTASIO (Citratos)  [CORREGIDO, antes CAP-24]
  ('caps-citrato-potasio', '60', 'producto', 'CAP-28', 1, true, false, 'Citrato de Potasio — 60 cápsulas × 500 mg', now(), 'fix-mapa-2026-08-27'),  -- CAP-28 Citrato de POTASIO  [CORREGIDO, antes CAP-25]
  ('caps-citrato-mag', '60', 'producto', 'CAP-29', 1, true, false, 'Citrato de Magnesio — 60 cápsulas × 500 mg', now(), 'fix-mapa-2026-08-27'),  -- CAP-29 Citrato de MAGNESIO  [CORREGIDO, antes CAP-26]
  ('caps-glicinato-mag', '60', 'producto', 'CAP-30', 1, true, false, 'Glicinato de Magnesio — 60 cápsulas × 500 mg', now(), 'fix-mapa-2026-08-27'),  -- CAP-30 Glicinato de MAGNESIO  [CORREGIDO, antes CAP-27]
  ('caps-zeolita', '60', 'producto', 'CAP-31', 1, true, false, 'Zeolita — 60 cápsulas × 500 mg', now(), 'fix-mapa-2026-08-27'),  -- CAP-31 Zeolita  [CORREGIDO, antes CAP-28]
  ('caps-malato-mag', '60', 'producto', 'CAP-32', 1, true, false, 'Malato de Magnesio — 60 cápsulas × 500 mg', now(), 'fix-mapa-2026-08-27'),  -- CAP-32 Malato de MAGNESIO  [CORREGIDO, antes CAP-29]
  ('caps-maca', '60', 'producto', 'CAP-33', 1, true, false, 'Maca — 60 cápsulas × 500 mg', now(), 'fix-mapa-2026-08-27'),  -- CAP-33 Maca  [CORREGIDO, antes CAP-30]
  ('bisglicinato', 'Cáps', 'producto', 'CAP-30', 1, true, true , 'Bisglicinato — Cápsulas 60u x 500 mg', now(), 'fix-mapa-2026-08-27'),  -- CAP-30 Glicinato de MAGNESIO  [CORREGIDO, antes CAP-32]
  ('polvo-vitc', '50g', 'producto', 'POL-17', 1, true, false, 'Vitamina C — Polvo — Envase 50 g', now(), 'fix-mapa-2026-08-27'),  -- POL-17 VITAMINA C  [CORREGIDO, antes POL-15]
  ('polvo-vitc', '1kg', 'producto', 'POL-41', 1, true, false, 'Vitamina C — Polvo — Envase 1 kg', now(), 'fix-mapa-2026-08-27'),  -- POL-41 Vitamina C  [NUEVO]
  ('polvo-citrato-potasio', '50g', 'producto', 'POL-19', 1, true, false, 'Citrato de Potasio — Polvo — Envase 50 g', now(), 'fix-mapa-2026-08-27'),  -- POL-19 Citrato de POTASIO  [CORREGIDO, antes POL-17]
  ('polvo-citrato-potasio', '100g', 'producto', 'POL-25', 1, true, false, 'Citrato de Potasio — Polvo — Envase 100 g', now(), 'fix-mapa-2026-08-27'),  -- POL-25 Citrato de POTASIO  [CORREGIDO, antes POL-23]
  ('polvo-citrato-potasio', '500g', 'producto', 'POL-32', 1, true, false, 'Citrato de Potasio — Polvo — Envase 500 g', now(), 'fix-mapa-2026-08-27'),  -- POL-32 Citrato de POTASIO  [CORREGIDO, antes POL-30]
  ('polvo-citrato-potasio', '1kg', 'producto', 'POL-36', 1, true, false, 'Citrato de Potasio — Polvo — Envase 1 kg', now(), 'fix-mapa-2026-08-27'),  -- POL-36 Citrato de POTASIO  [CORREGIDO, antes POL-34]
  ('polvo-citrato-mag', '50g', 'producto', 'POL-20', 1, true, false, 'Citrato de Magnesio — Polvo — Envase 50 g', now(), 'fix-mapa-2026-08-27'),  -- POL-20 Citrato de MAGNESIO  [CORREGIDO, antes POL-18]
  ('polvo-citrato-mag', '100g', 'producto', 'POL-26', 1, true, false, 'Citrato de Magnesio — Polvo — Envase 100 g', now(), 'fix-mapa-2026-08-27'),  -- POL-26 Citrato de MAGNESIO  [CORREGIDO, antes POL-24]
  ('polvo-citrato-mag', '500g', 'producto', 'POL-31', 1, true, false, 'Citrato de Magnesio — Polvo — Envase 500 g', now(), 'fix-mapa-2026-08-27'),  -- POL-31 Citrato de MAGNESIO  [CORREGIDO, antes POL-29]
  ('polvo-citrato-mag', '1kg', 'producto', 'POL-35', 1, true, false, 'Citrato de Magnesio — Polvo — Envase 1 kg', now(), 'fix-mapa-2026-08-27'),  -- POL-35 Citrato de MAGNESIO  [CORREGIDO, antes POL-33]
  ('polvo-glicinato-mag', '50g', 'producto', 'POL-21', 1, true, false, 'Glicinato de Magnesio — Polvo — Envase 50 g', now(), 'fix-mapa-2026-08-27'),  -- POL-21 Glicinato de MAGNESIO  [CORREGIDO, antes POL-19]
  ('polvo-glicinato-mag', '100g', 'producto', 'POL-27', 1, true, false, 'Glicinato de Magnesio — Polvo — Envase 100 g', now(), 'fix-mapa-2026-08-27'),  -- POL-27 Glicinato de MAGNESIO  [CORREGIDO, antes POL-25]
  ('polvo-glicinato-mag', '500g', 'producto', 'POL-33', 1, true, false, 'Glicinato de Magnesio — Polvo — Envase 500 g', now(), 'fix-mapa-2026-08-27'),  -- POL-33 Glicinato de MAGNESIO  [CORREGIDO, antes POL-31]
  ('polvo-glicinato-mag', '1kg', 'producto', 'POL-37', 1, true, false, 'Glicinato de Magnesio — Polvo — Envase 1 kg', now(), 'fix-mapa-2026-08-27'),  -- POL-37 Glicinato de MAGNESIO  [CORREGIDO, antes POL-35]
  ('polvo-malato-mag', '50g', 'producto', 'POL-22', 1, true, false, 'Malato de Magnesio — Polvo — Envase 50 g', now(), 'fix-mapa-2026-08-27'),  -- POL-22 Malato de MAGNESIO  [CORREGIDO, antes POL-20]
  ('polvo-malato-mag', '100g', 'producto', 'POL-28', 1, true, false, 'Malato de Magnesio — Polvo — Envase 100 g', now(), 'fix-mapa-2026-08-27'),  -- POL-28 Malato de MAGNESIO  [CORREGIDO, antes POL-26]
  ('polvo-malato-mag', '500g', 'producto', 'POL-34', 1, true, false, 'Malato de Magnesio — Polvo — Envase 500 g', now(), 'fix-mapa-2026-08-27'),  -- POL-34 Malato de MAGNESIO  [CORREGIDO, antes POL-32]
  ('polvo-malato-mag', '1kg', 'producto', 'POL-38', 1, true, false, 'Malato de Magnesio — Polvo — Envase 1 kg', now(), 'fix-mapa-2026-08-27'),  -- POL-38 Malato de MAGNESIO  [CORREGIDO, antes POL-36]
  ('polvo-citrato-mag-potasio', '50g', 'producto', 'POL-23', 1, true, false, 'Citrato de Magnesio + Potasio — Polvo — Envase 50 g', now(), 'fix-mapa-2026-08-27'),  -- POL-23 Citrato de MAGNESIO + POTASIO POLVO  [CORREGIDO, antes POL-21]
  ('polvo-citrato-mag-potasio', '100g', 'producto', 'POL-29', 1, true, false, 'Citrato de Magnesio + Potasio — Polvo — Envase 100 g', now(), 'fix-mapa-2026-08-27'),  -- POL-29 Citrato de MAGNESIO + POTASIO POLVO  [CORREGIDO, antes POL-27]
  ('polvo-triple-mag', '50g', 'producto', 'POL-24', 1, true, false, 'Triple Magnesio — Polvo — Envase 50 g', now(), 'fix-mapa-2026-08-27'),  -- POL-24 Triple MAGNESIO  [CORREGIDO, antes POL-22]
  ('polvo-triple-mag', '100g', 'producto', 'POL-30', 1, true, false, 'Triple Magnesio — Polvo — Envase 100 g', now(), 'fix-mapa-2026-08-27'),  -- POL-30 Triple MAGNESIO ( Citrato+ Malato+ Glicinato)  [CORREGIDO, antes POL-28]
  ('polvo-remolacha', '1kg', 'producto', 'POL- 39', 1, true, false, 'Remolacha — Polvo — Envase 1 kg', now(), 'fix-mapa-2026-08-27'),  -- POL- 39 Remolacha  [NUEVO]
  ('polvo-bicarbonato', '1kg', 'producto', 'POL-40', 1, true, false, 'Bicarbonato de Sodio — Envase 1 kg', now(), 'fix-mapa-2026-08-27')  -- POL-40 Bicarbonato de Sodio  [NUEVO]
on conflict (producto_id, pres_id) do update set
  categoria  = excluded.categoria,
  codigo     = excluded.codigo,
  unidades   = excluded.unidades,
  activo     = excluded.activo,
  revisar    = excluded.revisar,
  etiqueta   = excluded.etiqueta,
  updated_at = now(),
  updated_by = excluded.updated_by;

-- ---------------------------------------------------------------
-- 2. Vínculos que hay que APAGAR: apuntaban a un ítem equivocado y no
--    existe el ítem correcto en el inventario. Se desactivan para que
--    dejen de descontar lo que no es; quedan marcados para revisar.
-- ---------------------------------------------------------------
update public.st_sku_map set activo = false, revisar = true,
  etiqueta = 'SIN VINCULAR — descontaba POL-37 Glicinato de Magnesio 1 kg. Falta dar de alta la Creatina como producto', updated_at = now(), updated_by = 'fix-mapa-2026-08-27'
 where producto_id = 'creatina-monohidrato' and pres_id = 'polvo';

update public.st_sku_map set activo = false, revisar = true,
  etiqueta = 'SIN VINCULAR — descontaba POL-38 Malato de Magnesio 1 kg. Falta dar de alta la Creatina como producto', updated_at = now(), updated_by = 'fix-mapa-2026-08-27'
 where producto_id = 'creatina-monohidrato' and pres_id = 'polvo-2';

update public.st_sku_map set activo = false, revisar = true,
  etiqueta = 'SIN VINCULAR — descontaba CAP-31 Zeolita. Falta dar de alta la Espirulina como producto', updated_at = now(), updated_by = 'fix-mapa-2026-08-27'
 where producto_id = 'caps-espirulina' and pres_id = '60';

update public.st_sku_map set activo = false, revisar = true,
  etiqueta = 'SIN VINCULAR — apunta a ACE-04, que no existe en st_items. El producto está oculto en la tienda', updated_at = now(), updated_by = 'fix-mapa-2026-08-27'
 where producto_id = 'aceite-hibiscus' and pres_id = '10ml';

commit;

-- ---------------------------------------------------------------
-- Control: después de correr, esto NO debe devolver ninguna fila.
-- ---------------------------------------------------------------
select m.producto_id, m.pres_id, m.categoria, m.codigo, m.activo
  from public.st_sku_map m
  left join public.st_items i on i.categoria = m.categoria and i.codigo = m.codigo
 where i.codigo is null and m.activo;

-- ---------------------------------------------------------------
-- PENDIENTE (no lo resuelve este script): presentaciones que se venden
-- en la tienda y NO tienen ítem en el inventario. Hay que darlas de alta
-- en la plataforma de stock y después vincularlas:
--   · Creatina Monohidrato — 150 g / 300 g / 500 g / 1 kg
--   · Espirulina — 60 cápsulas
--   · Tremella Gel base — 250 g / 500 g / 800 g / 1 kg
--     (existe GEL-TREMELLA con 16 u, pero cargado como ETIQUETA, no como producto)
--   · Vitamina C en polvo — 500 g (están el de 50 g y el de 1 kg)
--   · Remolacha en polvo — 500 g (está el de 1 kg, POL- 39)
--   · Bicarbonato de Sodio — 500 g (está el de 1 kg, POL-40)
--   · Aceite de Hibiscus — Jamaica (ACE-04 no existe; el producto está oculto)
