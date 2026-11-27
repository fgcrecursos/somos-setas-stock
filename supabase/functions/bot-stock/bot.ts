// Bot de stock de Somos Setas por Telegram, como Edge Function de Supabase.
//
// Reemplaza el flujo de n8n (bot/n8n/generar_flujo.py) con la misma lógica:
// mensajes → agente (Gemini + 6 herramientas) → propuesta con botones;
// botones → confirmar / cancelar / sin novedades / aprobar acceso;
// pregunta diaria (la dispara pg_cron).
//
// Toda la lógica de stock sigue en las funciones st_bot_* de la base. Este
// archivo no usa nada propio de Deno para poder probarlo con Node
// (bot/pruebas/test_funcion.mjs): todo lo de afuera entra por `Entorno`.

export interface Entorno {
  supabaseUrl: string;
  serviceKey: string;
  telegramToken: string;
  geminiKey: string;
  /** Principal primero; si Google lo tiene saturado o caído se usa el siguiente. */
  modelos: string[];
  fetch: typeof fetch;
  ahora?: () => Date;
  log?: (...a: unknown[]) => void;
  /** Tope de tiempo del agente por mensaje (ms). */
  plazoAgente?: number;
}

const ZONA = 'America/Argentina/Buenos_Aires';
const MAX_VUELTAS = 15;
const EMAIL = /[^\s@]+@[^\s@]+\.[^\s@]+/;

// ---------------------------------------------------------------------------
// Supabase y Telegram
// ---------------------------------------------------------------------------
export async function rpc(env: Entorno, funcion: string, cuerpo: Record<string, unknown> = {}): Promise<any> {
  const r = await env.fetch(`${env.supabaseUrl}/rest/v1/rpc/${funcion}`, {
    method: 'POST',
    headers: {
      apikey: env.serviceKey,
      Authorization: `Bearer ${env.serviceKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(cuerpo),
  });
  const texto = await r.text();
  if (!r.ok) throw new Error(`${funcion}: HTTP ${r.status} ${texto.slice(0, 300)}`);
  return texto ? JSON.parse(texto) : null;
}

export async function tg(env: Entorno, metodo: string, cuerpo: Record<string, unknown>): Promise<any> {
  const r = await env.fetch(`https://api.telegram.org/bot${env.telegramToken}/${metodo}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(cuerpo),
  });
  const j = await r.json().catch(() => ({}));
  if (!j.ok) throw new Error(`Telegram ${metodo}: ${j.description || r.status}`);
  return j.result;
}

/** En HTML los únicos caracteres especiales son &, < y >. */
export const esc = (s: unknown) =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

type Boton = [texto: string, dato: string];

/** Manda texto plano (escapado) en HTML; Telegram corta en 4096 caracteres. */
async function enviar(env: Entorno, chatId: number, texto: string, botones?: Boton[]) {
  const partes = partir(esc(texto), 4000);
  for (let i = 0; i < partes.length; i++) {
    const cuerpo: Record<string, unknown> = { chat_id: chatId, text: partes[i], parse_mode: 'HTML' };
    if (botones && i === partes.length - 1) {
      cuerpo.reply_markup = { inline_keyboard: [botones.map(([text, callback_data]) => ({ text, callback_data }))] };
    }
    await tg(env, 'sendMessage', cuerpo);
  }
}

function partir(s: string, max: number): string[] {
  if (s.length <= max) return [s];
  const out: string[] = [];
  let resto = s;
  while (resto.length > max) {
    let corte = resto.lastIndexOf('\n', max);
    if (corte < max / 2) corte = max;
    out.push(resto.slice(0, corte));
    resto = resto.slice(corte).replace(/^\n+/, '');
  }
  if (resto) out.push(resto);
  return out;
}

async function editar(env: Entorno, chatId: number, messageId: number, texto: string) {
  try {
    await tg(env, 'editMessageText', { chat_id: chatId, message_id: messageId, text: texto.slice(0, 4096) });
  } catch (e) {
    // "message is not modified" (tocó dos veces) no es un error para nadie.
    if (!String(e).includes('not modified')) throw e;
  }
}

// ---------------------------------------------------------------------------
// Entrada: un update de Telegram
// ---------------------------------------------------------------------------
export async function procesarUpdate(env: Entorno, update: any): Promise<void> {
  if (typeof update?.update_id === 'number') {
    const nuevo = await rpc(env, 'st_bot_update_nuevo', { p_update_id: update.update_id });
    if (nuevo === false) return; // Telegram reintentó algo que ya atendimos
  }
  if (update.callback_query) return procesarBoton(env, update.callback_query);
  if (update.message) return procesarMensaje(env, update.message);
}

// --- Botones ---
async function procesarBoton(env: Entorno, cq: any) {
  const chatId: number = cq.message?.chat?.id;
  const messageId: number = cq.message?.message_id;
  const [accion, ...resto] = String(cq.data || '').split(':');
  const token = resto.join(':');
  const original: string = cq.message?.text || '';
  const quien: string = cq.from?.first_name || '';

  await tg(env, 'answerCallbackQuery', { callback_query_id: cq.id }).catch((e) => env.log?.('answerCallbackQuery', e));
  if (!chatId || !messageId) return;
  const sinPregunta = original.replace(/\n*¿La cargo\?$/, '');

  switch (accion) {
    case 'ok': {
      const r = await rpc(env, 'st_bot_confirmar', { p_token: token, p_chat_id: chatId });
      await editar(env, chatId, messageId,
        `${sinPregunta}\n\n${r?.ok ? `✅ Cargado por ${quien}:\n${r.texto}` : `⚠️ ${r?.error ?? 'No se pudo cargar.'}`}`);
      return;
    }
    case 'no': {
      await rpc(env, 'st_bot_cancelar', { p_token: token, p_chat_id: chatId });
      await editar(env, chatId, messageId, `${sinPregunta}\n\n❌ Cancelado: no se cargó nada. Si querés, decime qué cambio.`);
      return;
    }
    case 'nada': {
      await rpc(env, 'st_bot_checkin', { p_chat_id: chatId, p_sin_novedades: true });
      await editar(env, chatId, messageId, `${original}\n\n👍 Anotado: sin novedades hoy. ¡Gracias!`);
      return;
    }
    case 'apr':
    case 'rec': {
      const r = await rpc(env, 'st_bot_resolver_solicitud', {
        p_chat_aprobador: chatId, p_chat_solicitante: Number(token), p_aprobar: accion === 'apr',
      });
      await editar(env, chatId, messageId, `${original}\n\n${
        r?.ok ? (r.aprobada ? `✅ Aprobado por ${quien}. Ya le avisé.` : `❌ Rechazado por ${quien}.`) : `⚠️ ${r?.error ?? 'No se pudo resolver.'}`}`);
      if (r?.ok) {
        await enviar(env, r.chat_id, r.aprobada
          ? `¡Listo ${r.nombre}! Ya estás habilitado ✅\n\nEscribime cuando quieras qué pasó con el stock: qué se produjo, ` +
            `qué salió por fuera de la web, qué compra llegó o qué hay que corregir. También todos los días a las 12 te pregunto yo.`
          : 'Tu pedido de acceso al bot de stock no fue aprobado. Si creés que es un error, hablalo con quien administra el stock.');
      }
      return;
    }
  }
}

// --- Mensajes ---
async function procesarMensaje(env: Entorno, m: any) {
  const chatId: number = m.chat?.id;
  if (!chatId) return;
  const privado = m.chat?.type === 'private';
  const nombre: string = m.from?.first_name || 'equipo';
  const texto: string = String(m.text || m.caption || '').trim();
  const usuario: string = m.from?.username || '';

  const quien = await rpc(env, 'st_bot_quien', { p_chat_id: chatId });

  if (!(quien?.habilitado === true && privado)) {
    // Gente nueva: pide acceso con su mail y alguien con permiso lo aprueba.
    const mail = texto.match(EMAIL)?.[0];
    if (!mail) {
      await enviar(env, chatId, `Hola ${nombre} 👋 Soy el bot de stock de Somos Setas.\n\n` +
        'Para usarlo te tengo que habilitar: escribime el mail con el que entrás a la plataforma de stock ' +
        'y le paso el pedido a quien aprueba los accesos.');
      return;
    }
    const r = await rpc(env, 'st_bot_solicitar', {
      p_chat_id: chatId, p_nombre: nombre + (usuario ? ` (@${usuario})` : ''), p_email: mail,
    });
    if (r?.motivo) await enviar(env, chatId, r.motivo);
    if (r?.ok && !r.repetido) {
      for (const a of r.aprobadores || []) {
        await enviar(env, a.chat_id,
          `🔑 Pedido de acceso al bot de stock\n\n${r.solicitante.nombre}\n${r.solicitante.email}\n\n` +
          'Si lo aprobás, va a poder cargar y corregir stock desde Telegram.',
          [['✅ Aprobar', `apr:${r.solicitante.chat_id}`], ['❌ Rechazar', `rec:${r.solicitante.chat_id}`]]);
      }
    }
    return;
  }

  await rpc(env, 'st_bot_checkin', { p_chat_id: chatId, p_sin_novedades: false });

  if (!texto) {
    await enviar(env, chatId, 'Por ahora solo leo mensajes de texto ✍️ Escribime qué pasó con el stock y lo acomodo.');
    return;
  }

  tg(env, 'sendChatAction', { chat_id: chatId, action: 'typing' }).catch(() => {});

  let respuesta: string;
  try {
    respuesta = await agente(env, chatId, nombre, texto);
  } catch (e) {
    env.log?.('agente', e);
    await enviar(env, chatId, 'Uy, tuve un problema para procesar eso y no cargué nada 😕 Probá de nuevo en un ratito. ' +
      'Si sigue pasando, avisale a Frani.');
    return;
  }

  await rpc(env, 'st_bot_charla_guardar', { p_chat_id: chatId, p_pregunta: texto, p_respuesta: respuesta })
    .catch((e) => env.log?.('charla_guardar', e));

  const p = await rpc(env, 'st_bot_pendiente_para_mostrar', { p_chat_id: chatId });
  if (respuesta.trim()) await enviar(env, chatId, respuesta);
  if (p?.hay) {
    await enviar(env, chatId, `📋 Propuesta para cargar:\n\n${p.resumen}\n\n¿La cargo?`,
      [['✅ Confirmar', `ok:${p.token}`], ['❌ Cancelar', `no:${p.token}`]]);
  }
}

// ---------------------------------------------------------------------------
// Agente: Gemini con herramientas
// ---------------------------------------------------------------------------
const CATEGORIAS = ['producto', 'insumo', 'insumo_interno', 'etiqueta', 'materia_prima'];

export const HERRAMIENTAS = [
  {
    name: 'buscar_items',
    description: 'Busca productos, insumos, etiquetas o materias primas por nombre o código, aunque estén mal escritos. ' +
      'Devuelve hasta 8 opciones con codigo, categoria, nombre, unidad, en_estante, reservado, disponible, ' +
      'por_despachar y parecido (1 = coincide). Usala SIEMPRE antes de proponer un movimiento.',
    parameters: {
      type: 'object',
      properties: {
        texto: { type: 'string', description: 'Lo que escribió la persona para nombrar el ítem, por ejemplo "melena capsulas" o "POL 39"' },
        categoria: { type: 'string', enum: CATEGORIAS, description: 'Opcional. Omitila para buscar en todas' },
      },
      required: ['texto'],
    },
  },
  {
    name: 'ver_item',
    description: 'Ficha completa de un ítem ya identificado: stock en el estante, reservado, por despachar, mínimo, ' +
      'receta con el stock de cada componente y los últimos movimientos.',
    parameters: {
      type: 'object',
      properties: {
        categoria: { type: 'string', enum: CATEGORIAS, description: 'Categoría exacta del ítem' },
        codigo: { type: 'string', description: 'Código exacto del ítem tal como lo devolvió buscar_items' },
      },
      required: ['categoria', 'codigo'],
    },
  },
  {
    name: 'pedidos_web',
    description: 'Pedidos de la tienda web con lo que descuentan del stock. Por defecto trae Confirmados (reservados, sin descontar) ' +
      'y En preparación (ya descontados) de los últimos 10 días. Usala antes de cargar cualquier venta.',
    parameters: {
      type: 'object',
      properties: {
        estados: {
          type: 'array', items: { type: 'string', enum: ['confirmado', 'preparacion', 'enviado', 'entregado'] },
          description: 'Opcional. Por defecto confirmado y preparacion',
        },
        dias: { type: 'integer', description: 'Cuántos días para atrás mirar (1 a 60). Normalmente 10' },
      },
    },
  },
  {
    name: 'movimientos_recientes',
    description: 'Últimos movimientos de stock (hasta 40), con id, quién, cuándo, antes y después, y si se pueden deshacer. ' +
      'Usala para corregir errores (acción revertir) o para ver si algo ya quedó cargado.',
    parameters: {
      type: 'object',
      properties: {
        horas: { type: 'integer', description: 'Cuántas horas para atrás (1 a 720). Normalmente 48' },
        texto: { type: 'string', description: 'Opcional: código o parte del nombre del ítem' },
      },
    },
  },
  {
    name: 'resumen_del_dia',
    description: 'Qué se cargó hoy: producciones, salidas, pedidos web descontados, pedidos confirmados sin preparar, ' +
      'productos en negativo y bajo mínimo. Usala para no duplicar lo que ya está cargado.',
  },
  {
    name: 'preparar_movimientos',
    description: 'Arma la PROPUESTA de movimientos para que la persona la confirme con un botón. No carga nada. ' +
      'Mandá todos los movimientos juntos en una sola llamada. Devuelve ok, resumen y avisos, o errores para corregir.',
    parameters: {
      type: 'object',
      properties: {
        acciones: {
          type: 'array',
          description: 'Movimientos. Ejemplos: {tipo:"produccion",codigo:"CAP-01",cantidad:20,nota:"lote 12"} · ' +
            '{tipo:"venta",codigo:"...",cantidad:2,nota:"feria"} · {tipo:"consumo_interno",categoria:"producto",codigo:"...",cantidad:1,nota:"muestra"} · ' +
            '{tipo:"ingreso",categoria:"materia_prima",codigo:"MP-27",cantidad:5000} · {tipo:"ajuste",categoria:"producto",codigo:"...",cantidad:12} · ' +
            '{tipo:"pasar_a_preparacion",pedido:"ORD-..."} · {tipo:"revertir",movimiento:"id del movimiento"}',
          items: {
            type: 'object',
            properties: {
              tipo: { type: 'string', enum: ['produccion', 'venta', 'consumo_interno', 'ingreso', 'ajuste', 'pasar_a_preparacion', 'revertir'] },
              categoria: { type: 'string', enum: CATEGORIAS },
              codigo: { type: 'string' },
              cantidad: { type: 'number' },
              nota: { type: 'string' },
              pedido: { type: 'string', description: 'Solo pasar_a_preparacion: id del pedido web' },
              movimiento: { type: 'string', description: 'Solo revertir: id del movimiento' },
            },
            required: ['tipo'],
          },
        },
      },
      required: ['acciones'],
    },
  },
];

async function usarHerramienta(env: Entorno, chatId: number, nombre: string, a: any): Promise<unknown> {
  a = a || {};
  switch (nombre) {
    case 'buscar_items':
      return rpc(env, 'st_bot_buscar', { p_texto: String(a.texto ?? ''), p_categoria: a.categoria || null, p_limite: 8 });
    case 'ver_item':
      return rpc(env, 'st_bot_item', { p_categoria: a.categoria, p_codigo: a.codigo });
    case 'pedidos_web': {
      const estados = Array.isArray(a.estados) && a.estados.length ? a.estados : ['confirmado', 'preparacion'];
      return rpc(env, 'st_bot_pedidos', { p_estados: estados, p_dias: Number(a.dias) || 10 });
    }
    case 'movimientos_recientes':
      return rpc(env, 'st_bot_movimientos', { p_horas: Number(a.horas) || 48, p_texto: a.texto || null, p_usuario: null });
    case 'resumen_del_dia':
      return rpc(env, 'st_bot_resumen_dia', { p_fecha: null });
    case 'preparar_movimientos': {
      let acciones = a.acciones;
      if (typeof acciones === 'string') acciones = JSON.parse(acciones);
      return rpc(env, 'st_bot_preparar', { p_chat_id: chatId, p_acciones: acciones ?? [], p_nota: null });
    }
    default:
      return { error: `No existe la herramienta ${nombre}` };
  }
}

/** Un error de Google que justifica probar con el modelo de respaldo. */
class ModeloCaido extends Error {}

async function llamarGemini(env: Entorno, modelo: string, cuerpo: unknown, plazo: number): Promise<any> {
  let r: Response;
  try {
    r = await env.fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': env.geminiKey },
      body: JSON.stringify(cuerpo),
      signal: AbortSignal.timeout(Math.max(5_000, plazo)),
    });
  } catch (e) {
    throw new ModeloCaido(`${modelo}: ${e}`);
  }
  const texto = await r.text();
  if (r.status === 429 || r.status >= 500 || r.status === 404) throw new ModeloCaido(`${modelo}: HTTP ${r.status} ${texto.slice(0, 200)}`);
  if (!r.ok) throw new Error(`${modelo}: HTTP ${r.status} ${texto.slice(0, 300)}`);
  return JSON.parse(texto);
}

export async function agente(env: Entorno, chatId: number, nombre: string, texto: string): Promise<string> {
  const historia: { rol: string; texto: string }[] =
    await rpc(env, 'st_bot_charla_leer', { p_chat_id: chatId, p_limite: 40 }).catch(() => []);
  // Gemini quiere que la charla arranque con la persona.
  while (historia.length && historia[0].rol !== 'user') historia.shift();

  const inicio = Date.now();
  const plazoTotal = env.plazoAgente ?? 120_000;
  let ultimoError: unknown;

  for (const modelo of env.modelos) {
    const contents: any[] = historia.map((h) => ({ role: h.rol, parts: [{ text: h.texto }] }));
    contents.push({ role: 'user', parts: [{ text: texto }] });
    try {
      for (let vuelta = 0; vuelta < MAX_VUELTAS; vuelta++) {
        const resta = plazoTotal - (Date.now() - inicio);
        if (resta < 5_000) throw new Error('Se acabó el tiempo del agente');
        const r = await llamarGemini(env, modelo, {
          systemInstruction: { parts: [{ text: armarPrompt(nombre, env.ahora?.() ?? new Date()) }] },
          contents,
          tools: [{ functionDeclarations: HERRAMIENTAS }],
          generationConfig: { temperature: 0.2 },
        }, Math.min(resta, 60_000));

        const contenido = r.candidates?.[0]?.content;
        const partes: any[] = contenido?.parts ?? [];
        const llamadas = partes.filter((p) => p.functionCall);
        if (!llamadas.length) {
          const salida = partes.filter((p) => typeof p.text === 'string' && !p.thought).map((p) => p.text).join('').trim();
          if (!salida && !partes.length) throw new ModeloCaido(`${modelo}: respuesta vacía (${r.candidates?.[0]?.finishReason ?? 'sin candidato'})`);
          return salida;
        }
        // Se devuelve el contenido tal cual (con sus firmas de pensamiento) y después las respuestas.
        contents.push({ role: 'model', parts: partes });
        const respuestas = [];
        for (const p of llamadas) {
          let resultado: unknown;
          try {
            resultado = await usarHerramienta(env, chatId, p.functionCall.name, p.functionCall.args);
          } catch (e) {
            resultado = { error: String(e instanceof Error ? e.message : e) };
          }
          respuestas.push({ functionResponse: { name: p.functionCall.name, response: { resultado } } });
        }
        contents.push({ role: 'user', parts: respuestas });
      }
      throw new Error('El agente dio demasiadas vueltas');
    } catch (e) {
      ultimoError = e;
      if (!(e instanceof ModeloCaido)) throw e;
      env.log?.('modelo caído, pruebo el siguiente', String(e));
    }
  }
  throw ultimoError;
}

function fechaLarga(d: Date): string {
  const p = Object.fromEntries(new Intl.DateTimeFormat('es-AR', {
    timeZone: ZONA, weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.weekday} ${p.day} de ${p.month}, ${p.hour}:${p.minute}`;
}

export function armarPrompt(nombre: string, ahora: Date): string {
  return `Sos el asistente de stock de Somos Setas (suplementos de hongos, Mendoza). Hablás por Telegram con ${nombre}, del equipo de producción. Hoy es ${fechaLarga(ahora)}.

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
Voseo, cálido y corto, como un compañero. Texto plano para Telegram: sin tablas, sin asteriscos ni negritas, como mucho guiones para listar. Usá los nombres de los productos como figuran en el sistema y el código entre paréntesis. No muestres datos personales de clientes más allá del nombre de pila. Si te piden algo que no tiene que ver con el stock, decí amablemente que solo ayudás con el stock.`;
}

// ---------------------------------------------------------------------------
// Pregunta diaria (lunes a sábado 12 h, la dispara pg_cron)
// ---------------------------------------------------------------------------
export function armarPregunta(r: any, nombre: string): string {
  const n = (x: unknown) => String(x).replace('.', ',');
  const prod: any[] = r.producciones_cargadas || [];
  const sal: any[] = r.salidas_cargadas || [];
  const ya: string[] = [];
  if (prod.length) ya.push(`${prod.length} producción${prod.length > 1 ? 'es' : ''} (${prod.slice(0, 4).map((m) => `${n(m.cantidad)} ${m.nombre}`).join(', ')}${prod.length > 4 ? '…' : ''})`);
  if (sal.length) ya.push(`${sal.length} salida${sal.length > 1 ? 's' : ''} fuera de la web`);
  const web = r.pedidos_web_descontados_hoy;
  if (web) ya.push(`${web} pedido${web > 1 ? 's' : ''} web descontado${web > 1 ? 's' : ''}`);

  const l: string[] = [];
  l.push(`¡Hola ${nombre}! 🍄 Cierre de stock del ${r.fecha}.`, '');
  l.push(ya.length ? `Ya está cargado hoy: ${ya.join(' · ')}.` : 'Hoy todavía no hay nada cargado en la plataforma.');
  const conf = r.pedidos_confirmados_sin_preparar;
  if (conf) l.push(`Hay ${conf} pedido${conf > 1 ? 's' : ''} web en Confirmado (reservados, sin descontar). Si alguno ya se armó, contame.`);
  const neg: any[] = r.productos_en_negativo || [];
  if (neg.length) {
    l.push(`⚠️ En negativo: ${neg.slice(0, 5).map((i) => `${i.nombre} (${n(i.en_estante)})`).join(', ')}${neg.length > 5 ? ` y ${neg.length - 5} más` : ''}. Si podés, contalos.`);
  }
  l.push('', 'Contame:',
    '1. ¿Hubo producción? ¿De qué y cuánto?',
    '2. ¿Salió mercadería por fuera de la web? (feria, en mano, muestras, uso interno)',
    '3. ¿Llegó alguna compra de insumos o materia prima?',
    '4. ¿Hay algo para corregir?',
    '', 'Escribime como te salga, yo lo acomodo. Si no hubo nada, tocá el botón.');
  return l.join('\n');
}

export async function preguntaDiaria(env: Entorno): Promise<{ enviadas: number; errores: string[] }> {
  const resumen = await rpc(env, 'st_bot_resumen_dia', { p_fecha: null });
  const destinos: any[] = await rpc(env, 'st_bot_destinatarios_resumen', {});
  const errores: string[] = [];
  let enviadas = 0;
  for (const p of destinos || []) {
    try {
      await enviar(env, p.chat_id, armarPregunta(resumen, p.nombre), [['✅ Sin novedades hoy', 'nada:hoy']]);
      enviadas++;
    } catch (e) {
      errores.push(`${p.nombre}: ${e}`);
    }
  }
  return { enviadas, errores };
}
