import { BrowserMultiFormatReader } from '@zxing/library';
import { Camera, CameraOff, Keyboard, ScanLine } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

interface Props {
  onDetected: (code: string) => void;
}

/** Escáner de códigos de barras / QR usando la cámara del dispositivo. */
export function BarcodeScanner({ onDetected }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const readerRef = useRef<BrowserMultiFormatReader | null>(null);
  const lastRef = useRef<{ code: string; t: number }>({ code: '', t: 0 });
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState<string | undefined>(undefined);
  const [active, setActive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [manual, setManual] = useState('');

  useEffect(() => {
    const reader = new BrowserMultiFormatReader(undefined, 300);
    readerRef.current = reader;
    return () => reader.reset();
  }, []);

  async function start(id?: string) {
    setError(null);
    const reader = readerRef.current;
    if (!reader || !videoRef.current) return;
    try {
      const list = await reader.listVideoInputDevices();
      setDevices(list);
      let chosen = id ?? deviceId;
      if (!chosen && list.length) {
        const rear = list.find((d) =>
          /back|rear|trase|environment/i.test(d.label)
        );
        chosen = (rear ?? list[list.length - 1]).deviceId;
      }
      setDeviceId(chosen);
      await reader.decodeFromVideoDevice(chosen ?? null, videoRef.current, (result) => {
        if (!result) return;
        const code = result.getText().trim();
        const now = Date.now();
        if (code === lastRef.current.code && now - lastRef.current.t < 1800) return;
        lastRef.current = { code, t: now };
        if (navigator.vibrate) navigator.vibrate(60);
        onDetected(code);
      });
      setActive(true);
    } catch (e: any) {
      setError(
        e?.name === 'NotAllowedError'
          ? 'Permiso de cámara denegado. Podés cargar el código manualmente.'
          : 'No se pudo iniciar la cámara. Usá el ingreso manual.'
      );
      setActive(false);
    }
  }

  function stop() {
    readerRef.current?.reset();
    setActive(false);
  }

  return (
    <div className="stack">
      <div className="scanner">
        <video ref={videoRef} muted playsInline />
        {active && (
          <>
            <div className="scanner__frame" />
            <div className="scanner__laser" />
            <div className="scanner__hint">Apuntá al código de barras o QR</div>
          </>
        )}
        {!active && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'grid',
              placeItems: 'center',
              color: '#cdd2c6',
              textAlign: 'center',
              padding: 20,
            }}
          >
            <div>
              <ScanLine size={40} style={{ opacity: 0.6 }} />
              <p style={{ fontSize: 13, marginTop: 8 }}>Cámara detenida</p>
            </div>
          </div>
        )}
      </div>

      {error && (
        <div className="badge-estado st-agotado" style={{ borderRadius: 10, padding: '8px 12px' }}>
          {error}
        </div>
      )}

      <div className="row wrap">
        {!active ? (
          <button className="btn btn--dark" onClick={() => start()}>
            <Camera size={16} /> Iniciar cámara
          </button>
        ) : (
          <button className="btn" onClick={stop}>
            <CameraOff size={16} /> Detener
          </button>
        )}
        {devices.length > 1 && (
          <select
            className="select"
            style={{ maxWidth: 200 }}
            value={deviceId}
            onChange={(e) => {
              setDeviceId(e.target.value);
              if (active) start(e.target.value);
            }}
          >
            {devices.map((d) => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label || 'Cámara'}
              </option>
            ))}
          </select>
        )}
      </div>

      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          const v = manual.trim();
          if (v) {
            onDetected(v);
            setManual('');
          }
        }}
      >
        <div className="searchbox" style={{ flex: 1 }}>
          <Keyboard size={16} />
          <input
            className="input"
            placeholder="Código o nombre (ej. ACE-06 o melena)"
            value={manual}
            onChange={(e) => setManual(e.target.value)}
          />
        </div>
        <button className="btn btn--primary" type="submit">
          Cargar
        </button>
      </form>
    </div>
  );
}
