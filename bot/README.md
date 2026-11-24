# Bot de stock por Telegram

Un agente (n8n + Gemini) que todos los días les pregunta a los chicos de producción qué pasó con el stock, entiende lo que tipean aunque escriban mal el producto, lo compara con la plataforma y propone los movimientos. **Nada se carga hasta que la persona toca "Confirmar".**

| Archivo | Qué es |
|---|---|
| `n8n/bot-stock-telegram.json` | El flujo para importar en n8n |
| `n8n/generar_flujo.py` | De acá sale el JSON (prompt, cuerpos de las llamadas). Si cambiás algo, regenerá con `python bot/n8n/generar_flujo.py` |
| `../supabase/bot_stock_telegram_2026-11-22.sql` | Las funciones `st_bot_*` que usa el bot |
| `alta_usuarios_bot.sql` | Para dar de alta a cada persona en el bot |
| `pruebas/test_bot.mjs` | 81 pruebas del SQL sobre PGlite con los scripts de produccion: `node bot/pruebas/test_bot.mjs` |

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

- **El agente nunca escribe.** Solo arma propuestas. La carga la hace n8n cuando la persona toca el botón: el modelo no puede confirmarse a sí mismo.
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

### 3. n8n

Hoy corre **gratis en la compu de Frani** (n8n local + un túnel público https). Para arrancarlo:

```powershell
powershell -ExecutionPolicy Bypass -File C:\Users\frani\somos-setas-stock\bot\local\iniciar-bot.ps1
```

`bot/local/iniciar-bot.ps1` abre el túnel (tunnelmole, tarda ~40 s), toma la dirección nueva y arranca n8n con ella como `WEBHOOK_URL`. Como el flujo está activo, n8n le pasa solo la dirección nueva a Telegram. Hay que dejar esa ventana abierta: **el bot responde solo con la compu prendida y la ventana abierta**, y la pregunta de las 12 h no sale si está apagada. El editor queda en <http://localhost:5678>.

Para que ande siempre, el mismo flujo se puede importar en n8n Cloud (pago) o en un servidor propio, sin cambios. En ese caso:

1. **Workflows → Import from file** → `bot/n8n/bot-stock-telegram.json`.
2. Creá las tres credenciales que pide (los nodos quedan marcados en rojo hasta elegirlas):
   - **Telegram API** "Telegram bot Stock Somos Setas": el token de BotFather.
   - **Google Gemini (PaLM) API** "Gemini Somos Setas": una clave de <https://aistudio.google.com/apikey>.
   - **Custom Auth** "Supabase Somos Setas (clave secreta)": en Supabase → Project Settings → API Keys, la clave **secreta** (nunca la publishable). Según cómo empiece:
     - si empieza con `sb_secret_`:
       ```json
       { "headers": { "apikey": "sb_secret_..." } }
       ```
     - si es la vieja `service_role` (empieza con `eyJ`):
       ```json
       { "headers": { "apikey": "eyJ...", "Authorization": "Bearer eyJ..." } }
       ```
3. Revisá en **Settings** del flujo que la zona horaria sea `America/Argentina/Buenos_Aires`.
4. Guardá y **activá** el flujo (Publish / Active). Recién activo Telegram le manda los mensajes.

### 4. Dar de alta a cada persona

El bot solo atiende a gente habilitada, porque puede cambiar el stock real. Habilitar a alguien es así:

1. La persona busca el bot en Telegram y le escribe. El bot le pide el **mail con el que entra a la plataforma de stock**.
2. Si ese mail es **admin activo** en `st_users`, a quien aprueba accesos le llega un aviso con **Aprobar / Rechazar**. Si no lo es, el bot se lo dice y no avisa a nadie (el invitado no puede cargar).
3. Al aprobar, la persona recibe "Ya estás habilitado". Un rechazo la frena 24 h.

El primer aprobador se da de alta a mano con `bot/alta_usuarios_bot.sql` (columna `aprueba = true`). Para que otra persona también apruebe: `update st_bot_usuarios set aprueba = true where chat_id = …;`

### 5. Probar

- Escribile al bot: "¿cuánto hay de melena cápsulas?" → responde con estante, reservado y disponible.
- "Hoy hicimos 20 de melena en cápsulas" → muestra la propuesta con lo que descuenta de la receta. Tocá **Cancelar** para no cargar nada.
- Para probar la pregunta diaria sin esperar a las 12: abrí el nodo "Todos los días 12 h" y tocá **Execute step**.

## Uso de todos los días (versión local)

1. Prendé la compu y corré `bot/local/iniciar-bot.ps1` (ver arriba). Esperá ~1 minuto, hasta que la ventana diga que n8n está listo.
2. Dejá esa ventana abierta todo el día, sobre todo a las 12 h, que es cuando sale la pregunta.
3. Si el bot no contesta, abrí `https://api.telegram.org/bot<TOKEN>/getWebhookInfo`. Si `url` está vacío, en n8n apagá el flujo, esperá 5 segundos y prendelo de nuevo. Puede pasar después de guardar cambios en el flujo.

Sumar a alguien del equipo: le escribe al bot, manda su mail de la plataforma y te llega Aprobar / Rechazar.

## Cambiar cosas

- **Hora o días de la pregunta**: nodo "Todos los días 12 h" (cron `0 12 * * 1-6`, lunes a sábado).
- **Quién recibe la pregunta**: `update st_bot_usuarios set resumen_diario = false where chat_id = …;`
- **Sacarle el acceso a alguien**: `update st_bot_usuarios set activo = false where chat_id = …;` (o desactivarlo en `st_users`).
- **Modelo**: nodo "Gemini". Viene con `gemini-3.5-flash` y de respaldo `gemini-3.5-flash-lite` (la 2.5 ya no la dan a cuentas nuevas y la 3.8 suele estar saturada); se puede elegir otro de la lista. Si Google lo tiene saturado (error 503), el agente pasa solo al nodo "Gemini respaldo", que tiene que ser **otro** modelo.
- **Cómo habla o qué reglas sigue**: el prompt está en `n8n/generar_flujo.py` (`PROMPT`). Regenerá el JSON y volvé a importar, o editá el mensaje de sistema directo en el nodo "Agente de stock".

## Qué quedó afuera (por ahora)

- **Audios.** Solo lee texto. Gemini puede transcribir notas de voz: es un agregado chico si lo usan mucho.
- **Mail a la clienta al pasar a En preparación.** El aviso por mail lo dispara el panel con la sesión de quien cambia el estado. Si el bot pasa un pedido, el panel lo va a mostrar como "sin avisar" y se puede mandar desde ahí.
- **Recordatorio si no contestan.** Queda registrado en `st_bot_checkins` (quién contestó cada día); un segundo aviso a la mañana siguiente es fácil de sumar.
- **Memoria.** La charla se recuerda en la memoria simple de n8n (últimos 20 mensajes por chat). Si n8n se reinicia se pierde el hilo, pero no las propuestas, que viven en la base.
