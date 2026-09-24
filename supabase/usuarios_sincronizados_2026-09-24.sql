-- Usuarios en las dos plataformas: panel de la tienda (ss_users) y Stock (st_users).
--
-- Pedido de Frani (2026-09-24): que las cuentas estén en todas las plataformas.
--
-- 1) Alta de los que faltan hoy (decisión de Frani, uno por uno):
--      Stock  ← Juan Santi y Florencia Henriquez, como admin.
--               Gaspar Ortega y Nacha quedan AFUERA de Stock a propósito.
--      Panel  ← Mayra Santi como "admin" (Administrador general) y
--               Martín Abraham (Calidad) como "deposito" (Depósito y entregas).
--    Si la persona ya está en la otra tabla no se toca (on conflict do nothing).
--
-- 2) De acá en adelante, automático:
--      - Alta en el panel  → alta en Stock. Rol: superadmin/admin/ventas/deposito
--        → admin (pueden vender y producir); el resto (lectura, catalogo,
--        cobranzas, custom) → invitado (solo mira).
--      - Alta en Stock     → alta en el panel. admin → "admin"; invitado → "lectura".
--      - Baja (activo=false o borrar la fila) en una → activo=false en la otra.
--      - Reactivar en una → reactiva en la otra.
--    Los cambios de ROL no se copian: cada plataforma decide el suyo.
--    Nunca se desactiva a un superadmin del panel desde Stock (anti-lockout).
--    La cuenta demo invitado@somossetas.com.ar no pasa al panel.
--
-- La contraseña es una sola: las dos plataformas usan el mismo Supabase Auth.
-- Idempotente. Va después de stock_schema.sql y de ss_users.sql.

-- ---------------------------------------------------------------------
-- 1) Carga de hoy
-- ---------------------------------------------------------------------
insert into public.st_users (email, nombre, rol, activo, notas) values
  ('juan.santi@somossetas.com.ar', 'Juan Santi',         'admin', true, 'Alta desde el panel de la tienda (2026-09-24)'),
  ('somossetas@gmail.com',         'Florencia Henriquez', 'admin', true, 'Alta desde el panel de la tienda (2026-09-24)')
on conflict (email) do nothing;

insert into public.ss_users (email, nombre, rol, permisos, activo, notas) values
  ('mayra.santi@somossetas.com.ar',     'Mayra Santi',            'admin',    '[]'::jsonb, true, 'Alta desde Stock (2026-09-24)'),
  ('tecnica.calidad@somossetas.com.ar', 'Martin Abraham Calidas', 'deposito', '[]'::jsonb, true, 'Alta desde Stock (2026-09-24)')
on conflict (email) do nothing;

-- ---------------------------------------------------------------------
-- 2) Sincronización automática
-- ---------------------------------------------------------------------
create or replace function public.sync_ss_a_st()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if pg_trigger_depth() > 1 then return null; end if;  -- viene del otro trigger

  if tg_op = 'INSERT' then
    insert into public.st_users (email, nombre, rol, activo, notas)
    values (new.email, new.nombre,
            case when new.rol in ('superadmin', 'admin', 'ventas', 'deposito') then 'admin' else 'invitado' end,
            new.activo, 'Alta automática desde el panel de la tienda')
    on conflict (email) do nothing;
  elsif tg_op = 'UPDATE' and new.activo is distinct from old.activo then
    update public.st_users set activo = new.activo where email = new.email;
  elsif tg_op = 'DELETE' then
    update public.st_users set activo = false where email = old.email;
  end if;
  return null;
end;
$$;

create or replace function public.sync_st_a_ss()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if pg_trigger_depth() > 1 then return null; end if;

  if tg_op = 'INSERT' then
    if new.email = 'invitado@somossetas.com.ar' then return null; end if;
    insert into public.ss_users (email, nombre, rol, permisos, activo, notas)
    values (new.email, new.nombre,
            case when new.rol = 'admin' then 'admin' else 'lectura' end,
            '[]'::jsonb, new.activo, 'Alta automática desde Stock')
    on conflict (email) do nothing;
  elsif tg_op = 'UPDATE' and new.activo is distinct from old.activo then
    update public.ss_users set activo = new.activo
     where email = new.email and (new.activo or rol <> 'superadmin');
  elsif tg_op = 'DELETE' then
    update public.ss_users set activo = false
     where email = old.email and rol <> 'superadmin';
  end if;
  return null;
end;
$$;

revoke all on function public.sync_ss_a_st() from public;
revoke all on function public.sync_st_a_ss() from public;

drop trigger if exists ss_users_sync_st on public.ss_users;
create trigger ss_users_sync_st
  after insert or update of activo or delete on public.ss_users
  for each row execute function public.sync_ss_a_st();

drop trigger if exists st_users_sync_ss on public.st_users;
create trigger st_users_sync_ss
  after insert or update of activo or delete on public.st_users
  for each row execute function public.sync_st_a_ss();

-- Control: quién queda en cada plataforma
select coalesce(s.email, t.email) as email,
       s.rol as rol_panel, s.activo as activo_panel,
       t.rol as rol_stock, t.activo as activo_stock
  from public.ss_users s
  full join public.st_users t on t.email = s.email
 order by 1;
