import { useState } from 'react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useUi } from '../lib/ui';
import { dateTime } from '../lib/format';
import { Avatar, ErrorBox, Field, Loading, Modal, PageHead, Pill, Toggle, useAction, useForm, useLoad } from '../components/kit';

const tempPassword = () => `Aurelia-${Math.random().toString(36).slice(2, 6)}${Math.floor(1000 + Math.random() * 9000)}`;

function UserModal({ user, roles, onClose, onSaved }) {
  const { form, set, setForm, errors, saving, submit } = useForm(user ? { ...user } : { fullName: '', email: '', roleId: roles.find((r) => !r.isSystem)?.id || '', status: 'Active', password: tempPassword() });
  const body = (f) => f;
  const save = () => submit(async (f) => onSaved(await (user ? api.put(`/admin/users/${user.id}`, body(f)) : api.post('/admin/users', body(f)))), user ? 'User updated' : 'User added');
  return (
    <Modal title={user ? `Edit ${user.fullName}` : 'Add staff user'} onClose={onClose} footer={<><button className="btn btn-ghost" onClick={onClose}>Cancel</button><button className="btn btn-primary" onClick={save} disabled={saving}>Save</button></>}>
      <div className="form-grid">
        <Field label="Full name" error={errors.fullName} required><input value={form.fullName} onChange={set('fullName')} autoFocus /></Field>
        <Field label="Email (sign-in)" error={errors.email} required><input type="email" value={form.email} onChange={set('email')} /></Field>
        <Field label="Role" error={errors.roleId} required><select value={form.roleId} onChange={set('roleId')}>{roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></Field>
        {!user && <Field label="Temporary password" error={errors.password} hint="They’ll choose their own at first sign-in" className="span-2"><input value={form.password} onChange={set('password')} className="mono" /></Field>}
        {user && <div className="span-2"><Toggle checked={form.status === 'Active'} onChange={(v) => setForm({ ...form, status: v ? 'Active' : 'Disabled' })} label="Active" hint="Disabled users are signed out and can’t sign in" /></div>}
      </div>
    </Modal>
  );
}

export default function Users() {
  const { user: me, can } = useAuth();
  const { confirm, prompt, toast } = useUi();
  const manage = can('users', 'manage');
  const users = useLoad(() => api.get('/admin/users'), []);
  const roles = useLoad(() => api.get('/admin/roles'), []);
  const [modal, setModal] = useState(null);
  const [run] = useAction();
  if ((users.loading && !users.data) || (roles.loading && !roles.data)) return <Loading />;
  if (users.error || roles.error) return <ErrorBox error={users.error || roles.error} />;

  const reset = async (u) => {
    const pw = await prompt({ title: `Reset ${u.fullName}’s password?`, message: 'They’ll be signed out everywhere and must choose a new password at next sign-in. Share this temporary password with them securely.', label: 'Temporary password', defaultValue: tempPassword(), required: true, confirmLabel: 'Reset password' });
    if (pw && await run(() => api.post(`/admin/users/${u.id}/password`, { password: pw }))) toast(`Password reset. Temporary password: ${pw}`);
  };
  const remove = async (u) => {
    if (await confirm({ title: `Delete ${u.fullName}?`, message: 'Their audit history is kept. Consider disabling instead.', danger: true, confirmLabel: 'Delete' }) && await run(() => api.del(`/admin/users/${u.id}`), 'User deleted')) users.reload(true);
  };

  return (
    <>
      <PageHead title="Users" subtitle="Staff who can sign in to the CMS. What each person can do comes from their role."
        actions={manage && <button className="btn btn-primary" onClick={() => setModal({})}>+ Add user</button>} />
      <div className="card">
        <table className="table">
          <thead><tr><th>Name</th><th>Role</th><th className="hide-sm">Last sign-in</th><th>Status</th>{manage && <th />}</tr></thead>
          <tbody>{users.data.map((u) => (
            <tr key={u.id}>
              <td><div className="row" style={{ flexWrap: 'nowrap' }}><Avatar name={u.fullName} size={34} /><div><strong>{u.fullName}</strong>{u.id === me.id && <> <Pill tone="teal">You</Pill></>}<span className="sub">{u.email}</span></div></div></td>
              <td>{u.roleName}</td>
              <td className="hide-sm">{u.lastLoginAt ? dateTime(u.lastLoginAt) : <span className="muted">Never</span>}{u.mustChangePassword && <span className="sub">Temporary password</span>}</td>
              <td><Pill>{u.status}</Pill></td>
              {manage && <td className="actions">
                <button className="btn btn-sm btn-ghost" onClick={() => setModal(u)}>Edit</button>{' '}
                {u.id !== me.id && <><button className="btn btn-sm btn-ghost" onClick={() => reset(u)}>Reset password</button>{' '}<button className="btn btn-sm btn-danger-ghost" onClick={() => remove(u)}>Delete</button></>}
              </td>}
            </tr>
          ))}</tbody>
        </table>
      </div>
      {modal && <UserModal user={modal.id ? modal : null} roles={roles.data.roles} onClose={() => setModal(null)} onSaved={() => { setModal(null); users.reload(true); }} />}
    </>
  );
}
