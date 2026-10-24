// Companion portal: the person behind a profile signs in (invitation from staff) to answer booking requests,
// chat with clients on confirmed bookings, keep availability current and send profile updates for review.
// Separate from the member account at /account.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, NavLink, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useSite } from '../context/SiteContext';
import { api, store } from '../utils/api';
import { useSeo } from '../utils/seo';
import { dateTime, day, dayShort, duration, money, time12, todayIso, WEEKDAYS_LONG } from '../utils/format';
import { Empty, Field, Loading, Photo, Status } from '../components/Common';
import { IconBell, IconChat, IconCheck, IconClose, IconLock } from '../components/Icons';
import { Security, TwoStepForm } from '../components/AccountSecurity';
import Chat from '../components/Chat';
import { IdleWarning, markActive, useIdleTimeout } from '../components/IdleTimeout';

const BASE = '/companion';

// ---------- signed out ----------
function SignIn({ onSignedIn }) {
  const [mode, setMode] = useState('login');
  const [form, setForm] = useState({ email: '', password: '', remember: true });
  const [error, setError] = useState('');
  const [notice, setNotice] = useState(null);
  const [mfaToken, setMfaToken] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const run = (fn) => async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try { await fn(); } catch (err) { setError(err.message); } finally { setBusy(false); }
  };
  const login = run(async () => {
    const r = await api('POST', `${BASE}/login`, form);
    if (r.mfaRequired) return setMfaToken(r.mfaToken);
    onSignedIn(r);
  });
  const forgot = run(async () => { const r = await api('POST', `${BASE}/forgot-password`, { email: form.email }); setNotice({ email: form.email, devLink: r.devLink }); });

  if (mfaToken) {
    return <div className="panel"><TwoStepForm base={BASE} token={mfaToken} onSignedIn={onSignedIn} onRestart={(msg) => { setMfaToken(null); setForm({ ...form, password: '' }); setError(msg || ''); }} /></div>;
  }
  if (notice) {
    return (
      <div className="panel stack">
        <h2>Check your inbox</h2>
        <p className="muted">If {notice.email} has portal access, we sent a link to choose a new password.</p>
        {notice.devLink && <div className="notice">Email isn’t set up on this server (development). <a href={notice.devLink}>Open the link directly</a>.</div>}
        <button className="link" onClick={() => { setNotice(null); setMode('login'); }}>Back to sign in</button>
      </div>
    );
  }
  return (
    <div className="panel">
      {mode === 'login' ? (
        <form className="stack" onSubmit={login}>
          <Field label="Email"><input type="email" autoComplete="username" value={form.email} onChange={set('email')} required autoFocus /></Field>
          <Field label="Password"><input type="password" autoComplete="current-password" value={form.password} onChange={set('password')} required /></Field>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <label className="check"><input type="checkbox" checked={form.remember} onChange={set('remember')} /> Keep me signed in</label>
            <button type="button" className="link" onClick={() => { setMode('forgot'); setError(''); }}>Forgot password?</button>
          </div>
          {error && <div className="notice error">{error}</div>}
          <button className="btn btn-primary btn-lg btn-block" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
          {import.meta.env.DEV && <p className="muted center" style={{ fontSize: '0.82rem', margin: 0 }}>Demo: <button type="button" className="link" onClick={() => setForm({ ...form, email: 'companion@aurelia.example', password: 'password' })}>companion@aurelia.example / password</button></p>}
        </form>
      ) : (
        <form className="stack" onSubmit={forgot}>
          <p className="muted">Enter the email your access was set up with and we’ll send a link to choose a new password.</p>
          <Field label="Email"><input type="email" value={form.email} onChange={set('email')} required autoFocus /></Field>
          {error && <div className="notice error">{error}</div>}
          <button className="btn btn-primary btn-block" disabled={busy}>Send reset link</button>
          <button type="button" className="link" onClick={() => setMode('login')}>Back to sign in</button>
        </form>
      )}
      <p className="muted center" style={{ fontSize: '0.84rem', margin: '16px 0 0' }}>Access is set up by our team. Looking for your client account? <Link to="/account">Member sign-in</Link></p>
    </div>
  );
}

// Invitation link (choose a password) and password-reset link.
function TokenScreen({ kind, onSignedIn }) {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = params.get('token');
  const [info, setInfo] = useState(kind === 'invite' ? null : {});
  const [error, setError] = useState('');
  const [pw, setPw] = useState({ password: '', confirm: '' });
  const [mfaToken, setMfaToken] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (kind === 'invite') api('POST', `${BASE}/invite/check`, { token }).then(setInfo).catch((e) => setError(e.message));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const submit = async (e) => {
    e.preventDefault();
    if (pw.password !== pw.confirm) return setError('The passwords don’t match.');
    setBusy(true);
    setError('');
    try {
      const r = await api('POST', `${BASE}/${kind === 'invite' ? 'invite/accept' : 'reset-password'}`, { token, password: pw.password });
      if (r.mfaRequired) return setMfaToken(r.mfaToken);
      if (kind === 'invite') return onSignedIn(r, 'Welcome — your portal is ready');
      const s = await api('GET', `${BASE}/session`);
      onSignedIn(s.user, 'Password saved');
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };
  if (mfaToken) return <TwoStepForm base={BASE} token={mfaToken} onSignedIn={onSignedIn} onRestart={() => navigate(BASE, { replace: true })} />;
  if (!info && !error) return <Loading />;
  if (!info) return <div className="panel stack"><h2>Link not valid</h2><div className="notice error">{error}</div><Link to={BASE} className="btn btn-primary">Go to sign in</Link></div>;
  return (
    <form className="panel stack" onSubmit={submit}>
      <h2>{kind === 'invite' ? `Welcome, ${info.name}` : 'Choose a new password'}</h2>
      {kind === 'invite' && <p className="muted" style={{ margin: 0 }}>Choose a password for <strong>{info.email}</strong>. You’ll use it to sign in to the companion portal.</p>}
      <Field label="Password" hint="At least 8 characters"><input type="password" value={pw.password} onChange={(e) => setPw({ ...pw, password: e.target.value })} autoComplete="new-password" required autoFocus /></Field>
      <Field label="Confirm password"><input type="password" value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} autoComplete="new-password" required /></Field>
      {error && <div className="notice error">{error}</div>}
      <button className="btn btn-primary btn-block" disabled={busy}>{kind === 'invite' ? 'Activate my portal' : 'Save password'}</button>
    </form>
  );
}

// ---------- booking requests ----------
function RequestCard({ b, onAnswered, onRead }) {
  const { toast } = useSite();
  const [declining, setDeclining] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const hasChat = b.chat && (b.chat.open || b.messageCount > 0);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const answer = async (accept) => {
    setBusy(true);
    try {
      onAnswered(await api('POST', `${BASE}/me/bookings/${b.reference}/${accept ? 'accept' : 'decline'}`, accept ? undefined : { reason }));
      toast(accept ? 'Booking confirmed — the client has been told' : 'Request declined');
    } catch (err) { toast(err.message, 'error'); } finally { setBusy(false); }
  };
  return (
    <div className="request-card">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div>
          <strong style={{ fontSize: '1.05rem' }}>{dayShort(b.date)}, {time12(b.time)}–{time12(b.endTime)}</strong>
          <div className="muted" style={{ fontSize: '0.88rem' }}>{b.rateLabel} · {duration(b.durationMinutes)} · {money(b.ratePrice)} · {b.reference}</div>
        </div>
        <div className="row" style={{ gap: 8 }}>
          {b.unreadMessages > 0 && !chatOpen && <span className="unread-chip">{b.unreadMessages} new</span>}
          <Status value={b.status} />
        </div>
      </div>
      <div className="request-meta">
        <span><span className="muted">Client</span> {b.clientName}{b.isMember ? ' · member' : ''}</span>
        {(b.locationName || b.meetingPlace) && <span><span className="muted">Where</span> {[b.locationName, b.meetingPlace].filter(Boolean).join(' — ')}</span>}
        <span><span className="muted">Requested</span> {dateTime(b.createdAt)}</span>
      </div>
      {b.clientNotes && <p className="request-note">“{b.clientNotes}”</p>}
      {b.canRespond && !declining && (
        <div className="row">
          <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => answer(true)}><IconCheck size={14} /> Accept</button>
          <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => setDeclining(true)}>Decline</button>
        </div>
      )}
      {hasChat && !b.canRespond && (
        <div className="row">
          <button className="btn btn-ghost btn-sm" onClick={() => setChatOpen(!chatOpen)} aria-expanded={chatOpen}>
            {chatOpen ? 'Hide messages' : b.unreadMessages > 0 ? `Read ${b.unreadMessages} new message${b.unreadMessages === 1 ? '' : 's'}` : `Message ${b.clientName}`}
          </button>
        </div>
      )}
      {chatOpen && (
        <Chat path={`${BASE}/me/bookings/${b.reference}/messages`} title={`Messages with ${b.clientName}`} placeholder={`Write to ${b.clientName}…`} onRead={onRead}
          hint="The concierge can read this chat. Keep payments and personal contact details within the booking." />
      )}
      {declining && (
        <div className="stack">
          <Field label="Reason for the concierge (optional)" hint="Not shown to the client — they’re told you aren’t available at this time."><input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} autoFocus /></Field>
          <div className="row"><button className="btn btn-ghost btn-sm" onClick={() => setDeclining(false)}>Back</button><button className="btn btn-danger btn-sm" disabled={busy} onClick={() => answer(false)}>Decline request</button></div>
        </div>
      )}
    </div>
  );
}

function BookingList({ scope, limit, empty, onChange }) {
  const [list, setList] = useState(null);
  const load = useCallback(() => api('GET', `${BASE}/me/bookings?scope=${scope}`).then(setList).catch(() => setList([])), [scope]);
  useEffect(() => { setList(null); load(); }, [load]);
  if (!list) return <Loading />;
  if (!list.length) return empty;
  return (
    <div className="stack">
      {list.slice(0, limit || list.length).map((b) => <RequestCard key={b.reference} b={b} onAnswered={() => { load(); onChange?.(); }} onRead={onChange} />)}
    </div>
  );
}

function Overview({ me, refresh, inbox }) {
  const p = me.profile;
  const away = p.awayUntil && p.awayUntil >= todayIso();
  return (
    <div className="stack" style={{ gap: 22 }}>
      <div className="grid-2">
        <div className="panel companion-card">
          <Photo src={p.photo} name={me.name} className="companion-photo" />
          <div>
            <h2 style={{ margin: 0 }}>{me.name}</h2>
            <div className="row" style={{ gap: 8, marginTop: 6 }}><Status value={p.status === 'Published' ? 'Active' : p.status} />{me.twoStep && <span className="vip-chip"><IconLock size={12} /> Two-step on</span>}</div>
            {p.status === 'Published' && <Link to={`/companions/${p.slug}`} className="muted" style={{ fontSize: '0.88rem' }}>View my public profile →</Link>}
          </div>
        </div>
        <div className="panel">
          <div className="summary">
            <div className="summary-line"><span>Requests to answer</span><span>{me.stats.pendingRequests}</span></div>
            <div className="summary-line"><span>Upcoming bookings</span><span>{me.stats.upcoming}</span></div>
            <div className="summary-line"><span>Unread messages</span><span>{inbox?.unread > 0 ? <Link to={`${BASE}/messages`}>{inbox.unread}</Link> : 0}</span></div>
            <div className="summary-line"><span>Updates waiting for review</span><span>{me.stats.pendingChanges}</span></div>
          </div>
          {away && <div className="notice" style={{ marginTop: 14 }}>You’re marked away until {day(p.awayUntil)}. <Link to={`${BASE}/availability`}>Change</Link></div>}
          {!me.twoStep && <div className="notice" style={{ marginTop: 14 }}>Protect your account with an authenticator app. <Link to={`${BASE}/security`}>Turn on two-step sign-in</Link></div>}
        </div>
      </div>
      <NewMessages inbox={inbox} />
      <div className="panel">
        <div className="row" style={{ justifyContent: 'space-between', marginBottom: 14 }}><h3 style={{ margin: 0 }}>Waiting for your answer</h3><Link to={`${BASE}/bookings`}>All bookings</Link></div>
        <BookingList scope="pending" limit={5} onChange={refresh} empty={<p className="muted" style={{ margin: 0 }}>No new requests right now.</p>} />
      </div>
    </div>
  );
}

function Bookings({ me, refresh }) {
  // open on the confirmed bookings when there's nothing to answer but new messages are waiting
  const [scope, setScope] = useState(!me.stats.pendingRequests && me.stats.unreadMessages ? 'upcoming' : 'pending');
  const labels = { pending: 'To answer', upcoming: 'Upcoming', past: 'Past' };
  return (
    <div className="panel">
      <h2>Bookings</h2>
      <div className="tabs-inline" role="tablist" style={{ maxWidth: 420 }}>
        {Object.entries(labels).map(([k, label]) => <button key={k} role="tab" aria-selected={scope === k} className={scope === k ? 'on' : ''} onClick={() => setScope(k)}>{label}</button>)}
      </div>
      <BookingList scope={scope} onChange={refresh}
        empty={<Empty title={scope === 'pending' ? 'Nothing to answer' : scope === 'upcoming' ? 'No upcoming bookings' : 'No past bookings yet'} text={scope === 'pending' ? 'New requests appear here and we’ll email you too.' : ''} />} />
      <p className="muted" style={{ fontSize: '0.84rem', margin: '16px 0 0' }}>Once you accept a request you can message the client from the booking. Need to change or cancel a confirmed booking? Contact the concierge — they’ll arrange it with the client.</p>
    </div>
  );
}

// ---------- availability ----------
function Availability({ refresh }) {
  const { toast } = useSite();
  const [data, setData] = useState(null);
  const [blocks, setBlocks] = useState([]);
  const [off, setOff] = useState([]);
  const [away, setAway] = useState({ awayUntil: '', awayNote: '' });
  const [busy, setBusy] = useState(false);
  const apply = (d) => {
    setData(d);
    setBlocks(d.schedule.map(({ weekday, start, end }) => ({ weekday, start, end })));
    setOff(d.timeOff.map(({ startDate, endDate, note }) => ({ startDate, endDate, note: note || '' })));
    setAway({ awayUntil: d.awayUntil || '', awayNote: d.awayNote || '' });
  };
  useEffect(() => { api('GET', `${BASE}/me/availability`).then(apply); }, []);
  const save = async (path, body, message) => {
    setBusy(true);
    try { apply(await api('PUT', `${BASE}/me/${path}`, body)); toast(message); refresh(); } catch (err) { toast(err.message, 'error'); } finally { setBusy(false); }
  };
  if (!data) return <Loading />;
  const copyToAll = (d) => {
    const src = blocks.filter((b) => b.weekday === d);
    setBlocks([...src, ...[0, 1, 2, 3, 4, 5, 6].filter((x) => x !== d).flatMap((x) => src.map((b) => ({ ...b, weekday: x })))]);
  };
  const setBlock = (i, k, v) => setBlocks(blocks.map((x, n) => (n === i ? { ...x, [k]: v } : x)));
  const setOffItem = (i, patch) => setOff(off.map((x, n) => (n === i ? { ...x, ...patch } : x)));
  return (
    <div className="stack" style={{ gap: 22 }}>
      <div className="panel stack">
        <h2 style={{ margin: 0 }}>Weekly hours</h2>
        <p className="muted" style={{ margin: 0 }}>Clients can request sessions that fit inside these hours. Changes show on your profile straight away. Use 00:00 as the end time for “until midnight”.</p>
        <div className="week-editor">
          {[1, 2, 3, 4, 5, 6, 0].map((d) => {
            const day = blocks.map((b, i) => [b, i]).filter(([b]) => b.weekday === d);
            return (
              <div key={d} className="week-row">
                <strong>{WEEKDAYS_LONG[d]}</strong>
                <div className="week-blocks">
                  {day.map(([b, i]) => (
                    <span key={i} className="week-block">
                      <input type="time" value={b.start} onChange={(e) => setBlock(i, 'start', e.target.value)} aria-label={`${WEEKDAYS_LONG[d]} from`} />–
                      <input type="time" value={b.end === '24:00' ? '00:00' : b.end} onChange={(e) => setBlock(i, 'end', e.target.value)} aria-label={`${WEEKDAYS_LONG[d]} to`} />
                      <button type="button" className="icon-x" onClick={() => setBlocks(blocks.filter((_, n) => n !== i))} aria-label="Remove">✕</button>
                    </span>
                  ))}
                  {!day.length && <span className="muted">Not available</span>}
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setBlocks([...blocks, { weekday: d, start: '18:00', end: '24:00' }])}>+ Hours</button>
                  {day.length > 0 && <button type="button" className="link" onClick={() => copyToAll(d)}>Copy to every day</button>}
                </div>
              </div>
            );
          })}
        </div>
        <div><button className="btn btn-primary" disabled={busy} onClick={() => save('schedule', { blocks: blocks.map((b) => ({ ...b, end: b.end === '00:00' ? '24:00' : b.end })) }, 'Weekly hours saved')}>Save weekly hours</button></div>
      </div>

      <div className="grid-2" style={{ alignItems: 'start' }}>
        <div className="panel stack">
          <h2 style={{ margin: 0 }}>Time off</h2>
          <p className="muted" style={{ margin: 0 }}>Days you can’t be booked — travel, holidays.</p>
          {off.map((t, i) => (
            <div key={i} className="time-off-row">
              <input className="input" type="date" value={t.startDate} min={todayIso()} onChange={(e) => setOffItem(i, { startDate: e.target.value, endDate: t.endDate < e.target.value ? e.target.value : t.endDate })} aria-label="From" />
              <input className="input" type="date" value={t.endDate} min={t.startDate} onChange={(e) => setOffItem(i, { endDate: e.target.value })} aria-label="To" />
              <input className="input" value={t.note} onChange={(e) => setOffItem(i, { note: e.target.value })} placeholder="Note (optional)" aria-label="Note" />
              <button type="button" className="icon-x" onClick={() => setOff(off.filter((_, n) => n !== i))} aria-label="Remove">✕</button>
            </div>
          ))}
          {!off.length && <p className="muted" style={{ margin: 0 }}>No time off planned.</p>}
          <div className="row">
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOff([...off, { startDate: todayIso(), endDate: todayIso(), note: '' }])}>+ Time off</button>
            <span className="spacer" />
            <button className="btn btn-primary" disabled={busy} onClick={() => save('time-off', { items: off }, 'Time off saved')}>Save time off</button>
          </div>
        </div>
        <div className="panel stack">
          <h2 style={{ margin: 0 }}>Away</h2>
          <p className="muted" style={{ margin: 0 }}>Pause all new requests until a date. Your profile stays visible with a note.</p>
          <Field label="Away until (inclusive)"><input type="date" min={todayIso()} value={away.awayUntil} onChange={(e) => setAway({ ...away, awayUntil: e.target.value })} /></Field>
          <Field label="Note on your profile (optional)"><input value={away.awayNote} maxLength={200} onChange={(e) => setAway({ ...away, awayNote: e.target.value })} placeholder="Back from travel soon" /></Field>
          <div className="row">
            {data.awayUntil && <button className="btn btn-ghost" disabled={busy} onClick={() => save('away', { awayUntil: null, awayNote: null }, 'You’re back — requests are open')}>I’m back</button>}
            <span className="spacer" />
            <button className="btn btn-primary" disabled={busy || !away.awayUntil} onClick={() => save('away', away, `Away until ${day(away.awayUntil)}`)}>Save</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------- profile updates ----------
const FIELD_LABELS = { tagline: 'Tagline', bio: 'About', languages: 'Languages', nationality: 'Nationality', heightCm: 'Height (cm)' };

function ProfileTab({ refresh }) {
  const { toast } = useSite();
  const [data, setData] = useState(null);
  const [form, setForm] = useState(null);
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const file = useRef(null);
  const apply = (d) => {
    setData(d);
    const pending = d.requests.find((r) => r.kind === 'details' && r.status === 'Pending');
    const f = { ...d.fields, ...(pending?.data || {}) };
    setForm(Object.fromEntries(Object.keys(FIELD_LABELS).map((k) => [k, f[k] ?? ''])));
  };
  useEffect(() => { api('GET', `${BASE}/me/profile`).then(apply); }, []);
  if (!data) return <Loading />;
  const pendingDetails = data.requests.find((r) => r.kind === 'details' && r.status === 'Pending');
  const pendingPhotos = data.requests.filter((r) => r.kind === 'photo' && r.status === 'Pending');
  const history = data.requests.filter((r) => r.status !== 'Pending');
  const act = async (fn, message) => {
    setBusy(true);
    setErrors({});
    try { apply(await fn()); toast(message); refresh(); } catch (err) { setErrors(err.details || {}); toast(err.message, 'error'); } finally { setBusy(false); }
  };
  const send = (e) => { e.preventDefault(); act(() => api('POST', `${BASE}/me/profile/details`, { ...form, heightCm: form.heightCm || null }), 'Sent for review'); };
  const upload = async (files) => {
    if (!files.length) return;
    const fd = new FormData();
    for (const f of files) fd.append('photos', f);
    setBusy(true);
    try {
      const res = await fetch(`/api${BASE}/me/photos`, { method: 'POST', body: fd, credentials: 'same-origin' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'Upload failed.');
      apply(body);
      toast(files.length === 1 ? 'Photo sent for review' : `${files.length} photos sent for review`);
      refresh();
    } catch (err) { toast(err.message, 'error'); } finally { setBusy(false); if (file.current) file.current.value = ''; }
  };
  const withdraw = (id) => act(() => api('DELETE', `${BASE}/me/changes/${id}`), 'Withdrawn');
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  return (
    <div className="stack" style={{ gap: 22 }}>
      <form className="panel stack" onSubmit={send}>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h2 style={{ margin: 0 }}>Profile wording</h2>
          {pendingDetails && <span className="vip-chip">Waiting for review</span>}
        </div>
        <p className="muted" style={{ margin: 0 }}>Changes are checked by our team before they appear on your profile. Rates and other details are managed by the concierge.</p>
        {pendingDetails && <div className="notice">Your update from {dateTime(pendingDetails.createdAt)} is waiting for review. Sending again replaces it. <button type="button" className="link" onClick={() => withdraw(pendingDetails.id)}>Withdraw it</button></div>}
        <div className="form-grid">
          <Field label="Tagline" error={errors.tagline} className="span-2" hint="One line under your name"><input value={form.tagline} maxLength={160} onChange={set('tagline')} /></Field>
          <Field label="About" error={errors.bio} className="span-2"><textarea rows={7} value={form.bio} maxLength={6000} onChange={set('bio')} /></Field>
          <Field label="Languages" error={errors.languages} hint="Separate with commas"><input value={form.languages} maxLength={200} onChange={set('languages')} /></Field>
          <Field label="Nationality" error={errors.nationality}><input value={form.nationality} maxLength={60} onChange={set('nationality')} /></Field>
          <Field label="Height (cm)" error={errors.heightCm}><input type="number" min={120} max={230} value={form.heightCm} onChange={set('heightCm')} /></Field>
        </div>
        <div><button className="btn btn-primary" disabled={busy}>Send for review</button></div>
      </form>

      <div className="panel stack">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h2 style={{ margin: 0 }}>Photos</h2>
          <label className={`btn btn-primary btn-sm ${busy ? 'disabled' : ''}`}>
            Add photos<input ref={file} type="file" accept="image/jpeg,image/png,image/webp" multiple hidden disabled={busy} onChange={(e) => upload([...e.target.files])} />
          </label>
        </div>
        <p className="muted" style={{ margin: 0 }}>JPG, PNG or WEBP up to 4 MB, up to 6 at a time. New photos appear once approved. To remove or reorder photos, contact the concierge.</p>
        {pendingPhotos.length > 0 && (
          <>
            <h3 style={{ margin: '6px 0 0', fontSize: '1rem' }}>Waiting for review</h3>
            <div className="photo-grid">
              {pendingPhotos.map((r) => (
                <figure key={r.id} className="photo-tile pending">
                  <img src={r.photoUrl} alt="Waiting for review" loading="lazy" decoding="async" />
                  <button type="button" className="photo-remove" onClick={() => withdraw(r.id)} aria-label="Withdraw this photo">✕</button>
                </figure>
              ))}
            </div>
          </>
        )}
        <h3 style={{ margin: '6px 0 0', fontSize: '1rem' }}>On your profile</h3>
        {data.media.filter((m) => m.kind === 'photo').length ? (
          <div className="photo-grid">
            {data.media.filter((m) => m.kind === 'photo').map((m) => (
              <figure key={m.id} className="photo-tile">
                <img src={m.url} alt={m.altText || ''} loading="lazy" decoding="async" />
                {(m.isPrimary || m.vipOnly) && <figcaption>{m.isPrimary ? 'Main photo' : 'VIP only'}</figcaption>}
              </figure>
            ))}
          </div>
        ) : <p className="muted" style={{ margin: 0 }}>No photos yet.</p>}
      </div>

      {history.length > 0 && (
        <div className="panel">
          <h2>Recent decisions</h2>
          {history.map((r) => (
            <div key={r.id} className="list-item">
              {r.kind === 'photo' && r.photoUrl && r.status === 'Approved' ? <img src={r.photoUrl} alt="" className="history-thumb" loading="lazy" decoding="async" /> : <span className="history-thumb icon">{r.kind === 'photo' ? '▣' : '¶'}</span>}
              <div style={{ flex: 1, minWidth: 0 }}>
                <strong>{r.kind === 'photo' ? 'New photo' : `Profile update: ${Object.keys(r.data || {}).map((k) => FIELD_LABELS[k] || k).join(', ')}`}</strong>
                <div className="muted" style={{ fontSize: '0.84rem' }}>{dateTime(r.decidedAt)}{r.staffNote ? ` · “${r.staffNote}”` : ''}</div>
              </div>
              <Status value={r.status} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------- messages: inbox and new-message alerts ----------
const INBOX_POLL_MS = 20000;
const ALERTS_KEY = 'aurelia-companion-desktop-alerts';
const canNotify = () => typeof window !== 'undefined' && 'Notification' in window;
// desktop alerts: allowed by the browser and switched on in the Messages tab
const desktopAlertsOn = () => canNotify() && Notification.permission === 'granted' && store.get(ALERTS_KEY, false);
const senderLabel = (t) => (t.last?.from === 'concierge' ? 'the concierge' : t.clientName);

/**
 * Polls the inbox while signed in. Calls onNew(threads) for conversations whose latest message arrived since the
 * previous check and wasn't sent by the companion. The first load only sets the baseline, so old messages don't alert.
 */
function useInbox(enabled, onNew) {
  const [inbox, setInbox] = useState(null);
  const seen = useRef(null);
  const onNewRef = useRef(onNew);
  onNewRef.current = onNew;
  const load = useCallback(() => api('GET', `${BASE}/me/messages`).then((r) => {
    if (seen.current) {
      const fresh = r.threads.filter((t) => t.last && t.last.from !== 'me' && t.unread > 0 && t.last.id > (seen.current[t.reference] || 0));
      if (fresh.length) onNewRef.current(fresh);
    }
    seen.current = Object.fromEntries(r.threads.map((t) => [t.reference, t.last?.id || 0]));
    setInbox(r);
  }).catch(() => {}), []);
  useEffect(() => {
    if (!enabled) { setInbox(null); seen.current = null; return undefined; }
    load();
    // in a background tab, keep checking only when desktop alerts are on
    const t = setInterval(() => { if (document.visibilityState === 'visible' || desktopAlertsOn()) load(); }, INBOX_POLL_MS);
    window.addEventListener('focus', load);
    return () => { clearInterval(t); window.removeEventListener('focus', load); };
  }, [enabled, load]);
  return [inbox, load];
}

/** Pop-up cards for new messages, each opening the conversation. */
function MessageAlerts({ alerts, onOpen, onDismiss }) {
  if (!alerts.length) return null;
  return (
    <div className="msg-alerts" role="status" aria-live="polite">
      {alerts.map((a) => (
        <div key={a.key} className="msg-alert">
          <span className="msg-alert-icon"><IconChat size={18} /></span>
          <div className="msg-alert-body">
            <strong>New message from {a.from}</strong>
            <small className="muted">{a.reference}{a.date ? ` · ${dayShort(a.date)}` : ''}</small>
            <p>{a.preview}</p>
            <button className="btn btn-primary btn-sm" onClick={() => onOpen(a)}>Read &amp; reply</button>
          </div>
          <button className="msg-alert-x" onClick={() => onDismiss(a.key)} aria-label="Dismiss"><IconClose size={16} /></button>
        </div>
      ))}
    </div>
  );
}

function DesktopAlerts() {
  const [on, setOn] = useState(() => desktopAlertsOn());
  if (!canNotify()) return null;
  if (Notification.permission === 'denied') return <span className="muted" style={{ fontSize: '0.82rem' }}>Desktop alerts are blocked in this browser’s site settings.</span>;
  const toggle = async () => {
    if (on) { store.set(ALERTS_KEY, false); setOn(false); return; }
    const p = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
    store.set(ALERTS_KEY, p === 'granted');
    setOn(p === 'granted');
  };
  return <button className="btn btn-ghost btn-sm" onClick={toggle} aria-pressed={on}><IconBell size={14} /> {on ? 'Desktop alerts on' : 'Turn on desktop alerts'}</button>;
}

function ThreadRow({ t, active }) {
  const who = t.last?.from === 'me' ? 'You: ' : t.last?.from === 'concierge' ? 'Concierge: ' : '';
  return (
    <Link to={`${BASE}/messages/${t.reference}`} className={`thread${active ? ' on' : ''}${t.unread ? ' unread' : ''}`} aria-current={active ? 'true' : undefined}>
      <span className="thread-head">
        <strong>{t.clientName}</strong>
        {t.unread > 0 ? <span className="unread-chip">{t.unread} new</span> : t.last && <small className="muted">{dateTime(t.last.at)}</small>}
      </span>
      <small className="muted">{t.date ? `${dayShort(t.date)}, ${time12(t.time)} · ` : ''}{t.rateLabel} · <span style={{ whiteSpace: 'nowrap' }}>{t.reference}</span></small>
      <span className="thread-preview">{t.last ? `${who}${t.last.preview}` : t.open ? 'No messages yet — say hello.' : 'No messages.'}</span>
    </Link>
  );
}

function Messages({ inbox, reloadInbox, refresh }) {
  const { ref } = useParams();
  const navigate = useNavigate();
  const threads = inbox?.threads || [];
  const active = threads.find((t) => t.reference === ref);
  // on a wide screen, open the top conversation straight away
  useEffect(() => {
    if (!ref && threads.length && window.matchMedia('(min-width: 961px)').matches) navigate(`${BASE}/messages/${threads[0].reference}`, { replace: true });
  }, [ref, threads.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const onRead = useCallback(() => { reloadInbox(); refresh(); }, [reloadInbox, refresh]);
  if (!inbox) return <Loading />;
  return (
    <div className="panel">
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 14 }}>
        <h2 style={{ margin: 0 }}>Messages</h2>
        <DesktopAlerts />
      </div>
      {!threads.length ? (
        <Empty title="No conversations yet" text="Once you accept a booking request, you can message the client here." />
      ) : (
        <div className={`inbox${ref ? ' has-active' : ''}`}>
          <nav className="thread-list" aria-label="Conversations">{threads.map((t) => <ThreadRow key={t.reference} t={t} active={t.reference === ref} />)}</nav>
          <div className="thread-view">
            {ref && <Link to={`${BASE}/messages`} className="thread-back">← All conversations</Link>}
            {active ? (
              <Chat key={active.reference} path={`${BASE}/me/bookings/${active.reference}/messages`} onRead={onRead}
                title={`${active.clientName} · ${active.date ? `${dayShort(active.date)}, ${time12(active.time)}` : active.reference}`} placeholder={`Write to ${active.clientName}…`}
                hint="The concierge can read this chat. Keep payments and personal contact details within the booking." />
            ) : ref ? <div className="notice">This conversation isn’t available any more.</div> : <p className="muted">Choose a conversation.</p>}
          </div>
        </div>
      )}
    </div>
  );
}

function NewMessages({ inbox }) {
  const unread = (inbox?.threads || []).filter((t) => t.unread > 0);
  if (!unread.length) return null;
  return (
    <div className="panel">
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 10 }}><h3 style={{ margin: 0 }}>New messages</h3><Link to={`${BASE}/messages`}>All messages</Link></div>
      <div className="stack" style={{ gap: 8 }}>{unread.slice(0, 4).map((t) => <ThreadRow key={t.reference} t={t} />)}</div>
    </div>
  );
}

// ---------- shell ----------
const TABS = [['', 'Overview'], ['messages', 'Messages'], ['bookings', 'Bookings'], ['availability', 'Availability'], ['profile', 'My profile'], ['security', 'Security']];
const CompanionSecurity = () => <Security base={BASE} />;

export default function Companion() {
  const { tab = '', ref } = useParams();
  const navigate = useNavigate();
  const { toast, idle } = useSite();
  const [me, setMe] = useState(undefined);
  const [alerts, setAlerts] = useState([]);
  const openRef = tab === 'messages' ? ref : null;
  const onNew = useCallback((threads) => {
    // the conversation already on screen shows new messages by itself
    const fresh = threads.filter((t) => !(t.reference === openRef && document.visibilityState === 'visible'));
    if (!fresh.length) return;
    setAlerts((cur) => [
      ...fresh.map((t) => ({ key: `${t.reference}:${t.last.id}`, reference: t.reference, date: t.date, from: senderLabel(t), preview: t.last.preview })),
      ...cur.filter((a) => !fresh.some((t) => t.reference === a.reference)),
    ].slice(0, 3));
    if (document.visibilityState !== 'visible' && desktopAlertsOn()) {
      for (const t of fresh) {
        try {
          const n = new Notification(`New message from ${senderLabel(t)}`, { body: t.last.preview, tag: t.reference });
          n.onclick = () => { window.focus(); navigate(`${BASE}/messages/${t.reference}`); n.close(); };
        } catch { /* some mobile browsers only allow notifications from a service worker */ }
      }
    }
  }, [openRef, navigate]);
  const [inbox, reloadInbox] = useInbox(!!me, onNew);
  useSeo({ title: `${inbox?.unread ? `(${inbox.unread}) ` : ''}Companion portal`, noindex: true });
  // opening a conversation clears its alert
  useEffect(() => { if (openRef) setAlerts((cur) => cur.filter((a) => a.reference !== openRef)); }, [openRef]);
  const refresh = useCallback(() => api('GET', `${BASE}/session`).then((r) => setMe(r.user)).catch(() => setMe(null)), []);
  useEffect(() => { refresh(); }, [refresh]);
  const signedIn = (u, message) => {
    markActive();
    setMe(u);
    toast(message || (u.backupCodesLeft != null ? `Signed in with a backup code — ${u.backupCodesLeft} left` : `Welcome back, ${u.name}`));
    navigate(BASE, { replace: true });
  };
  const signOut = async (message) => { await api('POST', `${BASE}/logout`).catch(() => {}); setMe(null); navigate(BASE); toast(message); };
  const logout = () => signOut('Signed out');
  const idleLeft = useIdleTimeout(me ? idle?.companionMinutes : 0, () => signOut('You were signed out after a period of inactivity'));

  if (me === undefined) return <Loading />;
  if (tab === 'invite' || tab === 'reset-password') {
    return <div className="auth-wrap"><div className="auth-card"><TokenScreen kind={tab === 'invite' ? 'invite' : 'reset'} onSignedIn={signedIn} /></div></div>;
  }
  if (!me) {
    return (
      <div className="auth-wrap">
        <div className="auth-card">
          <div className="center" style={{ marginBottom: 20 }}><span className="kicker">Companions</span><h1 style={{ fontSize: '2.6rem' }}>Companion portal</h1><p className="muted">Answer booking requests, set your hours and keep your profile fresh.</p></div>
          <SignIn onSignedIn={signedIn} />
        </div>
      </div>
    );
  }
  const View = { '': Overview, messages: Messages, bookings: Bookings, availability: Availability, profile: ProfileTab, security: CompanionSecurity }[tab] || Overview;
  return (
    <div className="container account">
      <nav className="account-nav" aria-label="Companion portal">
        <span className="kicker" style={{ padding: '0 14px' }}>Companion portal</span>
        {TABS.map(([k, label]) => (
          <NavLink key={k} to={`${BASE}${k ? `/${k}` : ''}`} end={!k}>
            {label}{k === 'bookings' && me.stats.pendingRequests > 0 && <b className="nav-count">{me.stats.pendingRequests}</b>}
            {k === 'messages' && inbox?.unread > 0 && <b className="nav-count" title={`${inbox.unread} unread`}>{inbox.unread}</b>}
          </NavLink>
        ))}
        <button className="link" style={{ textAlign: 'left', padding: '10px 14px' }} onClick={logout}>Sign out</button>
      </nav>
      <div><View me={me} refresh={refresh} inbox={inbox} reloadInbox={reloadInbox} /></div>
      <MessageAlerts alerts={alerts} onDismiss={(key) => setAlerts((cur) => cur.filter((a) => a.key !== key))}
        onOpen={(a) => { setAlerts((cur) => cur.filter((x) => x.key !== a.key)); navigate(`${BASE}/messages/${a.reference}`); }} />
      <IdleWarning seconds={idleLeft} onSignOut={logout} />
    </div>
  );
}

