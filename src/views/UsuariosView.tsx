// =====================================================================
// USUARIOS — quién entra a la plataforma y con qué permisos.
//   Acceso total  → carga, edita, vende, produce y ajusta.
//   Solo lectura  → mira el inventario y el historial, no toca nada.
// Dar de alta crea la cuenta de acceso (email + contraseña) y el permiso.
// =====================================================================
import { Eye, Pencil, ShieldCheck, Trash2, UserPlus, Users } from 'lucide-react';
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
  const { usuarios, email: yo, crearUsuario, actualizarUsuario, eliminarUsuario } = useAuth();
  const toast = useToast();
  const [nuevo, setNuevo] = useState(false);
  const [editar, setEditar] = useState<UsuarioStock | null>(null);

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
    aviso?: string;
  }>;
}) {
  const editando = !!usuario;
  const toast = useToast();
  const [email, setEmail] = useState(usuario?.email ?? '');
  const [nombre, setNombre] = useState(usuario?.nombre ?? '');
  const [password, setPassword] = useState('');
  const [rol, setRol] = useState<Rol>(usuario?.rol ?? 'invitado');
  const [error, setError] = useState('');
  const [guardando, setGuardando] = useState(false);

  async function guardar() {
    setError('');
    if (!editando && !email.trim()) return setError('Falta el email.');
    if (!editando && password.length < 6)
      return setError('La contraseña tiene que tener al menos 6 caracteres.');
    setGuardando(true);
    const res = await onGuardar({ email, password, nombre, rol });
    setGuardando(false);
    if (res.error) return setError(res.error);
    if (res.aviso) toast(res.aviso);
    else toast(editando ? 'Usuario actualizado' : `${email} ya puede entrar`);
    onClose();
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
            Si la persona ya tenía cuenta de Somos Setas, se mantiene su contraseña actual y solo se
            le suma el acceso al stock.
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
