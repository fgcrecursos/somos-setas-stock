import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import {
  createContext,
  useContext,
  useState,
  type ReactNode,
} from 'react';

interface ToastItem {
  id: number;
  msg: string;
  warn?: boolean;
}

const ToastCtx = createContext<(msg: string, warn?: boolean) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);

  const push = (msg: string, warn?: boolean) => {
    const id = Date.now() + Math.random();
    setItems((s) => [...s, { id, msg, warn }]);
    setTimeout(() => setItems((s) => s.filter((t) => t.id !== id)), 4200);
  };

  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toast-wrap">
        {items.map((t) => (
          <div key={t.id} className={'toast' + (t.warn ? ' toast--warn' : '')}>
            {t.warn ? <AlertTriangle size={18} /> : <CheckCircle2 size={18} />}
            <span>{t.msg}</span>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export function useToast() {
  return useContext(ToastCtx);
}
