import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/montserrat/400.css';
import '@fontsource/montserrat/500.css';
import '@fontsource/montserrat/600.css';
import '@fontsource/montserrat/700.css';
import '@fontsource/oswald/500.css';
import '@fontsource/oswald/600.css';
import './styles.css';
import App from './App.tsx';
import { AuthProvider, useAuth } from './lib/auth';
import { StoreProvider } from './lib/store';
import { ToastProvider } from './components/Toast';
import { LoginView, SinAccesoView } from './views/LoginView';

/** Decide qué mostrar según la sesión: login, aviso de sin acceso, o la app. */
function Raiz() {
  const { cargando, session, sinAcceso } = useAuth();

  if (cargando) {
    return (
      <div className="login">
        <div className="login__card" style={{ textAlign: 'center' }}>
          <img src="/brand/logo-vertical.png" alt="Somos Setas" className="login__logo" />
          <p className="login__sub">Cargando…</p>
        </div>
      </div>
    );
  }
  if (!session) return <LoginView />;
  if (sinAcceso) return <SinAccesoView />;

  return (
    <StoreProvider>
      <App />
    </StoreProvider>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthProvider>
      <ToastProvider>
        <Raiz />
      </ToastProvider>
    </AuthProvider>
  </StrictMode>
);
