// Edge Function del bot de stock (Telegram). La lógica está en bot.ts.
//
// Recibe tres cosas, todas por POST:
//  - Mensajes de Telegram: traen el header X-Telegram-Bot-Api-Secret-Token con
//    la clave interna (Vault: bot_stock_clave). Se contesta 200 al toque y se
//    procesa en segundo plano, para que Telegram no reintente mientras piensa Gemini.
//  - La pregunta diaria: la manda pg_cron con el header x-bot-clave.
//  - {"tarea":"configurar"} con el header x-bot-token = token del bot: le dice
//    a Telegram que mande los mensajes acá. Se usa una vez, al publicar.
//
// Se publica sin verificación de JWT (Telegram no manda uno):
//   npx supabase functions deploy bot-stock --no-verify-jwt --project-ref muuqqbocpumdvhvxsigz

import { type Entorno, preguntaDiaria, procesarUpdate, rpc, tg } from './bot.ts';

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void };

const env: Entorno = {
  supabaseUrl: Deno.env.get('SUPABASE_URL')!,
  serviceKey: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  telegramToken: Deno.env.get('TELEGRAM_TOKEN') ?? '',
  geminiKey: Deno.env.get('GEMINI_API_KEY') ?? '',
  modelos: (Deno.env.get('GEMINI_MODELOS') ?? 'gemini-3.5-flash,gemini-3.5-flash-lite').split(',').map((s) => s.trim()).filter(Boolean),
  fetch: (...a) => fetch(...a),
  log: (...a) => console.error('[bot-stock]', ...a),
};

let clave: Promise<string | null> | null = null;
const laClave = () => (clave ??= rpc(env, 'st_bot_clave').catch((e) => { clave = null; throw e; }));

const json = (cuerpo: unknown, status = 200) =>
  new Response(JSON.stringify(cuerpo), { status, headers: { 'Content-Type': 'application/json' } });

/** Compara sin cortar en el primer carácter distinto. */
function iguales(a: string, b: string) {
  if (!a || !b || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

Deno.serve(async (req) => {
  try {
    return await atender(req);
  } catch (e) {
    env.log?.('pedido', e);
    return json({ error: String(e instanceof Error ? e.message : e) }, 500);
  }
});

async function atender(req: Request): Promise<Response> {
  if (req.method !== 'POST') return json({ error: 'Solo POST' }, 405);

  const deTelegram = req.headers.get('x-telegram-bot-api-secret-token');
  const deCron = req.headers.get('x-bot-clave');
  const conToken = req.headers.get('x-bot-token');

  if (deTelegram !== null || deCron !== null) {
    const c = await laClave();
    if (!c) return json({ error: 'Falta la clave en Vault' }, 500);

    if (deTelegram !== null) {
      if (!iguales(deTelegram, c)) return json({ error: 'No autorizado' }, 401);
      const update = await req.json().catch(() => null);
      if (update) {
        EdgeRuntime.waitUntil(procesarUpdate(env, update).catch((e) => env.log?.('update', update.update_id, e)));
      }
      return json({ ok: true });
    }

    if (!iguales(deCron!, c)) return json({ error: 'No autorizado' }, 401);
    const { tarea } = await req.json().catch(() => ({}));
    if (tarea === 'pregunta_diaria') return json(await preguntaDiaria(env));
    return json({ error: `Tarea desconocida: ${tarea}` }, 400);
  }

  if (conToken !== null) {
    if (!iguales(conToken, env.telegramToken)) return json({ error: 'No autorizado' }, 401);
    const { tarea } = await req.json().catch(() => ({}));
    if (tarea !== 'configurar') return json({ error: `Tarea desconocida: ${tarea}` }, 400);
    const c = await laClave();
    if (!c) return json({ error: 'Falta la clave en Vault: corré supabase/bot_stock_supabase_2026-11-27.sql' }, 500);
    await tg(env, 'setWebhook', {
      url: `${env.supabaseUrl}/functions/v1/bot-stock`,
      secret_token: c,
      allowed_updates: ['message', 'callback_query'],
      max_connections: 10,
    });
    const info = await tg(env, 'getWebhookInfo', {});
    return json({ ok: true, url: info.url, pendientes: info.pending_update_count, ultimo_error: info.last_error_message ?? null });
  }

  return json({ error: 'No autorizado' }, 401);
}
