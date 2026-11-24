"""Arma bot-stock-telegram.json (flujo de n8n) a partir de este archivo.

Se mantiene acá y no a mano en el JSON porque el prompt y los cuerpos de las
llamadas son largos y con comillas. Para regenerar:

    python bot/n8n/generar_flujo.py

No lleva claves: las credenciales se eligen en n8n después de importar.
"""
import json
import re
import uuid
from pathlib import Path

AQUI = Path(__file__).parent
SUPABASE = "https://muuqqbocpumdvhvxsigz.supabase.co/rest/v1/rpc/"
ZONA = "America/Argentina/Buenos_Aires"

CRED_SUPABASE = {"httpCustomAuth": {"name": "Supabase Somos Setas (clave secreta)"}}
CRED_TELEGRAM = {"telegramApi": {"name": "Telegram bot Stock Somos Setas"}}
CRED_GEMINI = {"googlePalmApi": {"name": "Gemini Somos Setas"}}

nodos = []
conexiones = {}


def nodo(nombre, tipo, version, pos, params, cred=None, **extra):
    n = {
        "parameters": params,
        "id": str(uuid.uuid5(uuid.NAMESPACE_URL, "ss-bot/" + nombre)),
        "name": nombre,
        "type": tipo,
        "typeVersion": version,
        "position": pos,
    }
    if cred:
        n["credentials"] = cred
    n.update(extra)
    nodos.append(n)
    return nombre


def unir(desde, hacia, salida=0, tipo="main", entrada=0):
    lst = conexiones.setdefault(desde, {}).setdefault(tipo, [])
    while len(lst) <= salida:
        lst.append([])
    lst[salida].append({"node": hacia, "type": tipo, "index": entrada})


def rpc(nombre, pos, funcion, cuerpo, **extra):
    """HTTP Request a una función de Supabase."""
    return nodo(nombre, "n8n-nodes-base.httpRequest", 4.2, pos, {
        "method": "POST",
        "url": SUPABASE + funcion,
        "authentication": "genericCredentialType",
        "genericAuthType": "httpCustomAuth",
        "sendBody": True,
        "specifyBody": "json",
        "jsonBody": cuerpo,
        "options": {},
    }, CRED_SUPABASE, **extra)


def herramienta(nombre, pos, funcion, descripcion, cuerpo):
    """HTTP Request Tool que usa el agente."""
    n = nodo(nombre, "n8n-nodes-base.httpRequestTool", 4.2, pos, {
        "toolDescription": descripcion,
        "method": "POST",
        "url": SUPABASE + funcion,
        "authentication": "genericCredentialType",
        "genericAuthType": "httpCustomAuth",
        "sendBody": True,
        "specifyBody": "json",
        "jsonBody": cuerpo,
        "options": {},
    }, CRED_SUPABASE)
    unir(n, "Agente de stock", tipo="ai_tool")
    return n


def telegram_texto(nombre, pos, chat, texto, botones=None):
    """Manda un mensaje en HTML.

    El nodo de Telegram usa Markdown si no se le dice nada, y un "_" o "*" en
    la respuesta del agente haría fallar el envío. En HTML los únicos
    caracteres especiales son &, < y >: se escapan en cada parte dinámica
    ({{ … }}). El texto fijo de este archivo no los usa.
    """
    assert not re.search(r"[&<>]", re.sub(r"\{\{.*?\}\}", "", texto, flags=re.S)), nombre
    texto = re.sub(
        r"\{\{\s*(.*?)\s*\}\}",
        lambda m: "{{ String(" + m.group(1) + ").replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') }}",
        texto, flags=re.S)
    if not texto.startswith("="):
        texto = "=" + texto
    params = {
        "chatId": chat,
        "text": texto,
        "additionalFields": {"appendAttribution": False, "parse_mode": "HTML"},
    }
    if botones:
        params["replyMarkup"] = "inlineKeyboard"
        params["inlineKeyboard"] = {"rows": [{"row": {"buttons": [
            {"text": t, "additionalFields": {"callback_data": d}} for t, d in botones
        ]}}]}
    return nodo(nombre, "n8n-nodes-base.telegram", 1.2, pos, params, CRED_TELEGRAM)


def telegram_editar(nombre, pos, texto):
    return nodo(nombre, "n8n-nodes-base.telegram", 1.2, pos, {
        "operation": "editMessageText",
        "chatId": "={{ $('Datos del botón').item.json.chat_id }}",
        "messageId": "={{ $('Datos del botón').item.json.message_id }}",
        "text": texto,
        "additionalFields": {},
    }, CRED_TELEGRAM)


def si(nombre, pos, condicion):
    """IF que mira una expresión booleana."""
    return nodo(nombre, "n8n-nodes-base.if", 2.2, pos, {
        "conditions": {
            "options": {"caseSensitive": True, "leftValue": "", "typeValidation": "loose", "version": 2},
            "conditions": [{
                "id": str(uuid.uuid5(uuid.NAMESPACE_URL, "cond/" + nombre)),
                "leftValue": condicion,
                "rightValue": "",
                "operator": {"type": "boolean", "operation": "true", "singleValue": True},
            }],
            "combinator": "and",
        },
        "options": {},
    })


def asignar(nombre, pos, campos):
    return nodo(nombre, "n8n-nodes-base.set", 3.4, pos, {
        "assignments": {"assignments": [
            {"id": str(uuid.uuid5(uuid.NAMESPACE_URL, f"set/{nombre}/{k}")), "name": k, "value": v, "type": t}
            for k, v, t in campos
        ]},
        "options": {},
    })


def nota(texto, pos, ancho, alto, color=7):
    nodos.append({
        "parameters": {"content": texto, "height": alto, "width": ancho, "color": color},
        "id": str(uuid.uuid5(uuid.NAMESPACE_URL, "nota/" + texto[:40])),
        "name": "Nota " + str(len(nodos)),
        "type": "n8n-nodes-base.stickyNote",
        "typeVersion": 1,
        "position": pos,
    })


CHAT = "$('Datos del mensaje').item.json.chat_id"

# ---------------------------------------------------------------------------
# Prompt del agente
# ---------------------------------------------------------------------------
PROMPT = """Sos el asistente de stock de Somos Setas (suplementos de hongos, Mendoza). Hablás por Telegram con {{ $('Datos del mensaje').item.json.nombre }}, del equipo de producción. Hoy es {{ $now.setZone('America/Argentina/Buenos_Aires').setLocale('es').toFormat("cccc d 'de' LLLL, HH:mm") }}.

Tu trabajo: que la plataforma de stock refleje la realidad. El equipo no carga todo en el día; vos les preguntás, interpretás lo que tipean (aunque escriban mal el nombre), lo comparás con lo que dice el sistema y proponés los movimientos para que los confirmen.

REGLA DE ORO
Nunca digas que algo "quedó cargado". Vos solo PROPONÉS con la herramienta preparar_movimientos. Abajo de tu respuesta, el sistema muestra la propuesta con los botones Confirmar / Cancelar, y recién ahí se carga. Después de llamar a preparar_movimientos respondé corto ("Te dejo la propuesta abajo, revisala y confirmá") sin repetir la lista, y agregá solo lo que haya que aclarar.

CÓMO TRABAJAR
1. Por cada producto o insumo que nombren, usá buscar_items. Nunca inventes un código. Si hay varias opciones parecidas (por ejemplo distintos tamaños: 50 g, 100 g, 500 g, 1 kg, o cápsulas vs polvo) y no queda claro cuál es, preguntá mostrando las opciones con su código. Si una opción es claramente la correcta, usala sin preguntar.
2. Si falta un dato (cuánto, de qué tamaño), preguntá una sola cosa por vez, corto.
3. Cuando tengas todo, juntá TODOS los movimientos de la charla en UNA sola llamada a preparar_movimientos.
4. Si preparar_movimientos devuelve errores, corregí lo que puedas (buscá de nuevo el código) o preguntá. Si devuelve avisos (algo queda en negativo, receta incompleta), contalos en una línea.

TIPOS DE MOVIMIENTO
- produccion: se fabricó un producto terminado. Solo categoría producto. Suma el producto y la plataforma descuenta sola la receta (etiquetas, envases, materia prima). Cantidad en unidades enteras (frascos, bolsas); los productos de tipo Gel van en kilos (0,25 / 0,5 / 1).
- venta: salió vendido algo que NO pasó por la tienda web (feria, local, venta en mano, un cliente que pasó a buscar sin pedido web).
- consumo_interno: muestras, regalos, uso del equipo, roturas, vencidos. Sirve para cualquier categoría.
- ingreso: llegó una compra (insumos, etiquetas, materia prima, reventa). La cantidad va en la unidad del ítem que devuelve buscar_items (campo unidad: g, ml o u). Si dicen "2 bolsas de 5 kg" y la unidad es g, son 10000. Si no sabés cuánto trae el envase, preguntá. Un producto que fabricaron ellos no es ingreso, es produccion.
- ajuste: conteo físico; la cantidad es lo que HAY en el estante, no la diferencia.
- pasar_a_preparacion: pasa un pedido web de Confirmado a En preparación (ahí la plataforma descuenta el stock sola). Solo con el OK de la persona.
- revertir: deshace un movimiento cargado desde la plataforma (por el bot o a mano). Para corregir "eran 15, no 20": revertir el movimiento equivocado y cargar el correcto, las dos acciones en la misma propuesta.

PEDIDOS DE LA WEB (muy importante)
La plataforma descuenta sola los pedidos web cuando pasan a "En preparación" (también Enviado y Entregado). "Confirmado" solo reserva: todavía no descontó.
Antes de cargar una venta, mirá pedidos_web:
- Si lo que salió corresponde a un pedido En preparación, Enviado o Entregado: ya está descontado. NO cargues venta y avisale.
- Si corresponde a un pedido Confirmado: contale que todavía no se descontó y preguntale si querés que lo pases a En preparación (acción pasar_a_preparacion). No cargues una venta suelta para ese pedido: se descontaría dos veces.
- Si no hay pedido web que coincida: es venta fuera de la web.
Los movimientos de pedidos web no se deshacen con revertir: se corrigen cambiando el estado del pedido en el panel de la tienda.

CONTEOS DEL ESTANTE
buscar_items devuelve en_estante (lo que dice el sistema), reservado (pedidos Confirmados: siguen físicamente en el estante y están incluidos en en_estante) y por_despachar (pedidos En preparación: ya descontados del sistema). Si te pasan un conteo de un producto con por_despachar mayor a 0, preguntá si esas unidades ya estaban apartadas o si las contaron en el estante; si las contaron, restáselas al conteo antes de proponer el ajuste.

VALIDAR
Compará siempre lo que te cuentan con el sistema. Si una venta deja un producto en negativo, si una producción deja una materia prima en negativo, o si un número parece raro (por ejemplo 200 cuando siempre producen 20), decilo y preguntá. Si te dan un número de stock distinto al del sistema, proponé un ajuste.
Si preguntan "¿cuánto hay de X?", respondé con buscar_items o ver_item (estante, reservado, disponible).
Si preguntan si algo quedó cargado, fijate en movimientos_recientes.

LA PREGUNTA DE CADA DÍA
Todos los días el bot les manda: ¿hubo producción?, ¿salió mercadería fuera de la web?, ¿llegó alguna compra?, ¿hay algo para corregir? Si el mensaje responde a eso, procesá cada parte. Si dicen que no hubo nada, agradecé y listo. Podés usar resumen_del_dia para ver qué ya está cargado hoy y no duplicarlo.

ESTILO
Voseo, cálido y corto, como un compañero. Texto plano para Telegram: sin tablas, sin asteriscos ni negritas, como mucho guiones para listar. Usá los nombres de los productos como figuran en el sistema y el código entre paréntesis. No muestres datos personales de clientes más allá del nombre de pila. Si te piden algo que no tiene que ver con el stock, decí amablemente que solo ayudás con el stock."""

# ---------------------------------------------------------------------------
# Rama 1 · Mensajes y botones de Telegram
# ---------------------------------------------------------------------------
nodo("Telegram", "n8n-nodes-base.telegramTrigger", 1.2, [0, 300], {
    "updates": ["message", "callback_query"],
    "additionalFields": {},
}, CRED_TELEGRAM, webhookId=str(uuid.uuid5(uuid.NAMESPACE_URL, "ss-bot/webhook")))

si("¿Tocó un botón?", [220, 300], "={{ !!$json.callback_query }}")
unir("Telegram", "¿Tocó un botón?")

# --- Mensajes ---
asignar("Datos del mensaje", [440, 420], [
    ("chat_id", "={{ $json.message.chat.id }}", "number"),
    ("privado", "={{ $json.message.chat.type === 'private' }}", "boolean"),
    ("nombre", "={{ $json.message.from.first_name || 'equipo' }}", "string"),
    ("texto", "={{ ($json.message.text || $json.message.caption || '').trim() }}", "string"),
    ("usuario", "={{ $json.message.from.username || '' }}", "string"),
])
unir("¿Tocó un botón?", "Datos del mensaje", salida=1)

rpc("¿Quién escribe?", [660, 420], "st_bot_quien", "={{ JSON.stringify({ p_chat_id: $json.chat_id }) }}")
unir("Datos del mensaje", "¿Quién escribe?")

si("¿Está habilitado?", [880, 420], "={{ $json.habilitado === true && $('Datos del mensaje').item.json.privado }}")
unir("¿Quién escribe?", "¿Está habilitado?")

# --- Gente nueva: pide acceso con su mail y alguien con permiso lo aprueba ---
MSG = "$('Datos del mensaje').item.json"
si("¿Mandó su mail?", [1100, 960], "={{ /[^\\s@]+@[^\\s@]+\\.[^\\s@]+/.test(" + MSG + ".texto) }}")
unir("¿Está habilitado?", "¿Mandó su mail?", salida=1)

telegram_texto("Pedir el mail", [1320, 1140], "={{ " + MSG + ".chat_id }}",
    "=Hola {{ " + MSG + ".nombre }} 👋 Soy el bot de stock de Somos Setas.\n\n"
    "Para usarlo te tengo que habilitar: escribime el mail con el que entrás a la plataforma de stock "
    "y le paso el pedido a quien aprueba los accesos.")
unir("¿Mandó su mail?", "Pedir el mail", salida=1)

rpc("Pedir acceso", [1320, 960], "st_bot_solicitar",
    "={{ JSON.stringify({ p_chat_id: " + MSG + ".chat_id, "
    "p_nombre: " + MSG + ".nombre + (" + MSG + ".usuario ? ' (@' + " + MSG + ".usuario + ')' : ''), "
    "p_email: (" + MSG + ".texto.match(/[^\\s@]+@[^\\s@]+\\.[^\\s@]+/) || [''])[0] }) }}")
unir("¿Mandó su mail?", "Pedir acceso")

telegram_texto("Responder el pedido", [1540, 960], "={{ " + MSG + ".chat_id }}",
    "={{ $('Pedir acceso').item.json.motivo }}")
unir("Pedir acceso", "Responder el pedido")

nodo("A quién pedirle", "n8n-nodes-base.code", 2, [1760, 960], {
    "mode": "runOnceForAllItems",
    "jsCode": r"""// Un aviso por cada persona que puede aprobar. Si el pedido no fue válido
// o es repetido, no sale ninguno.
const r = $('Pedir acceso').first().json;
if (!r.ok || r.repetido) return [];
return (r.aprobadores || []).map(a => ({ json: {
  chat_id: a.chat_id,
  texto: `🔑 Pedido de acceso al bot de stock\n\n${r.solicitante.nombre}\n${r.solicitante.email}\n\n` +
         `Si lo aprobás, va a poder cargar y corregir stock desde Telegram.`,
  solicitante: r.solicitante.chat_id,
}}));
""",
})
unir("Responder el pedido", "A quién pedirle")

telegram_texto("Pedir aprobación", [1980, 960], "={{ $json.chat_id }}", "={{ $json.texto }}",
    botones=[("✅ Aprobar", "=apr:{{ $json.solicitante }}"), ("❌ Rechazar", "=rec:{{ $json.solicitante }}")])
unir("A quién pedirle", "Pedir aprobación")

rpc("Anotar que respondió", [1100, 420], "st_bot_checkin",
    "={{ JSON.stringify({ p_chat_id: $('Datos del mensaje').item.json.chat_id, p_sin_novedades: false }) }}")
unir("¿Está habilitado?", "Anotar que respondió")

si("¿Mandó texto?", [1320, 420], "={{ $('Datos del mensaje').item.json.texto !== '' }}")
unir("Anotar que respondió", "¿Mandó texto?")

telegram_texto("Pedir texto", [1540, 600], "={{ $('Datos del mensaje').item.json.chat_id }}",
    "Por ahora solo leo mensajes de texto ✍️ Escribime qué pasó con el stock y lo acomodo.")
unir("¿Mandó texto?", "Pedir texto", salida=1)

nodo("Agente de stock", "@n8n/n8n-nodes-langchain.agent", 2.2, [1560, 400], {
    "promptType": "define",
    "needsFallback": True,
    "text": "={{ $('Datos del mensaje').item.json.texto }}",
    "options": {"systemMessage": "=" + PROMPT, "maxIterations": 15},
}, onError="continueErrorOutput")
unir("¿Mandó texto?", "Agente de stock")

telegram_texto("Avisar del error", [1960, 600], "={{ " + CHAT + " }}",
    "Uy, tuve un problema para procesar eso y no cargué nada 😕 Probá de nuevo en un ratito. "
    "Si sigue pasando, avisale a Frani.")
unir("Agente de stock", "Avisar del error", salida=1)

nodo("Gemini", "@n8n/n8n-nodes-langchain.lmChatGoogleGemini", 1, [1300, 700], {
    "modelName": "models/gemini-3.5-flash",
    "options": {"temperature": 0.2},
}, CRED_GEMINI)
unir("Gemini", "Agente de stock", tipo="ai_languageModel")

# Respaldo: si Google tiene saturado el modelo principal (error 503) o lo da de baja,
# el agente usa este. Tiene que ser OTRO modelo; se elige de la lista del nodo.
nodo("Gemini respaldo", "@n8n/n8n-nodes-langchain.lmChatGoogleGemini", 1, [1312, 704], {
    "modelName": "models/gemini-3.5-flash-lite",
    "options": {"temperature": 0.2},
}, CRED_GEMINI)
unir("Gemini respaldo", "Agente de stock", tipo="ai_languageModel", entrada=1)

nodo("Memoria de la charla", "@n8n/n8n-nodes-langchain.memoryBufferWindow", 1.3, [1440, 700], {
    "sessionIdType": "customKey",
    "sessionKey": "={{ 'stock-' + " + CHAT + " }}",
    "contextWindowLength": 20,
})
unir("Memoria de la charla", "Agente de stock", tipo="ai_memory")

# --- Herramientas del agente ---
herramienta("buscar_items", [1580, 700], "st_bot_buscar",
    "Busca productos, insumos, etiquetas o materias primas por nombre o código, aunque estén mal escritos. "
    "Devuelve hasta 8 opciones con codigo, categoria, nombre, unidad, en_estante, reservado, disponible, "
    "por_despachar y parecido (1 = coincide). Usala SIEMPRE antes de proponer un movimiento.",
    "={{ JSON.stringify({ p_texto: $fromAI('texto', 'Lo que escribió la persona para nombrar el ítem, por ejemplo \"melena capsulas\" o \"POL 39\"', 'string'), "
    "p_categoria: $fromAI('categoria', 'Opcional. Una de: producto, insumo, insumo_interno, etiqueta, materia_prima. Vacío para buscar en todas', 'string') || null, "
    "p_limite: 8 }) }}")

herramienta("ver_item", [1720, 700], "st_bot_item",
    "Ficha completa de un ítem ya identificado: stock en el estante, reservado, por despachar, mínimo, "
    "receta con el stock de cada componente y los últimos movimientos.",
    "={{ JSON.stringify({ p_categoria: $fromAI('categoria', 'Categoría exacta del ítem (producto, insumo, insumo_interno, etiqueta, materia_prima)', 'string'), "
    "p_codigo: $fromAI('codigo', 'Código exacto del ítem tal como lo devolvió buscar_items', 'string') }) }}")

herramienta("pedidos_web", [1860, 700], "st_bot_pedidos",
    "Pedidos de la tienda web con lo que descuentan del stock. Por defecto trae Confirmados (reservados, sin descontar) "
    "y En preparación (ya descontados) de los últimos 10 días. Usala antes de cargar cualquier venta.",
    "={{ JSON.stringify({ p_estados: ($fromAI('estados', 'Estados separados por coma: confirmado, preparacion, enviado, entregado. Vacío = confirmado,preparacion', 'string') || 'confirmado,preparacion').split(',').map(s => s.trim()).filter(Boolean), "
    "p_dias: $fromAI('dias', 'Cuántos días para atrás mirar (1 a 60). Normalmente 10', 'number') || 10 }) }}")

herramienta("movimientos_recientes", [2000, 700], "st_bot_movimientos",
    "Últimos movimientos de stock (hasta 40), con id, quién, cuándo, antes y después, y si se pueden deshacer. "
    "Usala para corregir errores (acción revertir) o para ver si algo ya quedó cargado.",
    "={{ JSON.stringify({ p_horas: $fromAI('horas', 'Cuántas horas para atrás (1 a 720). Normalmente 48', 'number') || 48, "
    "p_texto: $fromAI('texto', 'Opcional: código o parte del nombre del ítem. Vacío para todos', 'string') || null, "
    "p_usuario: null }) }}")

herramienta("resumen_del_dia", [2140, 700], "st_bot_resumen_dia",
    "Qué se cargó hoy: producciones, salidas, pedidos web descontados, pedidos confirmados sin preparar, "
    "productos en negativo y bajo mínimo. Usala para no duplicar lo que ya está cargado.",
    "={{ JSON.stringify({ p_fecha: null }) }}")

herramienta("preparar_movimientos", [2280, 700], "st_bot_preparar",
    "Arma la PROPUESTA de movimientos para que la persona la confirme con un botón. No carga nada. "
    "Mandá todos los movimientos juntos en una sola llamada. Devuelve ok, resumen y avisos, o errores para corregir.",
    "={{ JSON.stringify({ p_chat_id: " + CHAT + ", "
    "p_acciones: $fromAI('acciones', 'Lista JSON de movimientos. Cada uno es un objeto con tipo y sus campos: "
    "{\"tipo\":\"produccion\",\"codigo\":\"CAP-01\",\"cantidad\":20,\"nota\":\"lote 12\"} · "
    "{\"tipo\":\"venta\",\"codigo\":\"...\",\"cantidad\":2,\"nota\":\"feria\"} · "
    "{\"tipo\":\"consumo_interno\",\"categoria\":\"producto\",\"codigo\":\"...\",\"cantidad\":1,\"nota\":\"muestra\"} · "
    "{\"tipo\":\"ingreso\",\"categoria\":\"materia_prima\",\"codigo\":\"MP-27\",\"cantidad\":5000} · "
    "{\"tipo\":\"ajuste\",\"categoria\":\"producto\",\"codigo\":\"...\",\"cantidad\":12} · "
    "{\"tipo\":\"pasar_a_preparacion\",\"pedido\":\"ORD-...\"} · "
    "{\"tipo\":\"revertir\",\"movimiento\":\"id del movimiento\"}', 'json'), "
    "p_nota: null }) }}")

# --- Después del agente: ¿armó una propuesta? ---
rpc("¿Armó una propuesta?", [1960, 400], "st_bot_pendiente_para_mostrar",
    "={{ JSON.stringify({ p_chat_id: " + CHAT + " }) }}")
unir("Agente de stock", "¿Armó una propuesta?")

si("¿Hay propuesta?", [2180, 400], "={{ $json.hay === true }}")
unir("¿Armó una propuesta?", "¿Hay propuesta?")

telegram_texto("Responder", [2400, 520], "={{ " + CHAT + " }}",
    "={{ $('Agente de stock').item.json.output }}")
unir("¿Hay propuesta?", "Responder", salida=1)

telegram_texto("Responder antes de la propuesta", [2400, 300], "={{ " + CHAT + " }}",
    "={{ $('Agente de stock').item.json.output }}")
unir("¿Hay propuesta?", "Responder antes de la propuesta")

telegram_texto("Mostrar propuesta con botones", [2620, 300], "={{ " + CHAT + " }}",
    "=📋 Propuesta para cargar:\n\n{{ $('¿Armó una propuesta?').item.json.resumen }}\n\n¿La cargo?",
    botones=[("✅ Confirmar", "=ok:{{ $('¿Armó una propuesta?').item.json.token }}"),
             ("❌ Cancelar", "=no:{{ $('¿Armó una propuesta?').item.json.token }}")])
unir("Responder antes de la propuesta", "Mostrar propuesta con botones")

# --- Botones ---
asignar("Datos del botón", [440, 140], [
    ("chat_id", "={{ $json.callback_query.message.chat.id }}", "number"),
    ("message_id", "={{ $json.callback_query.message.message_id }}", "number"),
    ("callback_id", "={{ $json.callback_query.id }}", "string"),
    ("accion", "={{ ($json.callback_query.data || '').split(':')[0] }}", "string"),
    ("token", "={{ ($json.callback_query.data || '').split(':').slice(1).join(':') }}", "string"),
    ("texto_original", "={{ $json.callback_query.message.text || '' }}", "string"),
    ("quien", "={{ $json.callback_query.from.first_name || '' }}", "string"),
])
unir("¿Tocó un botón?", "Datos del botón")

nodo("Responder al botón", "n8n-nodes-base.telegram", 1.2, [660, 140], {
    "resource": "callback",
    "queryId": "={{ $json.callback_id }}",
    "additionalFields": {},
}, CRED_TELEGRAM)
unir("Datos del botón", "Responder al botón")

nodo("¿Qué botón?", "n8n-nodes-base.switch", 3.2, [880, 140], {
    "rules": {"values": [
        {
            "conditions": {
                "options": {"caseSensitive": True, "leftValue": "", "typeValidation": "strict", "version": 2},
                "conditions": [{
                    "id": str(uuid.uuid5(uuid.NAMESPACE_URL, "sw/" + clave)),
                    "leftValue": "={{ $('Datos del botón').item.json.accion }}",
                    "rightValue": clave,
                    "operator": {"type": "string", "operation": "equals"},
                }],
                "combinator": "and",
            },
            "renameOutput": True,
            "outputKey": salida,
        }
        for clave, salida in [("ok", "Confirmar"), ("no", "Cancelar"), ("nada", "Sin novedades"),
                              ("apr", "Aprobar acceso"), ("rec", "Rechazar acceso")]
    ]},
    "options": {},
})
unir("Responder al botón", "¿Qué botón?")

BOTON = "$('Datos del botón').item.json"
rpc("Cargar en el stock", [1100, -40], "st_bot_confirmar",
    "={{ JSON.stringify({ p_token: " + BOTON + ".token, p_chat_id: " + BOTON + ".chat_id }) }}")
unir("¿Qué botón?", "Cargar en el stock", salida=0)
telegram_editar("Mostrar resultado", [1320, -40],
    "={{ " + BOTON + ".texto_original.replace(/\\n*¿La cargo\\?$/, '') }}\n\n"
    "{{ $json.ok ? '✅ Cargado por ' + " + BOTON + ".quien + ':\\n' + $json.texto : '⚠️ ' + $json.error }}")
unir("Cargar en el stock", "Mostrar resultado")

rpc("Cancelar propuesta", [1100, 140], "st_bot_cancelar",
    "={{ JSON.stringify({ p_token: " + BOTON + ".token, p_chat_id: " + BOTON + ".chat_id }) }}")
unir("¿Qué botón?", "Cancelar propuesta", salida=1)
telegram_editar("Mostrar cancelado", [1320, 140],
    "={{ " + BOTON + ".texto_original.replace(/\\n*¿La cargo\\?$/, '') }}\n\n❌ Cancelado: no se cargó nada. Si querés, decime qué cambio.")
unir("Cancelar propuesta", "Mostrar cancelado")

rpc("Anotar sin novedades", [1100, 320], "st_bot_checkin",
    "={{ JSON.stringify({ p_chat_id: " + BOTON + ".chat_id, p_sin_novedades: true }) }}")
unir("¿Qué botón?", "Anotar sin novedades", salida=2)
telegram_editar("Agradecer", [1320, 320],
    "={{ " + BOTON + ".texto_original }}\n\n👍 Anotado: sin novedades hoy. ¡Gracias!")
unir("Anotar sin novedades", "Agradecer")

# Aprobar o rechazar un pedido de acceso (el token del botón es el chat de quien pidió).
rpc("Resolver acceso", [1100, 500], "st_bot_resolver_solicitud",
    "={{ JSON.stringify({ p_chat_aprobador: " + BOTON + ".chat_id, "
    "p_chat_solicitante: Number(" + BOTON + ".token), p_aprobar: " + BOTON + ".accion === 'apr' }) }}")
unir("¿Qué botón?", "Resolver acceso", salida=3)
unir("¿Qué botón?", "Resolver acceso", salida=4)
telegram_editar("Mostrar resolución", [1320, 500],
    "={{ " + BOTON + ".texto_original }}\n\n"
    "{{ $json.ok ? ($json.aprobada ? '✅ Aprobado por ' + " + BOTON + ".quien + '. Ya le avisé.' "
    ": '❌ Rechazado por ' + " + BOTON + ".quien + '.') : '⚠️ ' + $json.error }}")
unir("Resolver acceso", "Mostrar resolución")
si("¿Se resolvió?", [1540, 500], "={{ $('Resolver acceso').item.json.ok === true }}")
unir("Mostrar resolución", "¿Se resolvió?")
telegram_texto("Avisarle a quien pidió", [1760, 500], "={{ $('Resolver acceso').item.json.chat_id }}",
    "={{ $('Resolver acceso').item.json.aprobada "
    "? '¡Listo ' + $('Resolver acceso').item.json.nombre + '! Ya estás habilitado ✅\\n\\n"
    "Escribime cuando quieras qué pasó con el stock: qué se produjo, qué salió por fuera de la web, "
    "qué compra llegó o qué hay que corregir. También todos los días a las 18 te pregunto yo.' "
    ": 'Tu pedido de acceso al bot de stock no fue aprobado. Si creés que es un error, hablalo con quien administra el stock.' }}")
unir("¿Se resolvió?", "Avisarle a quien pidió")

# ---------------------------------------------------------------------------
# Rama 2 · Pregunta diaria
# ---------------------------------------------------------------------------
nodo("Todos los días 18 h", "n8n-nodes-base.scheduleTrigger", 1.2, [0, 1000], {
    "rule": {"interval": [{"field": "cronExpression", "expression": "0 18 * * 1-6"}]},
})

rpc("Resumen del día", [220, 1000], "st_bot_resumen_dia", "={{ JSON.stringify({ p_fecha: null }) }}")
unir("Todos los días 18 h", "Resumen del día")

rpc("A quién preguntarle", [440, 1000], "st_bot_destinatarios_resumen", "{}")
unir("Resumen del día", "A quién preguntarle")

nodo("Armar la pregunta", "n8n-nodes-base.code", 2, [660, 1000], {
    "mode": "runOnceForEachItem",
    "jsCode": r"""// Una pregunta por persona, con lo que ya está cargado hoy para que no lo repitan.
const r = $('Resumen del día').first().json;
const p = $json;
const n = (x) => String(x).replace('.', ',');
const lineas = [];

const prod = r.producciones_cargadas || [];
const sal = r.salidas_cargadas || [];
const ya = [];
if (prod.length) ya.push(`${prod.length} producción${prod.length > 1 ? 'es' : ''} (${prod.slice(0, 4).map(m => `${n(m.cantidad)} ${m.nombre}`).join(', ')}${prod.length > 4 ? '…' : ''})`);
if (sal.length) ya.push(`${sal.length} salida${sal.length > 1 ? 's' : ''} fuera de la web`);
if (r.pedidos_web_descontados_hoy) ya.push(`${r.pedidos_web_descontados_hoy} pedido${r.pedidos_web_descontados_hoy > 1 ? 's' : ''} web descontado${r.pedidos_web_descontados_hoy > 1 ? 's' : ''}`);

lineas.push(`¡Hola ${p.nombre}! 🍄 Cierre de stock del ${r.fecha}.`);
lineas.push('');
lineas.push(ya.length ? `Ya está cargado hoy: ${ya.join(' · ')}.` : 'Hoy todavía no hay nada cargado en la plataforma.');
if (r.pedidos_confirmados_sin_preparar) {
  lineas.push(`Hay ${r.pedidos_confirmados_sin_preparar} pedido${r.pedidos_confirmados_sin_preparar > 1 ? 's' : ''} web en Confirmado (reservados, sin descontar). Si alguno ya se armó, contame.`);
}
const neg = r.productos_en_negativo || [];
if (neg.length) {
  lineas.push(`⚠️ En negativo: ${neg.slice(0, 5).map(i => `${i.nombre} (${n(i.en_estante)})`).join(', ')}${neg.length > 5 ? ` y ${neg.length - 5} más` : ''}. Si podés, contalos.`);
}
lineas.push('');
lineas.push('Contame:');
lineas.push('1. ¿Hubo producción? ¿De qué y cuánto?');
lineas.push('2. ¿Salió mercadería por fuera de la web? (feria, en mano, muestras, uso interno)');
lineas.push('3. ¿Llegó alguna compra de insumos o materia prima?');
lineas.push('4. ¿Hay algo para corregir?');
lineas.push('');
lineas.push('Escribime como te salga, yo lo acomodo. Si no hubo nada, tocá el botón.');

return { json: { chat_id: p.chat_id, texto: lineas.join('\n') } };
""",
})
unir("A quién preguntarle", "Armar la pregunta")

telegram_texto("Mandar la pregunta", [880, 1000], "={{ $json.chat_id }}", "={{ $json.texto }}",
    botones=[("✅ Sin novedades hoy", "nada:hoy")])
unir("Armar la pregunta", "Mandar la pregunta")

# ---------------------------------------------------------------------------
# Notas en el lienzo
# ---------------------------------------------------------------------------
nota("## Bot de stock · mensajes\nEl agente (Gemini) entiende lo que escriben, busca los ítems y arma una **propuesta**. "
     "Nunca carga solo: la carga pasa cuando la persona toca **Confirmar** (rama de botones, arriba).\n\n"
     "Todo pasa por funciones `st_bot_*` de Supabase (`supabase/bot_stock_telegram_2026-11-22.sql`).",
     [400, 240], 560, 120, 4)
nota("## Botones\nConfirmar → `st_bot_confirmar` aplica con las reglas de la plataforma (receta al producir, pedido web descuenta al pasar a En preparación). "
     "Todo o nada; no se puede confirmar dos veces.", [400, -140], 560, 100, 5)
nota("## Pregunta diaria\nLunes a sábado 18 h a cada persona habilitada con `resumen_diario`. "
     "La respuesta entra por la rama de mensajes. Cambiá la hora en el nodo de horario.", [0, 840], 560, 110, 6)

# Disposición en el lienzo: la que armó Frani a mano en n8n (posiciones.json).
# Respetarla siempre; un nodo nuevo que no esté ahí queda con su posición del código.
_pos = json.loads((AQUI / "posiciones.json").read_text(encoding="utf-8"))
for _n in nodos:
    if _n["type"].endswith("stickyNote"):
        _k = "nota:" + _n["parameters"]["content"].split("\n")[0]
    else:
        _k = _n["name"]
    if _k in _pos:
        _n["position"] = _pos[_k]["position"]
        if _pos[_k].get("width"):
            _n["parameters"]["width"] = _pos[_k]["width"]
            _n["parameters"]["height"] = _pos[_k]["height"]

flujo = {
    "name": "Bot de stock Somos Setas (Telegram)",
    "nodes": nodos,
    "connections": conexiones,
    "active": False,
    "settings": {"executionOrder": "v1", "timezone": ZONA, "saveManualExecutions": True},
    "pinData": {},
    "meta": {"templateCredsSetupCompleted": False},
    "tags": [],
}

salida = AQUI / "bot-stock-telegram.json"
salida.write_text(json.dumps(flujo, ensure_ascii=False, indent=2), encoding="utf-8")
print(f"{salida.name}: {len(nodos)} nodos")
