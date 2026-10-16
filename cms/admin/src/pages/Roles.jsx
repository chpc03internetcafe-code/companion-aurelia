import { useState } from 'react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useUi } from '../lib/ui';
import { ErrorBox, Field, Loading, Modal, PageHead, Pill, useAction, useForm, useLoad } from '../components/kit';

const LEVEL_LABEL = { none: 'No access', view: 'View', manage: 'Manage' };

function RoleModal({ role, modules, levels, onClose, onSaved }) {
  const { form, set, setForm, errors, saving, submit } = useForm(role
    ? { name: role.name, description: role.description || '', permissions: role.permissions }
    : { name: '', description: '', permissions: Object.fromEntries(modules.map((m) => [m.key, 'none'])) });
  const locked = role?.isSystem;
  const save = () => submit(async (f) => onSaved(await (role ? api.put(`/admin/roles/${role.id}`, f) : api.post('/admin/roles', f))), 'Role saved');
  return (
    <Modal title={role ? `Edit role: ${role.name}` : 'New role'} onClose={onClose} size="wide" footer={<><button className="btn btn-ghost" onClick={onClose}>Cancel</button><button className="btn btn-primary" onClick={save} disabled={saving}>Save</button></>}>
      <div className="stack">
        <div className="form-grid">
          <Field label="Role name" error={errors.name} required><input value={form.name} onChange={set('name')} disabled={locked} /></Field>
          <Field label="Description"><input value={form.description} onChange={set('description')} /></Field>
        </div>
        {locked ? <div className="banner-info">The Administrator role always has full access to every section.</div> : (
          <table className="table compact">
            <thead><tr><th>Section</th>{levels.map((l) => <th key={l} style={{ textAlign: 'center' }}>{LEVEL_LABEL[l]}</th>)}</tr></thead>
            <tbody>{modules.map((m) => (
              <tr key={m.key}>
                <td>{m.label}</td>
                {levels.map((l) => (
                  <td key={l} style={{ textAlign: 'center' }}>
                    <input type="radio" name={`perm-${m.key}`} checked={form.permissions[m.key] === l} onChange={() => setForm({ ...form, permissions: { ...form.permissions, [m.key]: l } })} aria-label={`${m.label}: ${LEVEL_LABEL[l]}`} />
                  </td>
                ))}
              </tr>
            ))}</tbody>
          </table>
        )}
      </div>
    </Modal>
  );
}

export default function Roles() {
  const { user } = useAuth();
  const { confirm } = useUi();
  const { data, loading, error, reload } = useLoad(() => api.get('/admin/roles'), []);
  const [modal, setModal] = useState(null);
  const [run] = useAction();
  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  const admin = user.isAdministrator;
  return (
    <>
      <PageHead title="Roles" subtitle="Each role gives every CMS section No access, View or Manage. Changes apply immediately."
        actions={admin && <button className="btn btn-primary" onClick={() => setModal({})}>+ New role</button>} />
      {!admin && <div className="banner-info">Only administrators can create or change roles.</div>}
      <div className="card table-wrap">
        <table className="table compact">
          <thead><tr><th>Section</th>{data.roles.map((r) => <th key={r.id} style={{ textAlign: 'center' }}>{r.name}<span className="sub" style={{ textTransform: 'none', letterSpacing: 0 }}>{r.userCount} user(s)</span></th>)}</tr></thead>
          <tbody>
            {data.modules.map((m) => (
              <tr key={m.key}>
                <td className="strong">{m.label}</td>
                {data.roles.map((r) => {
                  const l = r.permissions[m.key];
                  return <td key={r.id} style={{ textAlign: 'center' }}>{l === 'manage' ? <Pill tone="green">Manage</Pill> : l === 'view' ? <Pill tone="blue">View</Pill> : <span className="muted">—</span>}</td>;
                })}
              </tr>
            ))}
            {admin && (
              <tr>
                <td />
                {data.roles.map((r) => (
                  <td key={r.id} style={{ textAlign: 'center' }} className="nowrap">
                    <button className="btn btn-sm btn-ghost" onClick={() => setModal(r)}>Edit</button>{' '}
                    {!r.isSystem && <button className="btn btn-sm btn-danger-ghost" onClick={async () => { if (await confirm({ title: `Delete the ${r.name} role?`, danger: true, confirmLabel: 'Delete' }) && await run(() => api.del(`/admin/roles/${r.id}`), 'Role deleted')) reload(true); }}>Delete</button>}
                  </td>
                ))}
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="grid-3" style={{ marginTop: 16 }}>
        {data.roles.map((r) => <div key={r.id} className="card card-pad"><strong>{r.name}</strong><p className="muted" style={{ margin: '4px 0 0' }}>{r.description}</p></div>)}
      </div>
      {modal && <RoleModal role={modal.id ? modal : null} modules={data.modules} levels={data.levels} onClose={() => setModal(null)} onSaved={() => { setModal(null); reload(true); }} />}
    </>
  );
}
