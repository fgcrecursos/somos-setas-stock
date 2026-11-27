// Pruebas de la Edge Function del bot (supabase/functions/bot-stock/bot.ts) con
// Supabase, Telegram y Gemini simulados. Uso: node bot/pruebas/test_funcion.mjs
import { procesarUpdate, preguntaDiaria, esc } from '../../supabase/functions/bot-stock/bot.ts';

let ok = 0, mal = 0;
const check = (nombre, cond, extra) => {
  if (cond) { ok++; console.log('  OK  ', nombre); }
  else { mal++; console.log('  MAL ', nombre, extra !== undefined ? JSON.stringify(extra, null, 1).slice(0, 1200) : ''); }
};

/** Arma un entorno falso. `rpcs` responde por nombre de función; `gemini` es una lista de respuestas en orden. */
function falso({ rpcs = {}, gemini = [] } = {}) {
  const llamadas = { rpc: [], tg: [], gemini: [] };
  const fetch = async (url, init) => {
    const cuerpo = init?.body ? JSON.parse(init.body) : {};
    const resp = (status, obj) => new Response(typeof obj === 'string' ? obj : JSON.stringify(obj), { status });
    if (url.includes('/rest/v1/rpc/')) {
      const f = url.split('/rpc/')[1];
      llamadas.rpc.push({ f, cuerpo });
      const r = rpcs[f];
      const valor = typeof r === 'function' ? r(cuerpo) : r;
      return resp(200, valor === undefined ? null : valor);
    }
    if (url.startsWith('https://api.telegram.org/')) {
      const metodo = url.split('/').pop();
      llamadas.tg.push({ metodo, cuerpo });
      return resp(200, { ok: true, result: metodo === 'sendMessage' ? { message_id: 1 } : true });
    }
    if (url.includes('generativelanguage')) {
      const modelo = url.match(/models\/([^:]+)/)[1];
      llamadas.gemini.push({ modelo, cuerpo, clave: init.headers['x-goog-api-key'] });
      const r = gemini.shift();
      if (!r) return resp(500, 'sin respuesta preparada');
      if (r.status) return resp(r.status, r.body ?? 'error');
      return resp(200, r);
    }
    throw new Error('URL inesperada ' + url);
  };
  const env = {
    supabaseUrl: 'https://x.supabase.co', serviceKey: 'srv', telegramToken: 'TK', geminiKey: 'GK',
    modelos: ['principal', 'respaldo'], fetch, ahora: () => new Date('2026-11-27T17:05:00Z'),
    log: () => {}, plazoAgente: 60_000,
  };
  return { env, llamadas };
}

const texto = (t) => ({ candidates: [{ content: { role: 'model', parts: [{ text: t }] } }] });
const llamada = (name, args, extra = {}) => ({ candidates: [{ content: { role: 'model', parts: [{ functionCall: { name, args }, ...extra }] } }] });
const mensaje = (t, chat = 111, extra = {}) => ({ update_id: Math.floor(Math.random() * 1e9), message: { chat: { id: chat, type: 'private' }, from: { first_name: 'Matías', username: 'mati' }, text: t, ...extra } });
const boton = (data, textoMsj = '📋 Propuesta para cargar:\n\n- 20 Melena\n\n¿La cargo?') =>
  ({ update_id: Math.floor(Math.random() * 1e9), callback_query: { id: 'cb1', data, from: { first_name: 'Franco' }, message: { message_id: 55, chat: { id: 111 }, text: textoMsj } } });
const enviados = (ll) => ll.tg.filter((x) => x.metodo === 'sendMessage');
const habilitado = { st_bot_update_nuevo: true, st_bot_quien: { habilitado: true }, st_bot_checkin: { ok: true }, st_bot_charla_leer: [], st_bot_pendiente_para_mostrar: { hay: false } };

console.log('Mensajes repetidos');
{
  const { env, llamadas } = falso({ rpcs: { st_bot_update_nuevo: false } });
  await procesarUpdate(env, mensaje('hola'));
  check('si Telegram reintenta, no hace nada', llamadas.tg.length === 0 && llamadas.rpc.length === 1, llamadas);
}

console.log('Gente nueva');
{
  const { env, llamadas } = falso({ rpcs: { st_bot_update_nuevo: true, st_bot_quien: { habilitado: false } } });
  await procesarUpdate(env, mensaje('hola'));
  const m = enviados(llamadas);
  check('sin mail: le pide el mail', m.length === 1 && m[0].cuerpo.text.includes('escribime el mail') && m[0].cuerpo.chat_id === 111, m);
}
{
  const { env, llamadas } = falso({ rpcs: {
    st_bot_update_nuevo: true, st_bot_quien: { habilitado: false },
    st_bot_solicitar: { ok: true, motivo: 'Listo, le pasé tu pedido', solicitante: { chat_id: 111, nombre: 'Matías (@mati)', email: 'm@x.com' }, aprobadores: [{ chat_id: 900 }] },
  } });
  await procesarUpdate(env, mensaje('mi mail es m@x.com gracias'));
  const sol = llamadas.rpc.find((x) => x.f === 'st_bot_solicitar');
  check('manda el mail y el nombre con usuario', sol?.cuerpo.p_email === 'm@x.com' && sol.cuerpo.p_nombre === 'Matías (@mati)', sol);
  const m = enviados(llamadas);
  check('responde el motivo', m[0]?.cuerpo.text === 'Listo, le pasé tu pedido', m);
  const kb = m[1]?.cuerpo.reply_markup?.inline_keyboard?.[0];
  check('avisa al que aprueba con botones', m[1]?.cuerpo.chat_id === 900 && kb?.[0].callback_data === 'apr:111' && kb?.[1].callback_data === 'rec:111', m[1]);
}
{
  const { env, llamadas } = falso({ rpcs: { st_bot_update_nuevo: true, st_bot_quien: { habilitado: true } } });
  await procesarUpdate(env, { update_id: 5, message: { chat: { id: -100, type: 'group' }, from: { first_name: 'X' }, text: 'hola' } });
  check('en un grupo no atiende aunque esté habilitado', enviados(llamadas)[0]?.cuerpo.text.includes('escribime el mail'), llamadas.tg);
}

console.log('Agente');
{
  const { env, llamadas } = falso({
    rpcs: {
      ...habilitado,
      st_bot_charla_leer: [{ rol: 'model', texto: 'suelto' }, { rol: 'user', texto: 'antes' }, { rol: 'model', texto: 'respuesta' }],
      st_bot_buscar: [{ codigo: 'CAP-01', nombre: 'Melena cápsulas' }],
      st_bot_preparar: { ok: true, resumen: '20 Melena' },
      st_bot_pendiente_para_mostrar: { hay: true, token: 'tok-1', resumen: '- Producción: 20 Melena <cápsulas> (CAP-01)' },
    },
    gemini: [
      llamada('buscar_items', { texto: 'melena caps' }, { thoughtSignature: 'firma-1' }),
      llamada('preparar_movimientos', { acciones: [{ tipo: 'produccion', codigo: 'CAP-01', cantidad: 20 }] }),
      texto('Te dejo la propuesta abajo, revisala y confirmá'),
    ],
  });
  await procesarUpdate(env, mensaje('hicimos 20 melena caps'));
  const g = llamadas.gemini;
  check('3 vueltas con el modelo principal y su clave', g.length === 3 && g.every((x) => x.modelo === 'principal' && x.clave === 'GK'), g.map((x) => x.modelo));
  const c0 = g[0].cuerpo.contents;
  check('la charla arranca con la persona y termina con el mensaje', c0.length === 3 && c0[0].role === 'user' && c0[0].parts[0].text === 'antes' && c0[2].parts[0].text === 'hicimos 20 melena caps', c0);
  check('el prompt lleva nombre y fecha de Argentina', g[0].cuerpo.systemInstruction.parts[0].text.includes('con Matías, del equipo') && g[0].cuerpo.systemInstruction.parts[0].text.includes('viernes 27 de noviembre, 14:05'), g[0].cuerpo.systemInstruction.parts[0].text.slice(0, 250));
  check('le pasa las 6 herramientas', g[0].cuerpo.tools[0].functionDeclarations.length === 6);
  const c1 = g[1].cuerpo.contents;
  check('devuelve la firma de pensamiento tal cual', c1[3].role === 'model' && c1[3].parts[0].thoughtSignature === 'firma-1', c1[3]);
  check('y la respuesta de la herramienta', c1[4].parts[0].functionResponse.name === 'buscar_items' && c1[4].parts[0].functionResponse.response.resultado[0].codigo === 'CAP-01', c1[4]);
  const b = llamadas.rpc.find((x) => x.f === 'st_bot_buscar');
  check('buscar sin categoría manda null', b.cuerpo.p_categoria === null && b.cuerpo.p_limite === 8 && b.cuerpo.p_texto === 'melena caps', b);
  const p = llamadas.rpc.find((x) => x.f === 'st_bot_preparar');
  check('preparar manda el chat y las acciones como lista', p.cuerpo.p_chat_id === 111 && Array.isArray(p.cuerpo.p_acciones) && p.cuerpo.p_acciones[0].cantidad === 20, p);
  check('anota que respondió', llamadas.rpc.some((x) => x.f === 'st_bot_checkin' && x.cuerpo.p_sin_novedades === false));
  const gu = llamadas.rpc.find((x) => x.f === 'st_bot_charla_guardar');
  check('guarda la charla', gu?.cuerpo.p_pregunta === 'hicimos 20 melena caps' && gu.cuerpo.p_respuesta.startsWith('Te dejo'), gu);
  const m = enviados(llamadas);
  check('responde y después muestra la propuesta', m.length === 2 && m[0].cuerpo.text.startsWith('Te dejo') && m[1].cuerpo.text.startsWith('📋 Propuesta'), m);
  check('la propuesta va escapada en HTML', m[1].cuerpo.parse_mode === 'HTML' && m[1].cuerpo.text.includes('&lt;cápsulas&gt;'), m[1].cuerpo.text);
  const kb = m[1].cuerpo.reply_markup.inline_keyboard[0];
  check('con Confirmar y Cancelar', kb[0].callback_data === 'ok:tok-1' && kb[1].callback_data === 'no:tok-1', kb);
  check('muestra "escribiendo…"', llamadas.tg.some((x) => x.metodo === 'sendChatAction'));
}
{
  const { env, llamadas } = falso({
    rpcs: { ...habilitado, st_bot_pedidos: [], st_bot_movimientos: [] },
    gemini: [
      { candidates: [{ content: { role: 'model', parts: [
        { functionCall: { name: 'pedidos_web', args: {} } },
        { functionCall: { name: 'movimientos_recientes', args: { horas: 5, texto: 'POL' } } },
      ] } }] },
      texto('Nada raro'),
    ],
  });
  await procesarUpdate(env, mensaje('¿está todo?'));
  const pw = llamadas.rpc.find((x) => x.f === 'st_bot_pedidos');
  const mv = llamadas.rpc.find((x) => x.f === 'st_bot_movimientos');
  check('dos herramientas a la vez', pw && mv && llamadas.gemini[1].cuerpo.contents.at(-1).parts.length === 2);
  check('pedidos con estados por defecto', JSON.stringify(pw.cuerpo) === JSON.stringify({ p_estados: ['confirmado', 'preparacion'], p_dias: 10 }), pw.cuerpo);
  check('movimientos con sus datos', mv.cuerpo.p_horas === 5 && mv.cuerpo.p_texto === 'POL' && mv.cuerpo.p_usuario === null, mv.cuerpo);
  check('sin propuesta: solo responde', enviados(llamadas).length === 1 && enviados(llamadas)[0].cuerpo.text === 'Nada raro');
}
{
  const { env, llamadas } = falso({ rpcs: habilitado, gemini: [{ status: 503, body: 'overloaded' }, texto('Hola desde el respaldo')] });
  await procesarUpdate(env, mensaje('hola'));
  check('si el principal está saturado usa el respaldo', llamadas.gemini.map((x) => x.modelo).join() === 'principal,respaldo' && enviados(llamadas)[0]?.cuerpo.text === 'Hola desde el respaldo', llamadas.gemini.map((x) => x.modelo));
}
{
  const { env, llamadas } = falso({ rpcs: habilitado, gemini: [{ status: 503 }, { status: 503 }] });
  await procesarUpdate(env, mensaje('hola'));
  const m = enviados(llamadas);
  check('si los dos fallan avisa y no carga nada', m.length === 1 && m[0].cuerpo.text.includes('tuve un problema'), m);
  check('y no guarda la charla', !llamadas.rpc.some((x) => x.f === 'st_bot_charla_guardar'));
}
{
  const { env, llamadas } = falso({ rpcs: { ...habilitado, st_bot_buscar: () => { throw new Error('x'); } }, gemini: [llamada('herramienta_rara', {}), texto('ok')] });
  await procesarUpdate(env, mensaje('hola'));
  const r = llamadas.gemini[1].cuerpo.contents.at(-1).parts[0].functionResponse.response.resultado;
  check('herramienta inexistente vuelve como error al modelo', r.error?.includes('No existe'), r);
}
{
  const { env, llamadas } = falso({ rpcs: habilitado });
  await procesarUpdate(env, mensaje('', 111, { photo: [{}] }));
  check('foto sin texto: pide texto', enviados(llamadas)[0]?.cuerpo.text.includes('solo leo mensajes de texto') && llamadas.gemini.length === 0);
}
{
  const { env, llamadas } = falso({ rpcs: habilitado, gemini: Array.from({ length: 20 }, () => llamada('resumen_del_dia', {})) });
  await procesarUpdate(env, mensaje('loop'));
  check('corta a las 15 vueltas', llamadas.gemini.length === 15 && enviados(llamadas)[0]?.cuerpo.text.includes('tuve un problema'), llamadas.gemini.length);
}
{
  const largo = 'línea\n'.repeat(900);
  const { env, llamadas } = falso({ rpcs: habilitado, gemini: [texto(largo)] });
  await procesarUpdate(env, mensaje('mucho'));
  const m = enviados(llamadas);
  check('un texto largo se parte en mensajes de menos de 4096', m.length === 2 && m.every((x) => x.cuerpo.text.length <= 4096), m.map((x) => x.cuerpo.text.length));
}

console.log('Botones');
{
  const { env, llamadas } = falso({ rpcs: { st_bot_update_nuevo: true, st_bot_confirmar: { ok: true, texto: '- 20 Melena (10 → 30)' } } });
  await procesarUpdate(env, boton('ok:tok-1'));
  const c = llamadas.rpc.find((x) => x.f === 'st_bot_confirmar');
  check('confirmar manda token y chat', c.cuerpo.p_token === 'tok-1' && c.cuerpo.p_chat_id === 111, c);
  check('contesta el botón', llamadas.tg[0].metodo === 'answerCallbackQuery' && llamadas.tg[0].cuerpo.callback_query_id === 'cb1');
  const e = llamadas.tg.find((x) => x.metodo === 'editMessageText');
  check('edita sin "¿La cargo?" y con quién cargó', e.cuerpo.message_id === 55 && !e.cuerpo.text.includes('¿La cargo?') && e.cuerpo.text.endsWith('✅ Cargado por Franco:\n- 20 Melena (10 → 30)'), e.cuerpo.text);
}
{
  const { env, llamadas } = falso({ rpcs: { st_bot_update_nuevo: true, st_bot_confirmar: { ok: false, error: 'La propuesta venció' } } });
  await procesarUpdate(env, boton('ok:tok-1'));
  check('confirmar con error lo muestra', llamadas.tg.find((x) => x.metodo === 'editMessageText').cuerpo.text.endsWith('⚠️ La propuesta venció'));
}
{
  const { env, llamadas } = falso({ rpcs: { st_bot_update_nuevo: true, st_bot_cancelar: { ok: true } } });
  await procesarUpdate(env, boton('no:tok-1'));
  check('cancelar', llamadas.rpc.some((x) => x.f === 'st_bot_cancelar') && llamadas.tg.find((x) => x.metodo === 'editMessageText').cuerpo.text.includes('❌ Cancelado'));
}
{
  const { env, llamadas } = falso({ rpcs: { st_bot_update_nuevo: true, st_bot_checkin: { ok: true } } });
  await procesarUpdate(env, boton('nada:hoy', '¡Hola Matías! 🍄 Cierre'));
  const ci = llamadas.rpc.find((x) => x.f === 'st_bot_checkin');
  check('sin novedades se anota', ci.cuerpo.p_sin_novedades === true && llamadas.tg.find((x) => x.metodo === 'editMessageText').cuerpo.text.endsWith('👍 Anotado: sin novedades hoy. ¡Gracias!'));
}
{
  const { env, llamadas } = falso({ rpcs: { st_bot_update_nuevo: true, st_bot_resolver_solicitud: { ok: true, aprobada: true, chat_id: 777, nombre: 'Maty' } } });
  await procesarUpdate(env, boton('apr:777', '🔑 Pedido de acceso'));
  const r = llamadas.rpc.find((x) => x.f === 'st_bot_resolver_solicitud');
  check('aprobar manda los chats', r.cuerpo.p_chat_aprobador === 111 && r.cuerpo.p_chat_solicitante === 777 && r.cuerpo.p_aprobar === true, r);
  const m = enviados(llamadas);
  check('le avisa a quien pidió', m[0]?.cuerpo.chat_id === 777 && m[0].cuerpo.text.startsWith('¡Listo Maty! Ya estás habilitado'), m);
}
{
  const { env, llamadas } = falso({ rpcs: { st_bot_update_nuevo: true, st_bot_resolver_solicitud: { ok: false, error: 'Ese pedido ya estaba resuelto.' } } });
  await procesarUpdate(env, boton('rec:777', '🔑 Pedido'));
  check('rechazar repetido: no avisa a nadie', enviados(llamadas).length === 0 && llamadas.tg.find((x) => x.metodo === 'editMessageText').cuerpo.text.endsWith('⚠️ Ese pedido ya estaba resuelto.'));
}

console.log('Pregunta diaria');
{
  const { env, llamadas } = falso({ rpcs: {
    st_bot_resumen_dia: { fecha: '27/11', producciones_cargadas: [{ cantidad: 0.5, nombre: 'Tremella gel' }], salidas_cargadas: [], pedidos_web_descontados_hoy: 2, pedidos_confirmados_sin_preparar: 1, productos_en_negativo: [{ nombre: 'A<B', en_estante: -1 }] },
    st_bot_destinatarios_resumen: [{ chat_id: 111, nombre: 'Matías' }, { chat_id: 222, nombre: 'Maty' }],
  } });
  const r = await preguntaDiaria(env);
  const m = enviados(llamadas);
  check('una pregunta por persona', r.enviadas === 2 && m.length === 2 && m[1].cuerpo.chat_id === 222);
  const t = m[0].cuerpo.text;
  check('con lo ya cargado', t.includes('Cierre de stock del 27/11') && t.includes('1 producción (0,5 Tremella gel)') && t.includes('2 pedidos web descontados') && t.includes('Hay 1 pedido web en Confirmado'), t);
  check('escapada en HTML', t.includes('A&lt;B (-1)'), t);
  check('con el botón Sin novedades', m[0].cuerpo.reply_markup.inline_keyboard[0][0].callback_data === 'nada:hoy');
}

check('esc', esc('a & <b>') === 'a &amp; &lt;b&gt;');

console.log(`\n${ok} OK · ${mal} MAL`);
process.exit(mal ? 1 : 0);
