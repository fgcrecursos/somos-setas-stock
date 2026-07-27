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
import { StoreProvider } from './lib/store';
import { ToastProvider } from './components/Toast';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <StoreProvider>
      <ToastProvider>
        <App />
      </ToastProvider>
    </StoreProvider>
  </StrictMode>
);
