-- =====================================================================
-- ALTA DE PERSONAS EN EL BOT DE STOCK (Telegram)
--
-- Normalmente NO hace falta: la persona le escribe al bot su mail y quien
-- aprueba accesos (aprueba = true) la habilita con un botón. Este script
-- sirve para el primer aprobador o para dar de alta a mano.
--
-- 1. La persona le escribe al bot y el bot le contesta con su número de chat.
-- 2. Completá una fila por persona abajo y corré el script en Supabase.
--
-- Tiene que ser admin activo en st_users (el mismo mail con el que entra
-- a la plataforma de stock). Si no, el script avisa y no da de alta nada.
-- Correrlo de nuevo con la misma persona actualiza nombre y mail.
-- =====================================================================

do $$
declare
  p record;
begin
  for p in
    select * from (values
      -- (número de chat, mail en st_users,                  nombre,   ¿pregunta diaria?, ¿aprueba accesos?)
      (000000000::bigint, 'matias.aurieme@somossetas.com.ar', 'Matías', true, false)
      -- ,(000000000::bigint, 'mayra.santi@somossetas.com.ar', 'Mayra', true, false)
    ) as t(chat_id, email, nombre, resumen_diario, aprueba)
  loop
    if p.chat_id = 0 then
      raise exception 'Falta completar el número de chat de %', p.nombre;
    end if;
    if not exists (select 1 from public.st_users u
                    where u.email = lower(trim(p.email)) and u.rol = 'admin' and u.activo) then
      raise exception '% no es admin activo en st_users: dalo de alta en Usuarios de la plataforma primero', p.email;
    end if;

    insert into public.st_bot_usuarios (chat_id, email, nombre, resumen_diario, activo, aprueba)
    values (p.chat_id, lower(trim(p.email)), p.nombre, p.resumen_diario, true, p.aprueba)
    on conflict (chat_id) do update
      set email = excluded.email, nombre = excluded.nombre,
          resumen_diario = excluded.resumen_diario, activo = true, aprueba = excluded.aprueba;
  end loop;
end $$;

select concat_ws(' · ', b.nombre, b.chat_id, b.email,
                 case when b.resumen_diario then 'recibe la pregunta' else 'sin pregunta diaria' end,
                 case when b.activo then 'activo' else 'apagado' end) as bot
  from public.st_bot_usuarios b
 order by b.nombre;
