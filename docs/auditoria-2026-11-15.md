# Auditoría del stock — 15/11/2026

Segunda auditoría completa (la anterior fue el 30/09). Se revisó el código y la base de producción
en modo solo lectura.

## Conclusión

Las cuentas siguen cerrando: en 1.405 movimientos de producto del último mes, cada "antes → después"
encadena con el siguiente. Lo que desacomoda el stock son los datos de materia prima y la forma de
cargar.

## Qué se encontró

1. **Materia prima a medio migrar.** De 150 líneas de receta (sin contar la cápsula), 63 piden
   gramos y 87 siguen pidiendo "1", mientras el stock está contado en kilos o bolsas. Poner "kg" en
   la ficha no convierte nada: cada bolsita de Ashwagandha descuenta "30" de un número en bolsas.
   35 de 67 materias primas están en negativo. Hay nombres repetidos: Melena (MP-27 y MP-X01),
   Reishi (MP-30 y MP-X02), Bisglicinato (MP-20, MP-50 y MP-56).
2. **Las llegadas casi no se cargan como llegadas.** 13 ingresos en toda la historia; lo que llega
   entra como conteo físico.
3. **Producción registrada a medias.** En 45 días: 3.432 unidades vendidas, 2.590 producidas y 1.454
   que aparecieron por conteo. 39 de 105 productos vendidos no tienen ninguna producción cargada.
   Lo que entra por conteo no descuenta etiqueta, envase ni materia prima.
4. **Remitos con líneas escritas a mano.** 282 líneas (unas 1.050 unidades, 15 % de lo vendido) no
   descontaron stock: reventa que no existe en Stock y productos propios vendidos a granel o sin
   etiqueta.
5. **Conteo con pedidos en preparación.** La tienda descuenta al confirmar; si se cuenta el estante
   antes de despachar, el conteo vuelve a sumar lo ya vendido.
6. **Vínculo con la web.** 153 presentaciones; una sola rota (Cepillo Amarillo → CAP-37, eliminado
   el 03/11). Siete deshidratados y Hibiscus cápsulas comparten un ítem entre tamaños.
7. **Recetas incompletas.** 5 productos sin receta, 16 sin materia prima, 14 sin etiqueta, 15 sin
   envase.

## Qué se cambió

**Stock**

- *Conteo materia prima*: una materia prima queda pendiente mientras no esté en gramos, mililitros
  o unidades, alguna receta le pida "1" o esté en negativo; cada fila dice el motivo. Las recetas
  que ya estaban en gramos se confirman con "Dejar 30".
- Campo nuevo "Cada envase de compra trae" (por ejemplo 5.000 g).
- *Llegó una compra*: se cargan envases o packs y el sistema suma el contenido; se puede anotar
  proveedor o remito y queda en el historial.
- La ficha de materia prima ya no ofrece kilos ni litros.
- *Contar el estante*: avisa qué productos tienen pedidos confirmados sin despachar y pide decir si
  esa mercadería estaba en el estante (se resta del conteo) o apartada.
- *Revisión de datos*: avisos nuevos de materia prima en kilos, recetas en "1" y nombres repetidos.
- *Pedidos de la tienda*: una línea marcada "No sale del depósito" ya no figura como sin vincular.

**Panel de la tienda (remito)**

- Una línea escrita a mano propone el ítem del stock más parecido para vincularlo con un toque.
- Botón "No sale del depósito" para lo que no es mercadería.
- Antes de guardar, imprimir o descargar con líneas sin descontar, pregunta una vez.

**Base** (`supabase/auditoria_2026-11-15.sql`): lectura del inventario para todos los usuarios del
panel y el cepillo amarillo vinculado a OTR-04.

## 16/11: el pedido descuenta en "En preparación"

`supabase/descuento_en_preparacion_2026-11-16.sql` cambia cuándo descuenta un pedido:

| Estado | Qué pasa con el stock |
|---|---|
| Nuevo | Nada |
| Confirmado | Queda **reservado**: se anota qué va a descontar, sin tocar el stock |
| En preparación, Enviado, Entregado | Descuenta (de Confirmado directo a Enviado también) |
| Anulado, o vuelve a Nuevo | Devuelve lo descontado y libera la reserva |
| Vuelve de En preparación a Confirmado | Devuelve y queda reservado otra vez |

En Stock, Productos muestra "En el estante" y "Disponible" (con las reservadas abajo). Los
avisos de stock bajo, el contador del menú y Reposición miran el disponible. Pedidos de la
tienda muestra "Reservado · N u" en los confirmados.

Regla para el equipo: **pasar el pedido a "En preparación" cuando se empieza a armar.**

## Qué tiene que hacer el equipo (no es de código)

1. **Pasar cada materia prima a gramos** desde "Conteo materia prima": pesar lo que hay, cargar
   cuánto trae el envase y completar las recetas que dicen "1". Producción tiene que dar los gramos
   de extractos, aceites y mezclas.
2. **Decidir las repetidas**: si Melena MP-27 y MP-X01 son lo mismo, dejar una; si son polvo y
   entero, ponerlo en el nombre.
3. **Dar de alta la reventa** que se vende por remito y no existe en Stock: serums, agua de rosas,
   piedra de alumbre, pasta dental, aceites (argán, coco, rosa mosqueta, almendras, ricino), jabones,
   shampoo, acondicionador, crema.
4. **Deshidratados**: definir si el medio kilo y el kilo se arman de la materia prima suelta (va un
   producto por tamaño, con "Duplicar") o juntando bolsitas (se corrige la cantidad del vínculo).
5. **En la web hay dos "Cepillo de Dientes Amarillo (Suave)"** visibles: ocultar uno.

## Cómo usar la plataforma

| Cuándo | Qué |
|---|---|
| En el momento | Producción al terminar el lote, compra al recibirla, consumo interno o rotura |
| Una vez al día | Mirar negativos y Revisión de datos |
| Una vez por semana | Contar los 15 a 20 productos que más se venden |
| Una vez al mes | Contar el resto, las etiquetas y los insumos, y pesar la materia prima |

El conteo sirve para verificar, no para cargar. La señal de que va bien: que los conteos casi no
muevan el número.

## Pruebas

`npm run banco` → `await __banco.pruebas()`: 29 pruebas (la 9 se reescribió y la 29 es nueva el 16/11). Las nuevas son la 25 (compra por envases),
26 (materia prima en kilos), 27 (conteo con pedidos sin despachar) y 28 (línea que no sale del
depósito).
