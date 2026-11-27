# Bot de stock por Telegram

Un agente (Gemini) que todos los días les pregunta a los chicos de producción qué pasó con el stock, entiende lo que tipean aunque escriban mal el producto, lo compara con la plataforma y propone los movimientos. **Nada se carga hasta que la persona toca "Confirmar".**

**Desde el 27/11/2026 corre en Supabase** (Edge Function `bot-stock` + pg_cron), gratis y sin depender de ninguna compu. Antes corría en n8n en la compu de Frani; eso quedó apagado y sus archivos (`n8n/`, `local/`) solo sirven de referencia.

| Archivo | Qué es |
|---|---|
| `../supabase/functions/bot-stock/bot.ts` | El bot: mensajes, botones, agente con sus 6 herramientas, prompt y pregunta diaria |
| `../supabase/functions/bot-stock/index.ts` | La entrada de la función: controla la clave y atiende a Telegram, a pg_cron y la configuración |
| `../supabase/bot_stock_telegram_2026-11-22.sql` | Las funciones `st_bot_*` que usa el bot (la lógica de stock) |
| `../supabase/bot_stock_supabase_2026-11-27.sql` | Memoria de la charla, mensajes ya atendidos, clave en Vault y la pregunta diaria con pg_cron |
| `alta_usuarios_bot.sql` | Para dar de alta a mano a una persona |
| `pruebas/test_bot.mjs` | 87 pruebas del SQL sobre PGlite con los scripts de producción: `node bot/pruebas/test_bot.mjs` |
| `pruebas/test_funcion.mjs` | 45 pruebas de la función con Supabase, Telegram y Gemini simulados: `node bot/pruebas/test_funcion.mjs` |
| `n8n/`, `local/` | La versión vieja en n8n (ya no se usa) |

## Cómo funciona

```
Telegram ──► ¿botón o mensaje?
                │
     mensaje ───┤──► ¿chat habilitado? ──► Agente (Gemini + memoria + 6 herramientas)
                │                              │
                │                              ├─ buscar_items / ver_item / pedidos_web
                │                              ├─ movimientos_recientes / resumen_del_dia
                │                              └─ preparar_movimientos  ──► queda PENDIENTE
                │                                                          (no toca stock)
                │                          responde + muestra la propuesta con [Confirmar] [Cancelar]
                │
      botón ────┴──► Confirmar ──► st_bot_confirmar ──► st_aplicar (mismas reglas de la plataforma)
                     Cancelar  ──► st_bot_cancelar
                     Sin novedades ──► se anota

Lunes a sábado 12 h ──► resumen del día ──► pregunta a cada persona con [Sin novedades hoy]
```

- **El agente nunca escribe.** Solo arma propuestas. La carga la hace la función cuando la persona toca el botón: el modelo no puede confirmarse a sí mismo.
- **Mismas reglas que la plataforma.** Producir suma el producto y descuenta la receta en la base, una venta resta solo el producto terminado, un conteo fija el número. Todo pasa por `st_aplicar`, con los mismos bloqueos para que dos cargas al mismo tiempo no se pisen.
- **Pedidos de la web.** La plataforma solo descuenta los pedidos En preparación, Enviado o Entregado. Si reportan una salida que corresponde a un pedido en Confirmado, el bot lo cuenta y pregunta si lo pasa a En preparación (ahí descuenta la plataforma). Así no se descuenta dos veces.
- **Corregir.** "Me equivoqué, eran 15" → el bot busca el movimiento y propone deshacerlo y cargar el correcto, en la misma confirmación. Se puede deshacer cualquier movimiento hecho desde la plataforma (por el bot o a mano). Los de pedidos web se corrigen cambiando el estado del pedido.
- **Trazabilidad.** Cada movimiento queda a nombre de quien confirmó (su mail de `st_users`), con la nota `[bot]`, y aparece en Movimientos como cualquier otro.
- **Todo o nada.** Si una línea de la propuesta falla (alguien borró el ítem, el pedido cambió de estado), no se carga ninguna. Una propuesta no se puede confirmar dos veces, vence a las 3 horas y la anterior queda vieja cuando se arma una nueva.

## Puesta en marcha

### 1. Base de datos (una vez)

En el SQL Editor de Supabase (proyecto de Somos Setas), en este orden:

1. Si todavía no se corrió: `supabase/descuento_en_preparacion_2026-11-16.sql`. El script del bot se frena solo si falta.
2. `supabase/bot_stock_telegram_2026-11-22.sql`. Se puede correr más de una vez y no toca stock ni pedidos. Al final tiene que decir `funciones del bot: 23 | usuarios del bot: 0`.

### 2. Bot de Telegram

1. En Telegram, abrí **@BotFather** → `/newbot` → nombre "Stock Somos Setas" y un usuario terminado en `bot`.
2. Guardá el token que te da.
3. Opcional: `/setdescription` y `/setuserpic` con el logo.

### 3. Función en Supabase (una vez)

Desde la carpeta del repo, con la CLI de Supabase con sesión iniciada (`npx supabase login`):

1. En el SQL Editor (o con `npx supabase db query --remote=muuqqbocpumdvhvxsigz -f …`): `supabase/bot_stock_supabase_2026-11-27.sql`. Crea la clave interna en Vault y programa la pregunta diaria. Al final tiene que decir `clave: ok | pregunta diaria: 0 15 * * 1-6`.
2. Los secretos de la función (Supabase → Edge Functions → Secrets, o `npx supabase secrets set --remote=muuqqbocpumdvhvxsigz …`):
   - `TELEGRAM_TOKEN`: el token de BotFather (tal cual, sin `=` adelante).
   - `GEMINI_API_KEY`: una clave de <https://aistudio.google.com/apikey>.
   - `GEMINI_MODELOS` (opcional): principal y respaldo separados por coma. Por defecto `gemini-3.5-flash,gemini-3.5-flash-lite`.
   - La URL y la clave secreta de Supabase ya las tiene la función sola.
3. Publicar (sin verificación de JWT, porque Telegram no manda uno):
   ```powershell
   npx supabase functions deploy bot-stock --no-verify-jwt --remote=muuqqbocpumdvhvxsigz --use-api
   ```
4. Decirle a Telegram que mande los mensajes a la función. Se hace una vez (y de nuevo si cambia el token):
   ```powershell
   curl.exe -X POST https://muuqqbocpumdvhvxsigz.supabase.co/functions/v1/bot-stock -H "x-bot-token: <TOKEN>" -H "Content-Type: application/json" -d '{\"tarea\":\"configurar\"}'
   ```
   Responde `ok: true` con la dirección nueva. Ojo: si alguien vuelve a prender el flujo viejo de n8n, Telegram pasa a mandarle los mensajes a n8n otra vez.

Cómo se protege: la función solo atiende pedidos que traen la clave interna (`bot_stock_clave` en Vault). Telegram la manda en cada mensaje (header `X-Telegram-Bot-Api-Secret-Token`) y pg_cron en la pregunta diaria (`x-bot-clave`). Para configurar el webhook hay que tener el token del bot. A cada mensaje se le contesta a Telegram al instante y se procesa en segundo plano; si Telegram igual lo reintenta, `st_bot_update_nuevo` evita atenderlo dos veces.

### 4. Dar de alta a cada persona

El bot solo atiende a gente habilitada, porque puede cambiar el stock real. Habilitar a alguien es así:

1. La persona busca el bot en Telegram y le escribe. El bot le pide el **mail con el que entra a la plataforma de stock**.
2. Si ese mail es **admin activo** en `st_users`, a quien aprueba accesos le llega un aviso con **Aprobar / Rechazar**. Si no lo es, el bot se lo dice y no avisa a nadie (el invitado no puede cargar).
3. Al aprobar, la persona recibe "Ya estás habilitado". Un rechazo la frena 24 h.

El primer aprobador se da de alta a mano con `bot/alta_usuarios_bot.sql` (columna `aprueba = true`). Para que otra persona también apruebe: `update st_bot_usuarios set aprueba = true where chat_id = …;`

### 5. Probar

- Escribile al bot: "¿cuánto hay de melena cápsulas?" → responde con estante, reservado y disponible.
- "Hoy hicimos 20 de melena en cápsulas" → muestra la propuesta con lo que descuenta de la receta. Tocá **Cancelar** para no cargar nada.
- La pregunta diaria sale sola de lunes a sábado a las 12 h. Para ver si salió: `select * from cron.job_run_details order by start_time desc limit 5;` y la respuesta de la función en `select * from net._http_response order by created desc limit 5;`.

## Si el bot no contesta

1. Supabase → Edge Functions → `bot-stock` → **Logs**: ahí aparecen los errores (con `[bot-stock]`).
2. `https://api.telegram.org/bot<TOKEN>/getWebhookInfo`: la `url` tiene que ser la de la función y `last_error_message` vacío. Si apunta a otro lado (por ejemplo a un túnel de n8n), repetí el paso 4 de la puesta en marcha.
3. Si Gemini está saturado, la función pasa sola al modelo de respaldo; si fallan los dos, el bot avisa "tuve un problema" y no carga nada.

Sumar a alguien del equipo: le escribe al bot, manda su mail de la plataforma y te llega Aprobar / Rechazar.

## Cambiar cosas

- **Hora o días de la pregunta**: el cron `bot-stock-pregunta-diaria` en `bot_stock_supabase_2026-11-27.sql` (`0 15 * * 1-6` = lunes a sábado 12 h de Argentina, porque pg_cron va en UTC). Cambialo ahí y volvé a correr el script.
- **Quién recibe la pregunta**: `update st_bot_usuarios set resumen_diario = false where chat_id = …;`
- **Sacarle el acceso a alguien**: `update st_bot_usuarios set activo = false where chat_id = …;` (o desactivarlo en `st_users`).
- **Modelo**: secreto `GEMINI_MODELOS` (principal primero, respaldo después). No hace falta volver a publicar.
- **Cómo habla o qué reglas sigue**: `armarPrompt` en `supabase/functions/bot-stock/bot.ts`. Después: correr `node bot/pruebas/test_funcion.mjs` y publicar (paso 3).

## Qué quedó afuera (por ahora)

- **Audios.** Solo lee texto. Gemini puede transcribir notas de voz: es un agregado chico si lo usan mucho.
- **Mail a la clienta al pasar a En preparación.** El aviso por mail lo dispara el panel con la sesión de quien cambia el estado. Si el bot pasa un pedido, el panel lo va a mostrar como "sin avisar" y se puede mandar desde ahí.
- **Recordatorio si no contestan.** Queda registrado en `st_bot_checkins` (quién contestó cada día); un segundo aviso a la mañana siguiente es fácil de sumar.
- **Memoria.** La charla vive en `st_bot_charla`: el agente recuerda los últimos 40 mensajes de las últimas 12 horas de cada chat (una charla de otro día confunde más de lo que ayuda). Se borra sola a los 7 días.
