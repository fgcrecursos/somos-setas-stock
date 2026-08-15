// =====================================================================
// USUARIOS — quién entra a la plataforma y con qué permisos.
//   Acceso total  → carga, edita, vende, produce y ajusta.
//   Solo lectura  → mira el inventario y el historial, no toca nada.
// Dar de alta crea la cuenta de acceso (email + contraseña) y el permiso.
// =====================================================================
import { AlertTriangle, Eye, KeyRound, Pencil, ShieldCheck, Trash2, UserPlus, Users } from 'lucide-react';
import { useState } from 'react';
import { Modal } from '../components/Modal';
import { useToast } from '../components/Toast';
import { useAuth } from '../lib/auth';
import { formatFecha } from '../lib/helpers';
import type { Rol, UsuarioStock } from '../lib/types';

const ROL_LABEL: Record<Rol, string> = {
  admin: 'Acceso total',
  invitado: 'Solo lectura',
};

export function UsuariosView() {
  const {
    usuarios,
    email: yo,
    crearUsuario,
    actualizarUsuario,
    eliminarUsuario,
    enviarLinkPassword,
  } = useAuth();
  const toast = useToast();
  const [nuevo, setNuevo] = useState(false);
  const [editar, setEditar] = useState<UsuarioStock | null>(null);

  async function mandarLink(u: UsuarioStock) {
    const res = await enviarLinkPassword(u.email);
    toast(
      res.error ?? `Le mandamos un mail a ${u.email} para que ponga su contraseña`,
      !!res.error
    );
  }

  async function cambiarRol(u: UsuarioStock, rol: Rol) {
    const res = await actualizarUsuario(u.email, { rol });
    toast(res.error ?? `${u.nombre || u.email} ahora es ${ROL_LABEL[rol].toLowerCase()}`, !!res.error);
  }

  async function alternarActivo(u: UsuarioStock) {
    const res = await actualizarUsuario(u.email, { activo: !u.activo });
    toast(
      res.error ?? (u.activo ? `Se le quitó el acceso a ${u.email}` : `${u.email} vuelve a tener acceso`),
      !!res.error
    );
  }

  async function borrar(u: UsuarioStock) {
    if (!confirm(`¿Quitarle el acceso al stock a ${u.email}?\n\nSu cuenta de Somos Setas sigue existiendo, pero deja de poder entrar acá.`))
      return;
    const res = await eliminarUsuario(u.email);
    toast(res.error ?? `${u.email} ya no tiene acceso`, !!res.error);
  }

  return (
    <div className="stack">
      <div className="toolbar">
        <span className="muted" style={{ fontSize: 12.5 }}>
          {usuarios.length} {usuarios.length === 1 ? 'persona con acceso' : 'personas con acceso'}
        </span>
        <div className="toolbar__spacer" />
        <button className="btn btn--primary" onClick={() => setNuevo(true)}>
          <UserPlus size={16} /> Dar de alta
        </button>
      </div>

      <div className="card">
        <div className="card__head">
          <Users size={18} />
          <h3>Usuarios de la plataforma</h3>
        </div>
        <div className="table-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th className="no-sort">Nombre</th>
                <th className="no-sort">Email</th>
                <th className="no-sort">Permiso</th>
                <th className="no-sort">Estado</th>
                <th className="no-sort">Alta</th>
                <th className="no-sort" />
              </tr>
            </thead>
            <tbody>
              {usuarios.map((u) => {
                const soyYo = u.email === yo;
                return (
                  <tr key={u.email} style={{ opacity: u.activo ? 1 : 0.55 }}>
                    <td className="nombre">
                      {u.nombre || '—'}
                      {soyYo && <span className="pill" style={{ marginLeft: 8 }}>vos</span>}
                    </td>
                    <td className="muted">{u.email}</td>
                    <td>
                      {soyYo ? (
                        // No se puede cambiar el permiso propio: sería quedarse afuera.
                        <span
                          className="pill"
                          style={{ background: 'var(--naranja-100)', color: 'var(--naranja-600)', borderColor: 'transparent' }}
                        >
                          {u.rol === 'admin' ? <ShieldCheck size={12} /> : <Eye size={12} />}
                          {ROL_LABEL[u.rol]}
                        </span>
                      ) : (
                        <select
                          className="select"
                          style={{ padding: '5px 8px', fontSize: 12.5, minWidth: 140 }}
                          value={u.rol}
                          onChange={(e) => cambiarRol(u, e.target.value as Rol)}
                        >
                          <option value="admin">{ROL_LABEL.admin}</option>
                          <option value="invitado">{ROL_LABEL.invitado}</option>
                        </select>
                      )}
                    </td>
                    <td>
                      {u.activo ? (
                        <span className="badge-estado st-ok">Activo</span>
                      ) : (
                        <span className="badge-estado st-agotado">Sin acceso</span>
                      )}
                    </td>
                    <td className="muted" style={{ fontSize: 12 }}>{formatFecha(u.created_at)}</td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <button className="btn btn--sm" onClick={() => setEditar(u)}>
                        <Pencil size={13} /> Editar
                      </button>{' '}
                      <button
                        className="btn btn--sm"
                        title="Le manda un mail con un link para que ponga su propia contraseña"
                        onClick={() => mandarLink(u)}
                      >
                        <KeyRound size={13} /> Contraseña
                      </button>{' '}
                      <button
                        className="btn btn--sm"
                        disabled={soyYo}
                        title={soyYo ? 'No podés quitarte el acceso a vos mismo' : ''}
                        onClick={() => alternarActivo(u)}
                      >
                        {u.activo ? 'Suspender' : 'Reactivar'}
                      </button>{' '}
                      <button
                        className="btn btn--sm"
                        disabled={soyYo}
                        title={soyYo ? 'No podés eliminarte a vos mismo' : ''}
                        onClick={() => borrar(u)}
                      >
                        <Trash2 size={13} />
                      </button>
                    </td>
                  </tr>
                );
              })}
              {usuarios.length === 0 && (
                <tr>
                  <td colSpan={6}>
                    <div className="empty">
                      <Users size={30} />
                      <p>Todavía no hay nadie cargado.</p>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <p className="hlp">
        El acceso usa la misma cuenta que el panel de la tienda: si la persona ya entra a
        somossetas.com.ar, entra acá con el mismo email y contraseña.
      </p>

      {nuevo && (
        <FormUsuario
          onClose={() => setNuevo(false)}
          onGuardar={crearUsuario}
        />
      )}
      {editar && (
        <FormUsuario
          usuario={editar}
          onClose={() => setEditar(null)}
          onGuardar={async ({ nombre, rol }) => {
            const res = await actualizarUsuario(editar.email, { nombre, rol });
            return res;
          }}
        />
      )}
    </div>
  );
}

function FormUsuario({
  usuario,
  onClose,
  onGuardar,
}: {
  usuario?: UsuarioStock;
  onClose: () => void;
  onGuardar: (u: { email: string; password: string; nombre: string; rol: Rol }) => Promise<{
    ok?: boolean;
    error?: string;
    cuentaExistente?: boolean;
  }>;
}) {
  const editando = !!usuario;
  const toast = useToast();
  const { enviarLinkPassword } = useAuth();
  const [email, setEmail] = useState(usuario?.email ?? '');
  const [nombre, setNombre] = useState(usuario?.nombre ?? '');
  const [password, setPassword] = useState('');
  const [rol, setRol] = useState<Rol>(usuario?.rol ?? 'invitado');
  const [error, setError] = useState('');
  const [guardando, setGuardando] = useState(false);
  // La cuenta ya existía: el permiso quedó dado, pero la contraseña tipeada acá
  // no sirve. Esto NO se avisa con un toast que se va solo: se traba el modal
  // hasta que quien da el alta lo lee, porque si no la persona no puede entrar.
  const [yaExistia, setYaExistia] = useState(false);
  const [linkMandado, setLinkMandado] = useState(false);

  async function guardar() {
    setError('');
    if (!editando && !email.trim()) return setError('Falta el email.');
    if (!editando && password.length < 6)
      return setError('La contraseña tiene que tener al menos 6 caracteres.');
    setGuardando(true);
    const res = await onGuardar({ email, password, nombre, rol });
    setGuardando(false);
    if (res.error) return setError(res.error);
    if (res.cuentaExistente) return setYaExistia(true);
    toast(editando ? 'Usuario actualizado' : `${email} ya puede entrar`);
    onClose();
  }

  async function mandarLink() {
    setGuardando(true);
    const res = await enviarLinkPassword(email);
    setGuardando(false);
    if (res.error) return setError(res.error);
    setLinkMandado(true);
  }

  if (yaExistia) {
    const mail = email.trim().toLowerCase();
    return (
      <Modal
        title="Ya tenía cuenta de Somos Setas"
        icon={<AlertTriangle size={20} color="var(--naranja)" />}
        onClose={onClose}
        footer={
          <>
            <button className="btn" onClick={onClose}>Cerrar</button>
            <button className="btn btn--primary" onClick={mandarLink} disabled={guardando || linkMandado}>
              <KeyRound size={15} />
              {guardando ? 'Enviando…' : linkMandado ? 'Link enviado' : 'Mandarle un link para su contraseña'}
            </button>
          </>
        }
      >
        <p style={{ marginTop: 0 }}>
          <strong>{mail}</strong> ya tenía una cuenta de Somos Setas, así que el acceso al stock
          quedó dado y ya aparece en la lista.
        </p>
        <div
          className="badge-estado st-agotado"
          style={{ display: 'block', padding: '12px 14px', borderRadius: 10, margin: '14px 0', lineHeight: 1.5 }}
        >
          Ojo: la contraseña que escribiste acá <strong>no se aplicó</strong>. Esta persona sigue
          entrando con la contraseña que ya usaba. Si le pasás la que acabás de tipear, le va a decir
          “email o contraseña incorrectos”.
        </div>
        <p className="hlp" style={{ marginBottom: 0 }}>
          {linkMandado
            ? `Listo: le mandamos un mail a ${mail} con un link para que ponga la contraseña que quiera. Decile que revise el correo no deseado.`
            : 'Si no se acuerda de su contraseña, mandale el link y la define ella misma. También puede hacerlo sola desde “Olvidé mi contraseña” en la pantalla de ingreso.'}
        </p>
      </Modal>
    );
  }

  return (
    <Modal
      title={editando ? `Editar ${usuario!.email}` : 'Dar de alta un usuario'}
      icon={<UserPlus size={20} color="var(--naranja)" />}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancelar</button>
          <button className="btn btn--primary" onClick={guardar} disabled={guardando}>
            {guardando ? 'Guardando…' : editando ? 'Guardar' : 'Crear acceso'}
          </button>
        </>
      }
    >
      <div className="form-row">
        <div className="field">
          <label>Nombre</label>
          <input className="input" value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Ej. Mayra Santi" />
        </div>
        <div className="field">
          <label>Email {editando && '(no se puede cambiar)'}</label>
          <input
            className="input"
            type="email"
            value={email}
            disabled={editando}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="nombre@somossetas.com.ar"
          />
        </div>
      </div>

      {!editando && (
        <div className="field">
          <label>Contraseña inicial (mínimo 6 caracteres)</label>
          <input
            className="input"
            type="text"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Se la pasás por privado; después puede cambiarla"
          />
          <p className="hlp">
            Sirve solo si la persona <strong>no</strong> tenía cuenta de Somos Setas. Si ya tenía
            (por ejemplo, porque compró en la tienda), sigue entrando con la suya y esta no se
            aplica: te lo vamos a avisar al guardar.
          </p>
        </div>
      )}

      <div className="field">
        <label>Permiso</label>
        <select className="select" value={rol} onChange={(e) => setRol(e.target.value as Rol)}>
          <option value="admin">Acceso total — carga, edita, vende y ajusta</option>
          <option value="invitado">Solo lectura — mira pero no modifica nada</option>
        </select>
      </div>

      {error && (
        <div className="badge-estado st-agotado" style={{ marginTop: 12, padding: '9px 12px', borderRadius: 10 }}>
          {error}
        </div>
      )}
    </Modal>
  );
}
