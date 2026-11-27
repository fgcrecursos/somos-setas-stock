-- =====================================================================
-- BOT DE STOCK: pasa de n8n (compu de Frani) a una Edge Function de Supabase
--
-- Exige haber corrido bot_stock_telegram_2026-11-22.sql (las funciones
-- st_bot_* que el bot ya usaba no cambian).
--
-- Agrega:
--   1. La memoria de la charla (antes vivía adentro de n8n).
--   2. Un registro de los mensajes ya atendidos: si Telegram reintenta, no
--      se procesa dos veces.
--   3. Una clave interna en Vault: Telegram la manda en cada mensaje y la
--      pregunta diaria también; la función rechaza lo que no la traiga.
--   4. La pregunta diaria con pg_cron: lunes a sábado 12 h (15 h UTC).
--
-- Se puede correr más de una vez. No toca stock ni pedidos.
-- =====================================================================

-- ---------- 1. Memoria de la charla ----------
create table if not exists public.st_bot_charla (
  id         bigserial primary key,
  chat_id    bigint not null,
  rol        text not null check (rol in ('user', 'model')),
  texto      text not null,
  created_at timestamptz not null default now()
);
create index if not exists st_bot_charla_chat_idx on public.st_bot_charla (chat_id, id desc);
alter table public.st_bot_charla enable row level security;

-- Lo último que se habló con ese chat, de lo más viejo a lo más nuevo.
-- Solo las últimas 12 horas: una charla de otro día confunde más de lo que ayuda.
create or replace function public.st_bot_charla_leer(p_chat_id bigint, p_limite int default 40)
returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('rol', rol, 'texto', texto) order by id), '[]'::jsonb)
    from (select id, rol, texto from public.st_bot_charla
           where chat_id = p_chat_id and created_at > now() - interval '12 hours'
           order by id desc
           limit greatest(1, least(coalesce(p_limite, 40), 100))) c;
$$;

create or replace function public.st_bot_charla_guardar(p_chat_id bigint, p_pregunta text, p_respuesta text)
returns void
language sql security definer set search_path = public as $$
  insert into public.st_bot_charla (chat_id, rol, texto)
  select p_chat_id, x.rol, x.texto
    from (values (1, 'user', p_pregunta), (2, 'model', p_respuesta)) as x(orden, rol, texto)
   where coalesce(trim(x.texto), '') <> ''
   order by x.orden;
  delete from public.st_bot_charla where created_at < now() - interval '7 days';
$$;

-- ---------- 2. Mensajes ya atendidos ----------
create table if not exists public.st_bot_updates (
  update_id  bigint primary key,
  created_at timestamptz not null default now()
);
alter table public.st_bot_updates enable row level security;

-- true si es la primera vez que llega ese update de Telegram.
create or replace function public.st_bot_update_nuevo(p_update_id bigint)
returns boolean
language plpgsql security definer set search_path = public as $$
declare
  n int;
begin
  insert into public.st_bot_updates (update_id) values (p_update_id) on conflict do nothing;
  get diagnostics n = row_count;
  if n > 0 and random() < 0.05 then
    delete from public.st_bot_updates where created_at < now() - interval '3 days';
  end if;
  return n > 0;
end;
$$;

-- ---------- 3. Clave interna (Vault) ----------
-- Solo letras y números: Telegram la acepta como secret_token del webhook.
create or replace function public.st_bot_clave()
returns text
language plpgsql security definer set search_path = public as $$
declare
  c text;
begin
  select decrypted_secret into c from vault.decrypted_secrets where name = 'bot_stock_clave' limit 1;
  return c;
end;
$$;

do $$
begin
  if not exists (select 1 from pg_namespace where nspname = 'vault') then
    raise notice 'No hay Vault (¿no es Supabase?): no se crea la clave.';
    return;
  end if;
  if not exists (select 1 from vault.secrets where name = 'bot_stock_clave') then
    perform vault.create_secret(
      replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
      'bot_stock_clave',
      'Clave interna del bot de stock (webhook de Telegram y pregunta diaria)');
  end if;
end $$;

-- ---------- 4. Permisos: solo la clave secreta (la Edge Function) ----------
do $$
declare
  f text;
begin
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    raise notice 'No existe el rol service_role (¿no es Supabase?): no se otorgan permisos.';
    return;
  end if;
  foreach f in array array[
    'public.st_bot_charla_leer(bigint, int)',
    'public.st_bot_charla_guardar(bigint, text, text)',
    'public.st_bot_update_nuevo(bigint)',
    'public.st_bot_clave()'
  ] loop
    execute format('revoke all on function %s from public', f);
    execute format('revoke all on function %s from anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;

-- ---------- 5. Pregunta diaria: lunes a sábado 12 h de Argentina ----------
do $$
begin
  if not exists (select 1 from pg_available_extensions where name = 'pg_cron')
     or not exists (select 1 from pg_available_extensions where name = 'pg_net') then
    raise notice 'Sin pg_cron o pg_net (¿no es Supabase?): no se programa la pregunta diaria.';
    return;
  end if;
  create extension if not exists pg_cron;
  create extension if not exists pg_net;

  perform cron.unschedule(jobid) from cron.job where jobname = 'bot-stock-pregunta-diaria';
  perform cron.schedule('bot-stock-pregunta-diaria', '0 15 * * 1-6', $cron$
    select net.http_post(
      url     := 'https://muuqqbocpumdvhvxsigz.supabase.co/functions/v1/bot-stock',
      headers := jsonb_build_object('Content-Type', 'application/json',
                                    'x-bot-clave', public.st_bot_clave()),
      body    := '{"tarea":"pregunta_diaria"}'::jsonb,
      timeout_milliseconds := 60000);
  $cron$);
end $$;

-- ---------- 6. Control ----------
select concat_ws(' | ',
  'funciones del bot: ' || (select count(*) from pg_proc where proname like 'st\_bot\_%'),
  'clave: ' || case when public.st_bot_clave() is null then 'FALTA' else 'ok' end,
  'pregunta diaria: ' || coalesce((select schedule from cron.job where jobname = 'bot-stock-pregunta-diaria'), 'sin programar')
) as resultado;
