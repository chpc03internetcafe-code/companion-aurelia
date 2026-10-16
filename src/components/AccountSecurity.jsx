// Account security shared by the member portal (/account) and the companion portal (/companion): the second sign-in
// step, password change, two-step sign-in with an authenticator app, backup codes and signed-in devices.
// `base` is the API prefix: '/account' or '/companion' (both expose the same /me/... security endpoints).
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useSite } from '../context/SiteContext';
import { api } from '../utils/api';
import { dateTime, day } from '../utils/format';
import { Field, Loading } from './Common';
import { IconLock } from './Icons';

const cleanCode = (v) => v.replace(/[^0-9A-Za-z-]/g, '').slice(0, 9);

// Second sign-in step when two-step sign-in is on: a code from the authenticator app, or a backup code.
export function TwoStepForm({ base, token, onSignedIn, onRestart }) {
  const [backup, setBackup] = useState(false);
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await onSignedIn(await api('POST', `${base}/login/2fa`, { token, code }));
    } catch (err) {
      if (err.details.code === 'mfa_expired') return onRestart(err.message);
      setError(err.message);
      setCode('');
    } finally { setBusy(false); }
  };
  return (
    <form className="stack" onSubmit={submit}>
      <div className="center"><IconLock size={30} style={{ color: 'var(--primary)' }} /><h2 style={{ margin: '8px 0 4px' }}>Two-step sign-in</h2>
        <p className="muted" style={{ margin: 0 }}>{backup ? 'Enter one of the backup codes you saved. Each code works once.' : 'Open your authenticator app and enter the 6-digit code for this site.'}</p></div>
      {backup
        ? <Field label="Backup code" error={error}><input className="otp-input" value={code} onChange={(e) => setCode(cleanCode(e.target.value).toUpperCase())} placeholder="XXXX-XXXX" autoComplete="off" autoFocus required /></Field>
        : <Field label="Authentication code" error={error}><input className="otp-input" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" pattern="\d{6}" autoComplete="one-time-code" placeholder="123456" autoFocus required /></Field>}
      <button className="btn btn-primary btn-lg btn-block" disabled={busy}>{busy ? 'Checking…' : 'Verify'}</button>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <button type="button" className="link" onClick={() => { setBackup(!backup); setCode(''); setError(''); }}>{backup ? 'Use the authenticator app' : 'Lost your phone? Use a backup code'}</button>
        <button type="button" className="link" onClick={() => onRestart()}>Cancel</button>
      </div>
      {backup && <p className="muted" style={{ fontSize: '0.84rem', margin: 0 }}>No backup codes either? <Link to="/contact">Contact us</Link> — we’ll verify it’s you and reset two-step sign-in.</p>}
    </form>
  );
}

const device = (ua = '') => {
  const os = /iphone|ipad/i.test(ua) ? 'iPhone / iPad' : /android/i.test(ua) ? 'Android' : /windows/i.test(ua) ? 'Windows' : /mac os/i.test(ua) ? 'Mac' : /linux/i.test(ua) ? 'Linux' : 'Device';
  const br = /edg\//i.test(ua) ? 'Edge' : /chrome\//i.test(ua) ? 'Chrome' : /firefox\//i.test(ua) ? 'Firefox' : /safari\//i.test(ua) ? 'Safari' : 'Browser';
  return `${br} on ${os}`;
};

export function BackupCodes({ codes, onDone }) {
  const { toast } = useSite();
  const textFile = `Aurelia backup codes — each works once\n\n${codes.join('\n')}\n`;
  const copy = async () => {
    try { await navigator.clipboard.writeText(codes.join('\n')); toast('Backup codes copied'); } catch { toast('Copy failed — select the codes instead', 'error'); }
  };
  return (
    <div className="stack">
      <div className="notice ok">Save these backup codes somewhere safe, like a password manager. If you lose your phone, each one lets you sign in once. They won’t be shown again.</div>
      <ol className="backup-codes">{codes.map((c) => <li key={c}>{c}</li>)}</ol>
      <div className="row">
        <button type="button" className="btn btn-ghost btn-sm" onClick={copy}>Copy</button>
        <a className="btn btn-ghost btn-sm" href={`data:text/plain;charset=utf-8,${encodeURIComponent(textFile)}`} download="aurelia-backup-codes.txt">Download .txt</a>
        <span className="spacer" />
        <button type="button" className="btn btn-primary btn-sm" onClick={onDone}>I’ve saved them</button>
      </div>
    </div>
  );
}

// Two-step sign-in with an authenticator app (Google Authenticator, Microsoft Authenticator, Authy, 1Password…).
export function TwoStep({ base, onSessionsChanged }) {
  const { toast } = useSite();
  const [status, setStatus] = useState(null);
  const [step, setStep] = useState(null); // null | 'password' | 'scan' | 'codes' | 'regen' | 'disable'
  const [setup, setSetup] = useState(null);
  const [form, setForm] = useState({ password: '', code: '', signOutOthers: true });
  const [codes, setCodes] = useState(null);
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  useEffect(() => { api('GET', `${base}/me/2fa`).then(setStatus).catch(() => setStatus({ enabled: false })); }, []);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const close = () => { setStep(null); setSetup(null); setCodes(null); setErrors({}); setForm({ password: '', code: '', signOutOthers: true }); };
  const go = (fn) => async (e) => {
    e.preventDefault();
    setBusy(true);
    setErrors({});
    try { await fn(); } catch (err) { setErrors({ ...err.details, _: err.message }); } finally { setBusy(false); }
  };

  const start = go(async () => { setSetup(await api('POST', `${base}/me/2fa/setup`, { password: form.password })); setStep('scan'); });
  const enable = go(async () => {
    const r = await api('POST', `${base}/me/2fa/enable`, { code: form.code, signOutOthers: form.signOutOthers });
    setStatus(r);
    setCodes(r.backupCodes);
    setStep('codes');
    toast('Two-step sign-in is on');
    if (form.signOutOthers) onSessionsChanged();
  });
  const regen = go(async () => { const r = await api('POST', `${base}/me/2fa/backup-codes`, { password: form.password }); setStatus(r); setCodes(r.backupCodes); setStep('codes'); });
  const disable = go(async () => { setStatus(await api('POST', `${base}/me/2fa/disable`, { password: form.password, code: form.code })); close(); toast('Two-step sign-in is off'); });

  if (!status) return <div className="panel"><Loading /></div>;
  const pwField = <Field label="Current password" error={errors.password}><input type="password" autoComplete="current-password" value={form.password} onChange={set('password')} required autoFocus /></Field>;
  const otherError = errors._ && !errors.password && !errors.code && <div className="notice error">{errors._}</div>;
  const cancel = <button type="button" className="btn btn-ghost" onClick={close}>Cancel</button>;

  return (
    <div className="panel stack">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h2 style={{ margin: 0 }}>Two-step sign-in</h2>
        <span className={`vip-chip ${status.enabled ? '' : 'chip-off'}`}>{status.enabled ? 'On' : 'Off'}</span>
      </div>
      <p className="muted" style={{ margin: 0 }}>
        {status.enabled
          ? <>Signing in needs your password and a code from your authenticator app. On since {day(status.enabledAt)} · {status.backupCodesLeft} backup code{status.backupCodesLeft === 1 ? '' : 's'} left.</>
          : <>Protect your account with a 6-digit code from an authenticator app such as Google Authenticator, Microsoft Authenticator or Authy, so a stolen password isn’t enough to sign in.</>}
      </p>
      {status.enabled && status.backupCodesLeft <= 2 && !step && <div className="notice">You’re running out of backup codes. Create new ones so you can still sign in if you lose your phone.</div>}

      {!step && (
        <div className="row">
          {status.enabled
            ? <><button className="btn btn-ghost" onClick={() => setStep('regen')}>New backup codes</button><button className="btn btn-ghost" onClick={() => setStep('disable')}>Turn off</button></>
            : <button className="btn btn-primary" onClick={() => setStep('password')}>Set up authenticator app</button>}
        </div>
      )}

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
            <li>Install an authenticator app on your phone — <strong>Google Authenticator</strong>, Microsoft Authenticator or Authy.</li>
            <li>In the app, tap <strong>+</strong> and <strong>Scan a QR code</strong>.</li>
          </ol>
          <div className="totp-setup">
            <img src={setup.qr} alt="QR code to add this account to your authenticator app" width="200" height="200" className="qr-box" />
            <div className="totp-key">
              <span className="muted" style={{ fontSize: '0.86rem' }}>Can’t scan? Choose <em>Enter a setup key</em> and type:</span>
              <code className="setup-key">{setup.secret.match(/.{1,4}/g).join(' ')}</code>
              <span className="muted" style={{ fontSize: '0.8rem' }}>Type of key: time based · On this phone: <a href={setup.otpauthUrl}>open in authenticator app</a></span>
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

      {step === 'codes' && codes && <BackupCodes codes={codes} onDone={close} />}

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
          <div className="form-grid">
            {pwField}
            <Field label="Code from the app (or a backup code)" error={errors.code}><input className="otp-input" value={form.code} onChange={(e) => setForm({ ...form, code: cleanCode(e.target.value) })} autoComplete="one-time-code" required /></Field>
          </div>
          {otherError}
          <div className="row">{cancel}<button className="btn btn-danger" disabled={busy}>Turn off two-step sign-in</button></div>
        </form>
      )}
    </div>
  );
}

export function Security({ base }) {
  const { toast } = useSite();
  const [sessions, setSessions] = useState(null);
  const [pw, setPw] = useState({ currentPassword: '', newPassword: '', confirm: '' });
  const [errors, setErrors] = useState({});
  useEffect(() => { api('GET', `${base}/me/sessions`).then(setSessions); }, []);
  const change = async (e) => {
    e.preventDefault();
    if (pw.newPassword !== pw.confirm) return setErrors({ confirm: 'The passwords don’t match.' });
    try {
      await api('POST', `${base}/me/password`, pw);
      toast('Password changed. Other devices were signed out.');
      setPw({ currentPassword: '', newPassword: '', confirm: '' });
      setErrors({});
      setSessions(await api('GET', `${base}/me/sessions`));
    } catch (err) { setErrors(err.details || { newPassword: err.message }); }
  };
  return (
    <div className="stack" style={{ gap: 22 }}>
      <TwoStep base={base} onSessionsChanged={() => api('GET', `${base}/me/sessions`).then(setSessions)} />
      <form className="panel stack" onSubmit={change}>
        <h2>Password</h2>
        <div className="form-grid">
          <Field label="Current password" error={errors.currentPassword} className="span-2"><input type="password" autoComplete="current-password" value={pw.currentPassword} onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })} required /></Field>
          <Field label="New password" error={errors.newPassword} hint="At least 8 characters"><input type="password" autoComplete="new-password" value={pw.newPassword} onChange={(e) => setPw({ ...pw, newPassword: e.target.value })} required /></Field>
          <Field label="Confirm new password" error={errors.confirm}><input type="password" autoComplete="new-password" value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} required /></Field>
        </div>
        <div><button className="btn btn-primary">Change password</button></div>
      </form>
      <div className="panel">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h2 style={{ margin: 0 }}>Signed-in devices</h2>
          {sessions?.length > 1 && <button className="btn btn-ghost btn-sm" onClick={async () => { setSessions(await api('POST', `${base}/me/sessions/revoke-others`)); toast('Other devices signed out'); }}>Sign out all other devices</button>}
        </div>
        {!sessions ? <Loading /> : sessions.map((s) => (
          <div key={s.id} className="list-item">
            <div style={{ flex: 1 }}><strong>{device(s.userAgent)}</strong>{s.current && <span className="vip-chip" style={{ marginLeft: 8 }}>This device</span>}
              <div className="muted" style={{ fontSize: '0.84rem' }}>Last active {dateTime(s.lastSeenAt)} · signed in {dateTime(s.createdAt)}{s.ipAddress ? ` · ${s.ipAddress}` : ''}</div></div>
            {!s.current && <button className="btn btn-ghost btn-sm" onClick={async () => setSessions(await api('DELETE', `${base}/me/sessions/${s.id}`))}>Sign out</button>}
          </div>
        ))}
      </div>
    </div>
  );
}
