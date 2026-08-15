import { AlertTriangle, Eye, EyeOff, KeyRound, LogIn, RefreshCw, ShieldAlert } from 'lucide-react';
import { useState } from 'react';
import { useAuth } from '../lib/auth';

const EMAIL_INVITADO = 'invitado@somossetas.com.ar';
// Cuenta compartida de solo lectura: cualquiera que toque el botón entra sin
// tipear nada. No protege nada sensible (RLS igual bloquea toda escritura
// para este rol), así que no hay problema en que viaje en el bundle.
const PASSWORD_INVITADO = 'SomosSetas-Invitado-2026';

export function LoginView() {
  const { entrar, enviarLinkPassword } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [verPass, setVerPass] = useState(false);
  const [error, setError] = useState('');
  const [aviso, setAviso] = useState('');
  const [entrando, setEntrando] = useState(false);
  const [fallo, setFallo] = useState(false);

  async function submit(ev: React.FormEvent) {
    ev.preventDefault();
    if (!email.trim() || !password) {
      setError('Completá el email y la contraseña.');
      return;
    }
    setError('');
    setAviso('');
    setEntrando(true);
    const res = await entrar(email, password);
    setEntrando(false);
    if (res.error) {
      setError(res.error);
      setFallo(true);
    }
  }

  async function olvide() {
    if (!email.trim()) {
      setError('Escribí tu email arriba y volvé a tocar el link.');
      return;
    }
    setError('');
    setEntrando(true);
    const res = await enviarLinkPassword(email);
    setEntrando(false);
    if (res.error) setError(res.error);
    else
      setAviso(
        `Te mandamos un mail a ${email.trim().toLowerCase()} con un link para poner una contraseña nueva. Revisá también el correo no deseado.`
      );
  }

  async function entrarComoInvitado() {
    setError('');
    setEntrando(true);
    const res = await entrar(EMAIL_INVITADO, PASSWORD_INVITADO);
    setEntrando(false);
    if (res.error) setError(res.error);
  }

  return (
    <div className="login">
      <form className="login__card" onSubmit={submit} autoComplete="off">
        <img src="/brand/logo-vertical.png" alt="Somos Setas" className="login__logo" />
        <h1 className="login__title">Control de Stock</h1>
        <p className="login__sub">Ingresá con tu cuenta de Somos Setas.</p>

        <div className="field">
          <label>Email</label>
          <input
            className="input"
            type="email"
            autoComplete="off"
            placeholder="nombre@somossetas.com.ar"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoFocus
          />
        </div>

        <div className="field">
          <label>Contraseña</label>
          <div className="login__pass">
            <input
              className="input"
              type={verPass ? 'text' : 'password'}
              autoComplete="off"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <button
              type="button"
              className="login__eye"
              onClick={() => setVerPass((v) => !v)}
              aria-label={verPass ? 'Ocultar contraseña' : 'Mostrar contraseña'}
            >
              {verPass ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
        </div>

        {error && (
          <div className="login__error">
            <ShieldAlert size={16} />
            <span>{error}</span>
          </div>
        )}

        {/* Caso típico: la persona ya tenía cuenta de la tienda, así que la
            contraseña que le pasaron al darla de alta acá nunca se aplicó. */}
        {fallo && !aviso && (
          <p className="login__hint" style={{ marginTop: 10, marginBottom: 0 }}>
            Si ya tenías cuenta de Somos Setas, entrá con <strong>esa</strong> contraseña, no con una
            nueva. Si no la recordás, tocá “Olvidé mi contraseña”.
          </p>
        )}

        {aviso && (
          <div className="login__error" style={{ background: 'var(--naranja-100)', color: 'var(--naranja-600)' }}>
            <KeyRound size={16} />
            <span>{aviso}</span>
          </div>
        )}

        <button className="btn btn--primary login__submit" type="submit" disabled={entrando}>
          <LogIn size={16} /> {entrando ? 'Entrando…' : 'Entrar'}
        </button>

        <button type="button" className="login__guest" onClick={olvide} disabled={entrando}>
          Olvidé mi contraseña
        </button>

        <button
          type="button"
          className="login__guest"
          onClick={entrarComoInvitado}
          disabled={entrando}
        >
          Solo quiero mirar → entrar como invitado
        </button>
        <p className="login__hint">
          La cuenta de invitado ve todo el inventario y el historial, pero no puede modificar nada.
        </p>
      </form>
    </div>
  );
}

/**
 * Entró por el link de "restablecer contraseña". El link ya lo deja logueado,
 * así que si no le pedimos una contraseña nueva acá, mañana vuelve a quedar
 * afuera con el mismo problema.
 */
export function NuevaPasswordView() {
  const { email, fijarPassword, salir } = useAuth();
  const [password, setPassword] = useState('');
  const [repetir, setRepetir] = useState('');
  const [verPass, setVerPass] = useState(false);
  const [error, setError] = useState('');
  const [guardando, setGuardando] = useState(false);

  async function submit(ev: React.FormEvent) {
    ev.preventDefault();
    if (password.length < 6) return setError('La contraseña tiene que tener al menos 6 caracteres.');
    if (password !== repetir) return setError('Las dos contraseñas no coinciden.');
    setError('');
    setGuardando(true);
    const res = await fijarPassword(password);
    setGuardando(false);
    if (res.error) setError(res.error);
  }

  return (
    <div className="login">
      <form className="login__card" onSubmit={submit} autoComplete="off">
        <KeyRound size={38} color="var(--naranja)" style={{ margin: '0 auto 14px', display: 'block' }} />
        <h1 className="login__title">Poné tu contraseña</h1>
        <p className="login__sub">
          Es la que vas a usar de acá en adelante para entrar al control de stock y a la tienda con{' '}
          <strong>{email}</strong>.
        </p>

        <div className="field">
          <label>Contraseña nueva (mínimo 6 caracteres)</label>
          <div className="login__pass">
            <input
              className="input"
              type={verPass ? 'text' : 'password'}
              autoComplete="off"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoFocus
            />
            <button
              type="button"
              className="login__eye"
              onClick={() => setVerPass((v) => !v)}
              aria-label={verPass ? 'Ocultar contraseña' : 'Mostrar contraseña'}
            >
              {verPass ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
        </div>

        <div className="field">
          <label>Repetila</label>
          <input
            className="input"
            type={verPass ? 'text' : 'password'}
            autoComplete="off"
            value={repetir}
            onChange={(e) => setRepetir(e.target.value)}
          />
        </div>

        {error && (
          <div className="login__error">
            <ShieldAlert size={16} />
            <span>{error}</span>
          </div>
        )}

        <button className="btn btn--primary login__submit" type="submit" disabled={guardando}>
          <KeyRound size={16} /> {guardando ? 'Guardando…' : 'Guardar y entrar'}
        </button>
        <button type="button" className="login__guest" onClick={salir} disabled={guardando}>
          Cancelar y salir
        </button>
      </form>
    </div>
  );
}

/**
 * No se pudo leer el permiso por un problema técnico. Es distinto de no tener
 * acceso: acá el error es nuestro, así que se dice qué pasó y se deja reintentar.
 */
export function ErrorAccesoView() {
  const { email, errorPerfil, reintentarPerfil, salir } = useAuth();
  return (
    <div className="login">
      <div className="login__card" style={{ textAlign: 'center' }}>
        <AlertTriangle size={38} color="var(--agotado)" style={{ margin: '0 auto 14px' }} />
        <h1 className="login__title">No pudimos verificar tu acceso</h1>
        <p className="login__sub" style={{ marginBottom: 8 }}>
          Tu cuenta <strong>{email}</strong> entró bien, pero falló la consulta de permisos. No es
          que no tengas acceso: es un problema técnico.
        </p>
        <p className="login__hint" style={{ marginBottom: 22 }}>{errorPerfil}</p>
        <button className="btn btn--primary login__submit" onClick={reintentarPerfil}>
          <RefreshCw size={16} /> Reintentar
        </button>
        <button className="login__guest" onClick={salir}>
          Salir
        </button>
      </div>
    </div>
  );
}

/** Tiene cuenta de Somos Setas pero nadie le dio acceso todavía a esta plataforma */
export function SinAccesoView() {
  const { email, salir } = useAuth();
  return (
    <div className="login">
      <div className="login__card" style={{ textAlign: 'center' }}>
        <ShieldAlert size={38} color="var(--naranja)" style={{ margin: '0 auto 14px' }} />
        <h1 className="login__title">Todavía no tenés acceso</h1>
        <p className="login__sub" style={{ marginBottom: 22 }}>
          Tu cuenta <strong>{email}</strong> existe, pero nadie le dio permiso para entrar al
          control de stock. Pedile a un administrador que te dé de alta.
        </p>
        <button className="btn btn--dark login__submit" onClick={salir}>
          Salir
        </button>
      </div>
    </div>
  );
}
