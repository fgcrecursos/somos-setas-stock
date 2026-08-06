import { Eye, EyeOff, LogIn, ShieldAlert } from 'lucide-react';
import { useState } from 'react';
import { useAuth } from '../lib/auth';

const EMAIL_INVITADO = 'invitado@somossetas.com.ar';

export function LoginView() {
  const { entrar } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [verPass, setVerPass] = useState(false);
  const [error, setError] = useState('');
  const [entrando, setEntrando] = useState(false);

  async function submit(ev: React.FormEvent) {
    ev.preventDefault();
    if (!email.trim() || !password) {
      setError('Completá el email y la contraseña.');
      return;
    }
    setError('');
    setEntrando(true);
    const res = await entrar(email, password);
    setEntrando(false);
    if (res.error) setError(res.error);
  }

  return (
    <div className="login">
      <form className="login__card" onSubmit={submit}>
        <img src="/brand/logo-vertical.png" alt="Somos Setas" className="login__logo" />
        <h1 className="login__title">Control de Stock</h1>
        <p className="login__sub">Ingresá con tu cuenta de Somos Setas.</p>

        <div className="field">
          <label>Email</label>
          <input
            className="input"
            type="email"
            autoComplete="username"
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
              autoComplete="current-password"
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

        <button className="btn btn--primary login__submit" type="submit" disabled={entrando}>
          <LogIn size={16} /> {entrando ? 'Entrando…' : 'Entrar'}
        </button>

        <button
          type="button"
          className="login__guest"
          onClick={() => {
            setEmail(EMAIL_INVITADO);
            setError('');
          }}
        >
          Solo quiero mirar → entrar como invitado
        </button>
        <p className="login__hint">
          La cuenta de invitado ve todo el inventario y el historial, pero no puede modificar nada.
          Pedile la contraseña a un administrador.
        </p>
      </form>
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
