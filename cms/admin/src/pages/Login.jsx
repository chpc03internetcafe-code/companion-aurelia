// First-run setup, sign-in, forced password change, and the change-password form.
import { useState } from 'react';
import { useAuth } from '../lib/auth';
import { Field } from '../components/kit';

function AuthShell({ children }) {
  const { setup } = useAuth();
  return (
    <div className="auth">
      <div className="auth-art">
        <div className="row"><span className="brand-mark" aria-hidden="true">{(setup?.site?.siteName || 'A')[0]}</span><strong style={{ color: '#fff', fontSize: 18 }}>{setup?.site?.siteName || 'Aurelia Companions'}</strong></div>
        <div>
          <h2>The whole agency, in one place.</h2>
          <ul>
            <li>Booking requests, confirmations and live availability</li>
            <li>Verified profiles with photos, videos, rates and schedules</li>
            <li>Live chat and contact messages from the website</li>
            <li>Location pages, guides, FAQs, SEO and redirects</li>
          </ul>
        </div>
        <small style={{ color: '#9b927f' }}>Staff access only · activity is recorded in the audit trail</small>
      </div>
      <div className="auth-form"><div className="auth-card">{children}</div></div>
    </div>
  );
}

export function LoginScreen() {
  const { login, expired } = useAuth();
  const [form, setForm] = useState({ email: '', password: '', remember: false });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await login(form.email, form.password, form.remember);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  const demo = import.meta.env.DEV;
  return (
    <AuthShell>
      <h1>Staff sign-in</h1>
      <p className="muted">{expired === 'idle' ? 'You were signed out after a period of inactivity. Please sign in again.' : expired ? 'Your session ended. Please sign in again.' : 'Sign in with your staff account.'}</p>
      <form onSubmit={submit}>
        <Field label="Email"><input type="email" autoComplete="username" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required autoFocus /></Field>
        <Field label="Password" error={error}><input type="password" autoComplete="current-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required /></Field>
        <label className="check"><input type="checkbox" checked={form.remember} onChange={(e) => setForm({ ...form, remember: e.target.checked })} /> Keep me signed in for 30 days</label>
        <button className="btn btn-primary btn-lg" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
      </form>
      {demo && (
        <div className="demo-box">
          <strong>Demo accounts</strong> (password <code>aurelia2026</code>):
          <div className="chips" style={{ marginTop: 6 }}>
            {['admin', 'manager', 'bookings', 'profiles', 'content'].map((u) => (
              <button key={u} type="button" className="chip" onClick={() => setForm({ ...form, email: `${u}@aurelia.example`, password: 'aurelia2026' })}>{u}</button>
            ))}
          </div>
        </div>
      )}
    </AuthShell>
  );
}

export function SetupScreen() {
  const { setup, setupFirstAdmin } = useAuth();
  const [form, setForm] = useState({ fullName: '', email: '', password: '', setupKey: '' });
  const [errors, setErrors] = useState({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setErrors({});
    setError('');
    try {
      await setupFirstAdmin(form);
    } catch (err) {
      setErrors(err.details || {});
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  return (
    <AuthShell>
      <h1>Set up the CMS</h1>
      <p className="muted">Create the first administrator account. You can add the rest of the team afterwards under Team → Users.</p>
      <form onSubmit={submit}>
        <Field label="Full name" error={errors.fullName}><input value={form.fullName} onChange={set('fullName')} required autoFocus /></Field>
        <Field label="Email" error={errors.email}><input type="email" value={form.email} onChange={set('email')} required /></Field>
        <Field label="Password" error={errors.password} hint="At least 8 characters"><input type="password" value={form.password} onChange={set('password')} required /></Field>
        {setup?.keyRequired && <Field label="Setup key" error={errors.setupKey} hint="The ADMIN_SETUP_KEY from the hosting environment"><input value={form.setupKey} onChange={set('setupKey')} required /></Field>}
        {error && !Object.keys(errors).length && <p className="error" style={{ color: 'var(--danger)' }}>{error}</p>}
        <button className="btn btn-primary btn-lg" disabled={busy}>{busy ? 'Creating…' : 'Create administrator'}</button>
      </form>
    </AuthShell>
  );
}

export function ChangePasswordForm({ onDone, forced }) {
  const { changePassword } = useAuth();
  const [form, setForm] = useState({ currentPassword: '', newPassword: '', confirm: '' });
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    if (form.newPassword !== form.confirm) return setErrors({ confirm: 'The passwords don’t match.' });
    setBusy(true);
    setErrors({});
    try {
      await changePassword(form.currentPassword, form.newPassword);
      onDone?.();
    } catch (err) {
      setErrors({ ...(err.details || {}), ...(Object.keys(err.details || {}).length ? {} : { newPassword: err.message }) });
    } finally {
      setBusy(false);
    }
  };
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  return (
    <form onSubmit={submit} className="stack">
      <Field label={forced ? 'Temporary password' : 'Current password'} error={errors.currentPassword}><input type="password" autoComplete="current-password" value={form.currentPassword} onChange={set('currentPassword')} required autoFocus /></Field>
      <Field label="New password" error={errors.newPassword} hint="At least 8 characters"><input type="password" autoComplete="new-password" value={form.newPassword} onChange={set('newPassword')} required /></Field>
      <Field label="Confirm new password" error={errors.confirm}><input type="password" autoComplete="new-password" value={form.confirm} onChange={set('confirm')} required /></Field>
      <button className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Change password'}</button>
    </form>
  );
}

export function ForcePasswordScreen() {
  const { logout, user } = useAuth();
  return (
    <AuthShell>
      <h1>Choose a new password</h1>
      <p className="muted">Hi {user.name.split(' ')[0]}, you signed in with a temporary password. Please choose your own to continue.</p>
      <div style={{ marginTop: 16 }}><ChangePasswordForm forced /></div>
      <button className="link" style={{ marginTop: 14 }} onClick={logout}>Sign out</button>
    </AuthShell>
  );
}
