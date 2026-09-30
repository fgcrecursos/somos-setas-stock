# Auditoría del stock — 30/09/2026

Revisión completa de la plataforma de stock (código + base de producción) porque la carga y la
contabilidad de productos, insumos, etiquetas y materia prima seguían sin cerrar.

## Conclusión

**Las cuentas de la base están bien; lo que falla son los datos con los que cuenta y la forma de
cargar.** Desde el 25/09 no hay ningún cambio de stock sin su movimiento: cada "antes → después"
encadena con el siguiente. El stock se despega del estante por cuatro motivos:

1. **La materia prima se descuenta de a una bolsa entera por unidad producida.** Ninguna de las 62
   materias primas tiene unidad de medida. El stock está contado en bolsas o kilos (Ashwagandha:
   "Bolsa 5 kg", stock −31) y las recetas piden `1` por cada frasco o bolsita: producir 30 cápsulas
   de Ashwagandha descuenta 30 bolsas de 5 kg. Unas 115 líneas de receta, en 37 materias primas,
   piden 1 de una materia prima contada por bolsa. Por eso la materia prima vive en negativo y hay que corregirla a mano
   (el 30/09 se corrigieron MP-27 de −57 a 3, MP-29 de −49 a 1, MP-31, MP-32, MP-36, MP-38…).
   La única bien armada es la cápsula (MP-04): se cuenta por unidad y la receta pide 60.
2. **19 productos descuentan la etiqueta de otro tamaño.** Los polvos de 100 g, 500 g y 1 kg usan
   la etiqueta de 50 g (ETQ-POL-24 la descuentan 5 productos), mientras que las etiquetas de su
   tamaño existen y nunca se mueven (ETQ-POL-29 a 41). Lo mismo con Tremella Plus y Cúrcuma +
   Jengibre en cápsulas, y los cacaos (usan la de Melena y la de Reishi 30 g).
3. **Casi toda la carga se hace desde "Editar", que pisaba el número.** Hasta hoy: 313 cambios de
   stock hechos editando la ficha contra 31 producciones y 0 ajustes. Producir por ahí no
   descontaba la receta, las compras quedaban como "edición" y, si el formulario estaba abierto
   mientras entraba una venta de la tienda, la venta se borraba.
4. **Recetas incompletas y códigos confusos.** 6 productos sin etiqueta en la receta (Chaga,
   Tremella y Pasiflora extracto tienen su etiqueta cargada pero sin usar), 5 sin materia prima,
   3 sin envase, 1 sin receta (Remolacha), una línea repetida (ACE-03 pide dos veces MP-29), y
   "MP-30" (Reishi) y "MP- 30" (Bisglicinato) que el escáner lee igual.

## Qué se corrigió en el código (este commit)

- **Editar el stock pregunta por qué cambia**: *se produjo* (descuenta la receta), *entró
  mercadería* (suma sobre el stock real), *corrección por conteo físico* (deja el número exacto) o
  *se usó internamente*. Cada opción deja su movimiento propio. El cambio se mide contra lo que se
  vio al abrir el formulario: no tocar el campo ya no puede pisar una venta.
- **Alta con INSERT**: si otra persona cargó el mismo código, falla en vez de pisarle la ficha.
- **Cambio de código en cascada**: se crea la fila nueva con el stock real antes de borrar la vieja,
  y se actualizan las recetas, los vínculos con la tienda y los pedidos ya descontados.
- **Códigos únicos de verdad**: no se puede crear ni renombrar a un código que se lea igual que otro
  ("MP- 30" = "MP-30") ni con espacios.
- **Cantidades**: el modal rápido ya no trae 10 precargado y ninguna operación acepta cantidades
  vacías, cero o negativas (el 10/08 quedó una producción de −20 que devolvió insumos).
- **Recetas**: no deja guardar un componente repetido; cada línea muestra qué es "1" de ese
  componente y avisa cuando una materia prima contada por bolsa se descuenta entera; al producir se
  agrupan líneas repetidas (el historial mostraba mal el stock que quedaba).
- **Eliminar un producto** avisa si la tienda lo sigue vendiendo.
- **Reposición** ya no dice que se pueden fabricar "−43".
- **Nueva sección "Revisión de datos"**: todos estos problemas, en vivo, con un botón para abrir la
  ficha y corregir. Para las etiquetas de otro tamaño sugiere la correcta cuando hay una sola del
  tamaño del producto con ese nombre.

## Segunda parte (misma fecha)

- **`supabase/corregir_etiquetas_2026-09-30.sql`**: 15 recetas pasan a la etiqueta de su tamaño,
  3 extractos suman la suya (Chaga, Tremella, Pasiflora) y la ficha de ETQ.ENT-7 pasa a 100 gr.
  No toca stock, saltea lo que alguien ya haya cambiado a mano, aborta si una etiqueta no está
  como se auditó y deja cada cambio en Movimientos. Probado con PGlite sobre una copia de esos
  datos (corrida, re-corrida, receta tocada a mano, etiqueta renombrada).
- **Conteo de materia prima** (sección nueva): planilla Excel para el depósito ("Conteo" +
  "Gramos por producto") y un formulario por materia prima que guarda JUNTOS la unidad, el mínimo,
  el conteo y los gramos de cada receta que la usa. Las sugerencias salen sólo de datos reales:
  contenido neto de la presentación (polvos, setas, creatina) y "60 cápsulas × 500 mg" de la
  tienda (30 g por bolsita). Con datos del 30/09: 88 de 148 líneas de receta tienen sugerencia;
  extractos, aceites, geles y mezclas los tiene que dar producción, y hasta tenerlos esa materia
  prima no se puede pasar (una receta en "1" descontaría 1 g).

## Qué falta decidir (no es de código)

1. **Gramos de extractos, aceites, geles y mezclas.** Los da producción en la hoja "Gramos por
   producto" de la planilla de conteo.
2. **Mezclas (blends).** Existen MP-41 "Ashw + ML", MP-44 "Cordy + ML", MP-45 "Cúrcuma+PN+J+Vit C",
   MP-45-2 "Tremella plus" y MP-42 "Blend cacao + ML" que ninguna receta usa: los productos
   combinados descuentan cada hongo por separado (o sólo Melena). Hay que definir si la receta del
   producto consume la mezcla o los ingredientes sueltos.
3. **Envases por tamaño.** Todos los polvos, de 30 g a 1 kg, descuentan la misma bolsa INS-05
   (Doypack 12×20). Las cajas por extracto (INS-50 a 53, INS-33) no las usa ninguna receta.
4. **Etiquetas sin tamaño propio**: Citrato de Potasio 500 g, Citrato de Magnesio 1 kg, cacaos
   125 g, Tremella entera, Maca (la etiqueta dice 90 u y el producto 60 u).
5. **Productos que la tienda vende y el stock no tiene**: Bicarbonato 500 g (8 u el 29/09),
   Tremella Gel base 250/500 g/1 kg (existen GEL-1 y GEL-2 en stock pero sin vincular), Creatina
   500 g y 1 kg, deshidratados de 500 g/1 kg, y artículos de reventa (cepillos de bambú, piedra de
   alumbre, serums, shampoo sólido).
6. **Después de corregir recetas: un conteo físico de todo**, cargado como "Corrección por conteo
   físico". Contar antes de corregir las recetas sirve de poco.

## Scripts SQL que siguen sin correrse en Supabase

- `supabase/vincular_espirulina_2026-09-24.sql` — las ventas de Espirulina no descuentan
  (25 unidades desde agosto).
- `supabase/stock_para_remito_2026-09-24.sql` — sin esto el remito del panel dice "sin vínculo" a
  quien no está en `st_users`.
- `supabase/usuarios_sincronizados_2026-09-24.sql` — `st_users` sigue con 5 personas.
