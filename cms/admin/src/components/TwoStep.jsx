// Two-step sign-in for the signed-in staff member: set up an authenticator app (Google Authenticator, Microsoft
// Authenticator, Authy, 1Password…), replace backup codes, or turn it off. Also used on the forced setup screen,
// which sits outside UiProvider, so messages are shown inline rather than as toasts.
import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { day, plural } from '../lib/format';
import { Field, Loading, Pill } from './kit';

export const cleanCode = (v) => v.replace(/[^0-9A-Za-z-]/g, '').slice(0, 9);

export function BackupCodes({ codes, onDone }) {
  const [copied, setCopied] = useState('');
  const textFile = `CMS two-step backup codes — each works once\n\n${codes.join('\n')}\n`;
  const copy = async () => {
    try { await navigator.clipboard.writeText(codes.join('\n')); setCopied('Copied'); } catch { setCopied('Copy failed — select the codes instead'); }
  };
  return (
    <div className="stack">
      <div className="banner-info">Save these backup codes somewhere safe, like a password manager. If you lose your phone, each one lets you sign in once. They won’t be shown again.</div>
      <ol className="backup-codes">{codes.map((c) => <li key={c}>{c}</li>)}</ol>
      <div className="row">
        <button type="button" className="btn btn-ghost btn-sm" onClick={copy}>Copy</button>
        <a className="btn btn-ghost btn-sm" href={`data:text/plain;charset=utf-8,${encodeURIComponent(textFile)}`} download="cms-backup-codes.txt">Download .txt</a>
        {copied && <small className="muted">{copied}</small>}
        <span style={{ flex: 1 }} />
        <button type="button" className="btn btn-primary btn-sm" onClick={onDone}>I’ve saved them</button>
      </div>
    </div>
  );
}

export function TwoStepPanel({ forced = false, onDone }) {
  const { updateUser } = useAuth();
  const [status, setStatus] = useState(null);
  const [step, setStep] = useState(forced ? 'password' : null); // null | 'password' | 'scan' | 'codes' | 'regen' | 'disable'
  const [setup, setSetup] = useState(null);
  const [form, setForm] = useState({ password: '', code: '', signOutOthers: true });
  const [codes, setCodes] = useState(null);
  const [errors, setErrors] = useState({});
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [newUser, setNewUser] = useState(null);
  useEffect(() => { api.get('/admin/auth/2fa').then(setStatus).catch(() => setStatus({ enabled: false })); }, []);

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const close = () => { setStep(null); setSetup(null); setCodes(null); setErrors({}); setForm({ password: '', code: '', signOutOthers: true }); };
  const go = (fn) => async (e) => {
    e.preventDefault();
    setBusy(true);
    setErrors({});
    setNotice('');
    try { await fn(); } catch (err) { setErrors({ ...err.details, _: err.message }); } finally { setBusy(false); }
  };
  const start = go(async () => { setSetup(await api.post('/admin/auth/2fa/setup', { password: form.password })); setStep('scan'); });
  const enable = go(async () => {
    const r = await api.post('/admin/auth/2fa/enable', { code: form.code, signOutOthers: form.signOutOthers });
    setStatus(r);
    setCodes(r.backupCodes);
    setNewUser(r.user); // applied once the codes are saved, so the forced screen doesn't close before that
    setStep('codes');
  });
  const regen = go(async () => { const r = await api.post('/admin/auth/2fa/backup-codes', { password: form.password }); setStatus(r); setCodes(r.backupCodes); setStep('codes'); });
  const disable = go(async () => {
    const r = await api.post('/admin/auth/2fa/disable', { password: form.password, code: form.code });
    setStatus(r);
    updateUser(r.user);
    close();
    setNotice('Two-step sign-in is off.');
  });
  const codesSaved = () => {
    close();
    if (newUser) { updateUser(newUser); setNewUser(null); setNotice('Two-step sign-in is on.'); }
    onDone?.();
  };

  if (!status) return <Loading rows={3} />;
  const pwField = <Field label="Current password" error={errors.password}><input type="password" autoComplete="current-password" value={form.password} onChange={set('password')} required autoFocus /></Field>;
  const otherError = errors._ && !errors.password && !errors.code && <div className="banner-error">{errors._}</div>;
  const cancel = !forced && <button type="button" className="btn btn-ghost" onClick={close}>Cancel</button>;
  return (
    <div className="stack">
      {!forced && (
        <>
          <div className="row between">
            <strong>Authenticator app</strong>
            <Pill tone={status.enabled ? 'green' : 'grey'}>{status.enabled ? 'On' : 'Off'}</Pill>
          </div>
          <p className="muted" style={{ margin: 0 }}>
            {status.enabled
              ? <>Signing in needs your password and a 6-digit code from your authenticator app. On since {day(status.enabledAt)} · {plural(status.backupCodesLeft, 'backup code')} left.</>
              : <>Protect your account with a 6-digit code from an authenticator app such as Google Authenticator, Microsoft Authenticator or Authy, so a stolen password isn’t enough to sign in.</>}
          </p>
        </>
      )}
      {notice && !step && <div className="banner-info">{notice}</div>}
      {status.enabled && status.backupCodesLeft <= 2 && !step && <div className="banner-info">You’re running out of backup codes. Create new ones so you can still sign in if you lose your phone.</div>}
      {!step && !forced && (
        <div className="row">
          {status.enabled
            ? <><button className="btn btn-ghost" onClick={() => setStep('regen')}>New backup codes</button>
              {!status.required && <button className="btn btn-danger-ghost" onClick={() => setStep('disable')}>Turn off</button>}</>
            : <button className="btn btn-primary" onClick={() => setStep('password')}>Set up authenticator app</button>}
        </div>
      )}
      {status.enabled && status.required && !step && !forced && <small className="muted">Two-step sign-in is required for all staff, so it can’t be turned off.</small>}

      {step === 'password' && (
        <form className="stack" onSubmit={start}>
          <p style={{ margin: 0 }}>First, confirm it’s you.</p>
          {pwField}{otherError}
          <div className="row">{cancel}<button className="btn btn-primary" disabled={busy}>Continue</button></div>
        </form>
      )}
      {step === 'scan' && setup && (
        <form className="stack" onSubmit={enable}>
          <ol className="steps-list">
            <li>Install an authenticator app on your phone, such as <strong>Google Authenticator</strong>, Microsoft Authenticator or Authy.</li>
            <li>In the app, tap <strong>+</strong> and <strong>Scan a QR code</strong>.</li>
          </ol>
          <div className="totp-setup">
            <img src={setup.qr} alt="QR code to add this account to your authenticator app" width="180" height="180" className="qr-box" />
            <div className="stack" style={{ gap: 6, minWidth: 0 }}>
              <small className="muted">Can’t scan? Choose <em>Enter a setup key</em> and type:</small>
              <code className="setup-key">{setup.secret.match(/.{1,4}/g).join(' ')}</code>
              <small className="muted">Type of key: time based · On this phone: <a href={setup.otpauthUrl}>open in authenticator app</a></small>
            </div>
          </div>
          <ol className="steps-list" start={3}><li>Enter the 6-digit code the app shows.</li></ol>
          <Field label="6-digit code" error={errors.code}>
            <input className="otp-input" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.replace(/\D/g, '').slice(0, 6) })} inputMode="numeric" pattern="\d{6}" autoComplete="one-time-code" placeholder="123456" required autoFocus />
          </Field>
          <label className="check"><input type="checkbox" checked={form.signOutOthers} onChange={set('signOutOthers')} /> Sign out my other devices</label>
          {otherError}
          <div className="row">{cancel}<button className="btn btn-primary" disabled={busy || form.code.length !== 6}>{busy ? 'Checking…' : 'Turn on'}</button></div>
        </form>
      )}
      {step === 'codes' && codes && <BackupCodes codes={codes} onDone={codesSaved} />}
      {step === 'regen' && (
        <form className="stack" onSubmit={regen}>
          <p style={{ margin: 0 }}>New codes replace all of your current backup codes.</p>
          {pwField}{otherError}
          <div className="row">{cancel}<button className="btn btn-primary" disabled={busy}>Create new codes</button></div>
        </form>
      )}
      {step === 'disable' && (
        <form className="stack" onSubmit={disable}>
          <p style={{ margin: 0 }}>Your account will be protected by your password only.</p>
          {pwField}
          <Field label="Code from the app (or a backup code)" error={errors.code}><input className="otp-input" value={form.code} onChange={(e) => setForm({ ...form, code: cleanCode(e.target.value) })} autoComplete="one-time-code" required /></Field>
          {otherError}
          <div className="row">{cancel}<button className="btn btn-danger" disabled={busy}>Turn off two-step sign-in</button></div>
        </form>
      )}
    </div>
  );
}
