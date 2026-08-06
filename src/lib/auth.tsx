// =====================================================================
// Sesión, rol y gestión de usuarios de la plataforma de stock.
//
// Quién entra lo decide Supabase Auth (la misma cuenta que la tienda).
// Qué puede hacer adentro lo decide la fila de `st_users`:
//   admin    → crea, edita, vende, produce, ajusta
//   invitado → solo mira
// Si alguien tiene cuenta pero no está en st_users, entra a una pantalla
// que le avisa que todavía no tiene acceso.
// =====================================================================
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import type { Session } from '@supabase/supabase-js';
import { clienteAislado, sb } from './supabase';
import type { Rol, UsuarioStock } from './types';

interface AuthCtx {
  cargando: boolean;
  session: Session | null;
  email: string;
  perfil: UsuarioStock | null;
  /** Logueado y con permiso de edición */
  esAdmin: boolean;
  /** Tiene cuenta pero nadie le dio acceso a esta plataforma */
  sinAcceso: boolean;
  entrar: (email: string, password: string) => Promise<{ error?: string }>;
  salir: () => Promise<void>;
  usuarios: UsuarioStock[];
  recargarUsuarios: () => Promise<void>;
  crearUsuario: (u: {
    email: string;
    password: string;
    nombre: string;
    rol: Rol;
  }) => Promise<{ ok?: boolean; error?: string; aviso?: string }>;
  actualizarUsuario: (
    email: string,
    campos: Partial<UsuarioStock>
  ) => Promise<{ ok?: boolean; error?: string }>;
  eliminarUsuario: (email: string) => Promise<{ ok?: boolean; error?: string }>;
}

const Ctx = createContext<AuthCtx | null>(null);

function explicar(msg: string): string {
  const m = (msg || '').toLowerCase();
  if (m.includes('invalid login')) return 'Email o contraseña incorrectos.';
  if (m.includes('email not confirmed')) return 'La cuenta todavía no está confirmada. Confirmala desde el mail o desde Supabase.';
  if (m.includes('rate') || m.includes('too many')) return 'Demasiados intentos seguidos. Esperá un minuto y probá de nuevo.';
  if (m.includes('failed to fetch') || m.includes('network')) return 'No se pudo conectar con el servidor. Revisá tu conexión.';
  return msg || 'Ocurrió un error inesperado.';
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [perfil, setPerfil] = useState<UsuarioStock | null>(null);
  const [cargando, setCargando] = useState(true);
  const [perfilListo, setPerfilListo] = useState(false);
  const [usuarios, setUsuarios] = useState<UsuarioStock[]>([]);

  const email = (session?.user?.email ?? '').toLowerCase();

  useEffect(() => {
    sb.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setCargando(false);
    });
    const { data } = sb.auth.onAuthStateChange((_e, s) => {
      setSession(s);
      setCargando(false);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  // Al entrar, buscamos qué rol tiene esta persona.
  useEffect(() => {
    let vivo = true;
    if (!email) {
      setPerfil(null);
      setPerfilListo(false);
      setUsuarios([]);
      return;
    }
    setPerfilListo(false);
    sb.from('st_users')
      .select('*')
      .eq('email', email)
      .maybeSingle()
      .then(({ data, error }) => {
        if (!vivo) return;
        if (error) console.warn('No se pudo leer st_users:', error.message);
        setPerfil(data && data.activo ? (data as UsuarioStock) : null);
        setPerfilListo(true);
      });
    return () => {
      vivo = false;
    };
  }, [email]);

  const esAdmin = perfil?.rol === 'admin' && perfil.activo !== false;

  const recargarUsuarios = useCallback(async () => {
    const { data, error } = await sb
      .from('st_users')
      .select('*')
      .order('rol')
      .order('email');
    if (error) {
      console.error('No se pudieron cargar los usuarios:', error.message);
      return;
    }
    setUsuarios((data ?? []) as UsuarioStock[]);
  }, []);

  useEffect(() => {
    if (esAdmin) recargarUsuarios();
  }, [esAdmin, recargarUsuarios]);

  const entrar = useCallback(async (mail: string, password: string) => {
    const { error } = await sb.auth.signInWithPassword({
      email: mail.trim().toLowerCase(),
      password,
    });
    return error ? { error: explicar(error.message) } : {};
  }, []);

  const salir = useCallback(async () => {
    await sb.auth.signOut();
    setPerfil(null);
  }, []);

  const crearUsuario = useCallback<AuthCtx['crearUsuario']>(
    async ({ email: mail, password, nombre, rol }) => {
      const limpio = (mail || '').trim().toLowerCase();
      if (!limpio) return { error: 'Falta el email.' };
      if (!password || password.length < 6)
        return { error: 'La contraseña tiene que tener al menos 6 caracteres.' };

      let aviso = '';
      try {
        const tmp = clienteAislado();
        const { error } = await tmp.auth.signUp({ email: limpio, password });
        if (error) {
          // Que ya exista no es un problema: la persona ya tiene cuenta de la
          // tienda y acá solo le estamos dando acceso al stock.
          if (/already|registered|exists/i.test(error.message)) {
            aviso =
              'Esa cuenta ya existía: mantiene su contraseña actual y ahora además tiene acceso al stock.';
          } else {
            return { error: explicar(error.message) };
          }
        }
      } catch (err: any) {
        return { error: explicar(err?.message ?? String(err)) };
      }

      const { error } = await sb
        .from('st_users')
        .upsert({ email: limpio, nombre, rol, activo: true }, { onConflict: 'email' });
      if (error)
        return {
          error: 'Se creó la cuenta de acceso pero no se pudo guardar el permiso: ' + error.message,
        };

      await recargarUsuarios();
      return { ok: true, aviso };
    },
    [recargarUsuarios]
  );

  const actualizarUsuario = useCallback<AuthCtx['actualizarUsuario']>(
    async (mail, campos) => {
      const { error } = await sb
        .from('st_users')
        .update(campos)
        .eq('email', mail.toLowerCase());
      if (error) return { error: 'No se pudo guardar: ' + error.message };
      await recargarUsuarios();
      if (mail.toLowerCase() === email) {
        const { data } = await sb.from('st_users').select('*').eq('email', email).maybeSingle();
        setPerfil(data && data.activo ? (data as UsuarioStock) : null);
      }
      return { ok: true };
    },
    [recargarUsuarios, email]
  );

  const eliminarUsuario = useCallback<AuthCtx['eliminarUsuario']>(
    async (mail) => {
      const { error } = await sb.from('st_users').delete().eq('email', mail.toLowerCase());
      if (error) return { error: 'No se pudo eliminar: ' + error.message };
      await recargarUsuarios();
      return { ok: true };
    },
    [recargarUsuarios]
  );

  const valor: AuthCtx = {
    cargando: cargando || (!!email && !perfilListo),
    session,
    email,
    perfil,
    esAdmin,
    sinAcceso: !!email && perfilListo && !perfil,
    entrar,
    salir,
    usuarios,
    recargarUsuarios,
    crearUsuario,
    actualizarUsuario,
    eliminarUsuario,
  };

  return <Ctx.Provider value={valor}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useAuth debe usarse dentro de AuthProvider');
  return ctx;
}
