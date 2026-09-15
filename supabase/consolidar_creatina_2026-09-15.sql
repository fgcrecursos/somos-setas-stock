-- =====================================================================
-- Somos Setas — consolidación de la Creatina duplicada
-- Generado el 2026-09-15, después de correr fix_mapa_y_creatina_2026-09-15.sql
--
-- QUÉ PASÓ
--   Matías estaba dando de alta la creatina a mano en la plataforma mientras
--   se corría el script del mapa. Cronología real (st_movimientos):
--     14:29  alta POL-42  (Matías)
--     14:50  alta POL-43  (Matías)
--     14:53  alta POL-44  (Matías)
--     14:54  alta POL-45  (Matías)
--     14:55  corre fix_mapa_y_creatina_2026-09-15.sql
--   El script asumía que POL-42 y POL-43 estaban libres — lo estaban 15 minutos
--   antes, cuando se generó — y su `on conflict do update` los pisó: les cambió
--   nombre, mínimo y receta. El stock se salvó porque `actual` quedó fuera del
--   update, a propósito.
--
--   Resultado: 4 productos para 2 tamaños reales.
--     150 g -> POL-42 (10 u, del script)   y  POL-44 (13 u, de Matías)
--     300 g -> POL-43 (12 u, del script)   y  POL-45 (12 u, de Matías)
--
-- QUÉ HACE ESTE SCRIPT
--   Decisión tomada: quedan POL-42 y POL-43, que son los que la tienda ya tiene
--   vinculados. Se dan de baja POL-44 y POL-45.
--     1. Rescata de la receta de Matías la CUCHARITA 5 G (INS-56), que faltaba.
--     2. Saca la trampa de polvo-3 / polvo-4, que apuntaban a POL-44 y POL-45
--        (ítems de 150 g y 300 g, no de 500 g y 1 kg).
--     3. Registra la baja de POL-44 y POL-45 en el historial y los elimina.
--
-- NO ES IDEMPOTENTE: corre una sola vez. Si se corre de nuevo, el guard del
-- paso 3 aborta la transacción entera en vez de borrar algo que no toca.
--
-- ANTES DE CORRERLO: que no haya nadie editando creatina en la plataforma.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1. Rescatar la cucharita de la receta que había cargado Matías
--
--    Sus dos versiones (POL-44 y POL-45) incluían INS-56 "CUCHARITA 5 G", que
--    la receta del script no tenía. Es correcto: la creatina sale con medidor.
--
--    OJO — la bolsa queda SIN TOCAR, en INS-18 "Bolsa 16x24 creatina". Matías
--    había usado otras: INS-06 "Doypack traslúcida 16X24" para el de 150 g e
--    INS-03 "Doypack c/ ventana 18x12" para el de 300 g. No hay forma de saber
--    desde los datos cuál es la que se usa de verdad, así que se deja la que
--    lleva "creatina" en el nombre. Si la correcta es otra, se cambia desde la
--    ficha del producto en la plataforma, que es un minuto.
-- ---------------------------------------------------------------------
update public.st_items
   set data = jsonb_set(
         data, '{bom}',
         (data -> 'bom') || '[{"codigo": "INS-56", "cantidad": 1, "categoria": "insumo"}]'::jsonb),
       updated_at = now(),
       updated_by = 'consolidar-creatina-2026-09-15'
 where categoria = 'producto'
   and codigo in ('POL-42', 'POL-43')
   and not (data -> 'bom') @> '[{"codigo": "INS-56"}]'::jsonb;


-- ---------------------------------------------------------------------
-- 2. Sacar la trampa de las presentaciones de 500 g y 1 kg
--
--    Quedaron apuntando a POL-44 y POL-45 porque el script los reservó como
--    códigos libres para esos tamaños — y Matías los ocupó con 150 g y 300 g.
--    Están desactivadas, así que hoy no descuentan nada; pero si alguien las
--    activa creyendo que ya están listas, descuenta el tamaño equivocado.
--
--    Pasan a un código que no existe y que nadie va a crear por accidente: si
--    algún día se activan sin haber creado el ítem, el motor las anota en
--    st_pedidos.sin_mapear en vez de descontar cualquier cosa.
-- ---------------------------------------------------------------------
update public.st_sku_map
   set codigo = 'PENDIENTE-CREATINA-500G',
       etiqueta = 'SIN VINCULAR — falta crear el producto de 500 g y su etiqueta',
       activo = false, revisar = true,
       updated_at = now(), updated_by = 'consolidar-creatina-2026-09-15'
 where producto_id = 'creatina-monohidrato' and pres_id = 'polvo-3';

update public.st_sku_map
   set codigo = 'PENDIENTE-CREATINA-1KG',
       etiqueta = 'SIN VINCULAR — falta crear el producto de 1 kg y su etiqueta',
       activo = false, revisar = true,
       updated_at = now(), updated_by = 'consolidar-creatina-2026-09-15'
 where producto_id = 'creatina-monohidrato' and pres_id = 'polvo-4';


-- ---------------------------------------------------------------------
-- 3. Dar de baja los duplicados POL-44 y POL-45
--
--    Guard primero: si no son exactamente los duplicados de creatina que se
--    esperaban, aborta todo. Es la lección de lo que pasó a las 14:55.
-- ---------------------------------------------------------------------
do $$
declare
  n44 int;
  n45 int;
begin
  select count(*) into n44 from public.st_items
   where categoria = 'producto' and codigo = 'POL-44'
     and nombre = 'Creatina' and data ->> 'presentacion' = '150 g';

  select count(*) into n45 from public.st_items
   where categoria = 'producto' and codigo = 'POL-45'
     and nombre = 'Creatina' and data ->> 'presentacion' = '300 g';

  if n44 <> 1 or n45 <> 1 then
    raise exception
      'Abortado: POL-44/POL-45 no son los duplicados de creatina esperados (coinciden 44=%, 45=%). Revisar a mano antes de borrar nada.', n44, n45;
  end if;
end $$;

-- El stock que tenían sale del sistema: queda anotado para que el historial
-- cierre y no aparezca stock evaporado sin explicación (mismo criterio que usa
-- la plataforma en `eliminarItem`).
insert into public.st_movimientos
  (id, fecha, tipo, categoria, codigo, nombre, cantidad, nota, componentes, usuario, origen)
select
  left(md5(random()::text || clock_timestamp()::text), 16),
  now(), 'baja', 'producto', i.codigo, i.nombre, -i.actual,
  'Duplicado de creatina eliminado tras la consolidación del 2026-09-15 (tenía '
    || i.actual || ' en stock). El tamaño queda cubierto por '
    || case i.codigo when 'POL-44' then 'POL-42 (150 g)' else 'POL-43 (300 g)' end || '.',
  '[]'::jsonb, 'consolidar-creatina-2026-09-15', 'plataforma'
  from public.st_items i
 where i.categoria = 'producto' and i.codigo in ('POL-44', 'POL-45');

delete from public.st_items
 where categoria = 'producto' and codigo in ('POL-44', 'POL-45');

commit;


-- =====================================================================
-- CONTROLES
-- =====================================================================

-- A. Deben quedar SOLO dos productos de creatina, POL-42 y POL-43.
select codigo, nombre, actual, minimo, data ->> 'presentacion' as presentacion
  from public.st_items
 where categoria = 'producto' and lower(nombre) like '%creatina%'
 order by codigo;

-- B. Las recetas, con el nombre de cada componente.
select i.codigo, b ->> 'categoria' as categoria, b ->> 'codigo' as componente,
       c.nombre, (b ->> 'cantidad')::numeric as cantidad
  from public.st_items i
  cross join lateral jsonb_array_elements(i.data -> 'bom') b
  left join public.st_items c
    on c.categoria = b ->> 'categoria' and c.codigo = b ->> 'codigo'
 where i.categoria = 'producto' and i.codigo in ('POL-42', 'POL-43')
 order by i.codigo, categoria;

-- C. El mapa de la creatina. 150 g y 300 g activas; 500 g y 1 kg apagadas y
--    apuntando a un código PENDIENTE-*.
select pres_id, codigo, activo, revisar, etiqueta
  from public.st_sku_map
 where producto_id = 'creatina-monohidrato'
 order by pres_id;

-- D. La baja quedó en el historial.
select fecha, tipo, codigo, nombre, cantidad, nota
  from public.st_movimientos
 where usuario = 'consolidar-creatina-2026-09-15'
 order by codigo;


-- =====================================================================
-- PENDIENTE — lo que sigue necesitando una persona
-- =====================================================================
--
-- (a) EL CONTEO DE 150 g NO CIERRA. POL-42 quedó con 10 unidades (lo que había
--     cargado Matías ahí) pero en POL-44 había contado 13. Los dos números son
--     de hoy y no hay forma de saber cuál es el bueno: hay que mirar el estante
--     y corregirlo con "Fijar actual". El de 300 g sí coincide: 12 en los dos.
--
-- (b) LA BOLSA DE LA RECETA. Ver la nota del paso 1: quedó INS-18 y Matías
--     había usado INS-06 / INS-03. Que lo confirme él.
--
-- (c) CREATINA 500 g Y 1 kg. Se venden en la tienda y siguen sin descontar.
--     Para activarlas: crear las dos etiquetas, crear los dos productos, y
--     poner activo = true en las filas polvo-3 y polvo-4 con el código real.
