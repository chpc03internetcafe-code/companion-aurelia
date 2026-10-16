// Member portal: sign-in / sign-up / email confirmation / password reset, then overview, bookings, VIP collections,
// membership (request, renew, upgrade), profile and security (password, two-step sign-in, signed-in devices).
import { useEffect, useState } from 'react';
import { Link, NavLink, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useSite } from '../context/SiteContext';
import { api } from '../utils/api';
import { useSeo } from '../utils/seo';
import { addDays, day, dayShort, money, time12, todayIso } from '../utils/format';
import ProfileCard from '../components/ProfileCard';
import { Empty, Field, Loading, Photo, Status } from '../components/Common';
import { IconCheck, IconCrown, IconLock } from '../components/Icons';
import { Security as SecurityPanel, TwoStepForm } from '../components/AccountSecurity';


const welcome = (u) => (u.backupCodesLeft != null ? `Signed in with a backup code — ${u.backupCodesLeft} left` : `Welcome back, ${u.firstName}`);
const safeNext = (n) => (n && n.startsWith('/') && !n.startsWith('//') ? n : '/account');

// ---------- signed out ----------
function AuthForms() {
  const { signedIn, toast } = useSite();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [mode, setMode] = useState(params.get('mode') === 'register' ? 'register' : 'login');
  const [form, setForm] = useState({ firstName: '', lastName: '', email: '', phone: '', birthdate: '', password: '', remember: true, terms: false, marketingOptIn: false });
  const [errors, setErrors] = useState(params.get('mfa') === 'restart' ? { _: 'Your new password is saved. Please sign in with it.' } : {});
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);
  const [mfaToken, setMfaToken] = useState(null);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const next = safeNext(params.get('next'));

  const run = async (fn) => {
    setBusy(true);
    setErrors({});
    try { await fn(); } catch (e) { setErrors({ ...(e.details || {}), _: e.message }); } finally { setBusy(false); }
  };
  const login = (e) => {
    e.preventDefault();
    run(async () => {
      const u = await api('POST', '/account/login', { email: form.email, password: form.password, remember: form.remember });
      if (u.mfaRequired) return setMfaToken(u.mfaToken);
      await signedIn(u, `Welcome back, ${u.firstName}`);
      navigate(next, { replace: true });
    });
  };
  const register = (e) => { e.preventDefault(); run(async () => { const r = await api('POST', '/account/register', form); setNotice({ kind: 'verify', email: r.email, devLink: r.devLink }); }); };
  const forgot = (e) => { e.preventDefault(); run(async () => { const r = await api('POST', '/account/forgot-password', { email: form.email }); setNotice({ kind: 'reset', email: form.email, devLink: r.devLink }); }); };
  const resend = () => api('POST', '/account/verify-email/resend', { email: notice.email }).then((r) => { toast('We sent a new link'); if (r.devLink) setNotice({ ...notice, devLink: r.devLink }); });

  if (mfaToken) {
    return (
      <div className="panel">
        <TwoStepForm base="/account" token={mfaToken} onSignedIn={async (u) => { await signedIn(u, welcome(u)); navigate(next, { replace: true }); }}
          onRestart={(msg) => { setMfaToken(null); setForm({ ...form, password: '' }); setErrors(msg ? { _: msg } : {}); }} />
      </div>
    );
  }
  if (notice) {
    return (
      <div className="panel stack">
        <h2>Check your inbox</h2>
        <p className="muted">{notice.kind === 'verify' ? `We sent a confirmation link to ${notice.email}. Open it to activate your account.` : `If ${notice.email} has an account, we sent a link to reset the password.`}</p>
        {notice.devLink && <div className="notice">Email isn’t set up on this server (development). <a href={notice.devLink}>Open the link directly</a>.</div>}
        <div className="row">{notice.kind === 'verify' && <button className="btn btn-ghost" onClick={resend}>Resend link</button>}<button className="link" onClick={() => { setNotice(null); setMode('login'); }}>Back to sign in</button></div>
      </div>
    );
  }
  return (
    <div className="panel">
      <div className="tabs-inline" role="tablist">
        <button role="tab" aria-selected={mode === 'login'} className={mode === 'login' ? 'on' : ''} onClick={() => setMode('login')}>Sign in</button>
        <button role="tab" aria-selected={mode === 'register'} className={mode === 'register' ? 'on' : ''} onClick={() => setMode('register')}>Create account</button>
      </div>
      {mode === 'login' && (
        <form className="stack" onSubmit={login}>
          <Field label="Email" error={errors.email}><input type="email" autoComplete="username" value={form.email} onChange={set('email')} required autoFocus /></Field>
          <Field label="Password" error={errors.password}><input type="password" autoComplete="current-password" value={form.password} onChange={set('password')} required /></Field>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <label className="check"><input type="checkbox" checked={form.remember} onChange={set('remember')} /> Keep me signed in</label>
            <button type="button" className="link" onClick={() => setMode('forgot')}>Forgot password?</button>
          </div>
          {errors._ && !errors.password && <div className="notice error">{errors._}</div>}
          <button className="btn btn-primary btn-lg btn-block" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
          {import.meta.env.DEV && <p className="muted center" style={{ fontSize: '0.82rem', margin: 0 }}>Demo: <button type="button" className="link" onClick={() => setForm({ ...form, email: 'demo@aurelia.example', password: 'password' })}>demo@aurelia.example / password</button></p>}
        </form>
      )}
      {mode === 'register' && (
        <form className="stack" onSubmit={register}>
          <div className="form-grid">
            <Field label="First name" error={errors.firstName} required><input value={form.firstName} onChange={set('firstName')} autoComplete="given-name" required /></Field>
            <Field label="Last name" error={errors.lastName} required><input value={form.lastName} onChange={set('lastName')} autoComplete="family-name" required /></Field>
            <Field label="Email" error={errors.email} required className="span-2"><input type="email" value={form.email} onChange={set('email')} autoComplete="email" required /></Field>
            <Field label="Date of birth" error={errors.birthdate} required hint="Members must be 18 or over"><input type="date" max={addDays(todayIso(), -365 * 18)} value={form.birthdate} onChange={set('birthdate')} required /></Field>
            <Field label="Mobile (optional)" error={errors.phone}><input type="tel" value={form.phone} onChange={set('phone')} autoComplete="tel" /></Field>
            <Field label="Password" error={errors.password} required hint="At least 8 characters" className="span-2"><input type="password" value={form.password} onChange={set('password')} autoComplete="new-password" required /></Field>
          </div>
          <label className="check"><input type="checkbox" checked={form.terms} onChange={set('terms')} /><span>I am 18 or over and accept the <Link to="/pages/terms" target="_blank">terms</Link> and <Link to="/pages/privacy" target="_blank">privacy policy</Link>.</span></label>
          {errors.terms && <small className="field-error">Please confirm to continue.</small>}
          <label className="check"><input type="checkbox" checked={form.marketingOptIn} onChange={set('marketingOptIn')} /><span>Email me about new companions and member offers (optional).</span></label>
          {errors._ && !Object.keys(errors).some((k) => k !== '_') && <div className="notice error">{errors._}</div>}
          <button className="btn btn-primary btn-lg btn-block" disabled={busy}>{busy ? 'Creating…' : 'Create free account'}</button>
        </form>
      )}
      {mode === 'forgot' && (
        <form className="stack" onSubmit={forgot}>
          <p className="muted">Enter your email and we’ll send a link to choose a new password.</p>
          <Field label="Email" error={errors.email}><input type="email" value={form.email} onChange={set('email')} required autoFocus /></Field>
          {errors._ && !errors.email && <div className="notice error">{errors._}</div>}
          <button className="btn btn-primary btn-block" disabled={busy}>Send reset link</button>
          <button type="button" className="link" onClick={() => setMode('login')}>Back to sign in</button>
        </form>
      )}
    </div>
  );
}

function TokenScreen({ kind }) {
  const [params] = useSearchParams();
  const { signedIn, refreshMember } = useSite();
  const navigate = useNavigate();
  const token = params.get('token');
  const [state, setState] = useState(kind === 'verify' ? 'working' : 'form');
  const [error, setError] = useState('');
  const [pw, setPw] = useState({ password: '', confirm: '' });
  const [mfaToken, setMfaToken] = useState(null);
  useEffect(() => {
    if (kind !== 'verify') return;
    api('POST', '/account/verify-email', { token })
      .then(async (u) => { await signedIn(u, 'Email confirmed — welcome!'); navigate('/account', { replace: true }); })
      .catch((e) => { setError(e.message); setState('error'); });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const reset = async (e) => {
    e.preventDefault();
    if (pw.password !== pw.confirm) return setError('The passwords don’t match.');
    try {
      const r = await api('POST', '/account/reset-password', { token, password: pw.password });
      if (r.mfaRequired) return setMfaToken(r.mfaToken);
      await refreshMember();
      navigate('/account', { replace: true });
    } catch (err) { setError(err.message); }
  };
  if (mfaToken) {
    return <TwoStepForm base="/account" token={mfaToken} onSignedIn={async (u) => { await signedIn(u, welcome(u)); navigate('/account', { replace: true }); }}
      onRestart={() => navigate('/account?mfa=restart', { replace: true })} />;
  }
  if (state === 'working') return <Loading text="Confirming your email…" />;
  if (state === 'error') return <div className="panel stack"><h2>Link not valid</h2><div className="notice error">{error}</div><Link to="/account" className="btn btn-primary">Go to sign in</Link></div>;
  return (
    <form className="panel stack" onSubmit={reset}>
      <h2>Choose a new password</h2>
      <Field label="New password" hint="At least 8 characters"><input type="password" value={pw.password} onChange={(e) => setPw({ ...pw, password: e.target.value })} autoComplete="new-password" required autoFocus /></Field>
      <Field label="Confirm password"><input type="password" value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} autoComplete="new-password" required /></Field>
      {error && <div className="notice error">{error}</div>}
      <button className="btn btn-primary btn-block">Save password</button>
    </form>
  );
}

// ---------- signed in ----------
function MemberCard({ m }) {
  return (
    <div className="member-card">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <span className="tier">{m.vipActive ? m.tier.name : 'Member'}</span>
        {m.vipActive ? <IconCrown size={30} style={{ color: '#d4af6a' }} /> : null}
      </div>
      <div>
        <div style={{ fontSize: '1.2rem', fontWeight: 700 }}>{m.fullName}</div>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <span className="no">{m.memberNo}</span>
          <span style={{ fontSize: '0.86rem', opacity: 0.85 }}>{m.vipActive ? `Valid until ${day(m.membershipExpiresOn)}` : m.tier ? `Expired ${day(m.membershipExpiresOn)}` : 'No active membership'}</span>
        </div>
      </div>
    </div>
  );
}

function BookingRow({ b }) {
  return (
    <div className="list-item">
      <Photo src={b.profile.photo} name={b.profile.name} className="" />
      <div style={{ flex: 1, minWidth: 0 }}>
        <strong>{b.profile.name}</strong> <span className="muted">· {b.kind === 'Inquiry' ? 'Inquiry' : b.rateLabel}</span>
        <div className="muted" style={{ fontSize: '0.86rem' }}>{b.date ? `${dayShort(b.date)}${b.time ? `, ${time12(b.time)}` : ''}` : 'No date'} · {b.reference}{b.kind === 'Booking' ? ` · ${money(b.total)}` : ''}</div>
      </div>
      {b.unreadMessages > 0 && <span className="unread-chip">{b.unreadMessages} new {b.unreadMessages === 1 ? 'message' : 'messages'}</span>}
      <Status value={b.status} />
      <Link to={`/booking-status/${b.reference}`} className="btn btn-ghost btn-sm">{b.unreadMessages > 0 ? 'Open chat' : 'Details'}</Link>
    </div>
  );
}

function Overview() {
  const { member } = useSite();
  const [bookings, setBookings] = useState(null);
  useEffect(() => { api('GET', '/account/me/bookings').then(setBookings).catch(() => setBookings([])); }, []);
  const upcoming = (bookings || []).filter((b) => ['Pending', 'Confirmed'].includes(b.status) && (!b.date || b.date >= todayIso()));
  const expiring = member.vipActive && member.membershipExpiresOn <= addDays(todayIso(), 14);
  return (
    <div className="stack" style={{ gap: 22 }}>
      <div className="grid-2">
        <MemberCard m={member} />
        <div className="panel stack">
          <h3 style={{ margin: 0 }}>Hello, {member.firstName}</h3>
          <div className="summary">
            <div className="summary-line"><span>Open bookings</span><span>{member.stats.openBookings}</span></div>
            <div className="summary-line"><span>Favourites</span><span>{member.stats.favorites}</span></div>
            <div className="summary-line"><span>Member since</span><span>{day(member.createdAt)}</span></div>
          </div>
          {member.stats.pendingRequests > 0 && <div className="notice">Your membership request is being checked.</div>}
          {expiring && <div className="notice">Your {member.tier.name} membership ends on {day(member.membershipExpiresOn)}. <Link to="/account/membership">Renew now</Link>.</div>}
          {!member.vipActive && !member.stats.pendingRequests && <Link to="/account/membership" className="btn btn-primary">Unlock VIP access</Link>}
        </div>
      </div>
      <div className="panel">
        <div className="row" style={{ justifyContent: 'space-between' }}><h3 style={{ margin: 0 }}>Upcoming</h3><Link to="/account/bookings">All bookings</Link></div>
        {!bookings ? <Loading /> : upcoming.length ? upcoming.slice(0, 4).map((b) => <BookingRow key={b.reference} b={b} />) : <p className="muted" style={{ margin: '12px 0 0' }}>No upcoming bookings. <Link to="/companions?available=today">See who’s available today</Link>.</p>}
      </div>
    </div>
  );
}

function Bookings() {
  const [bookings, setBookings] = useState(null);
  useEffect(() => { api('GET', '/account/me/bookings').then(setBookings).catch(() => setBookings([])); }, []);
  if (!bookings) return <Loading />;
  return (
    <div className="panel">
      <h2>My bookings</h2>
      {bookings.length ? bookings.map((b) => <BookingRow key={b.reference} b={b} />) : <Empty title="No bookings yet" text="Bookings you make while signed in appear here." action={<Link to="/companions" className="btn btn-primary">Browse companions</Link>} />}
    </div>
  );
}

function FavoritesTab() {
  const [data, setData] = useState(null);
  const { favorites } = useSite();
  useEffect(() => { api('GET', '/account/me/favorites').then(setData).catch(() => setData({ items: [] })); }, [favorites.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!data) return <Loading />;
  return data.items.length ? <div className="grid-cards">{data.items.map((p) => <ProfileCard key={p.id} p={p} />)}</div>
    : <Empty title="No favourites yet" text="Tap the heart on any profile to save it." action={<Link to="/companions" className="btn btn-primary">Browse companions</Link>} />;
}

function Collections() {
  const { slug } = useParams();
  const [list, setList] = useState(null);
  const [one, setOne] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => { api('GET', '/account/me/collections').then(setList).catch(() => setList([])); }, []);
  useEffect(() => {
    setOne(null);
    setError('');
    if (slug) api('GET', `/account/me/collections/${slug}`).then(setOne).catch((e) => setError(e.message));
  }, [slug]);
  if (slug) {
    if (error) return <div className="stack"><div className="notice error">{error}</div><Link to="/account/membership" className="btn btn-primary">See membership options</Link></div>;
    if (!one) return <Loading />;
    return (
      <div>
        <Link to="/account/collections" className="muted">← All collections</Link>
        <h2 style={{ marginTop: 10 }}>{one.title}</h2>
        {one.description && <p className="lead">{one.description}</p>}
        {one.items.length ? <div className="grid-cards">{one.items.map((p) => <ProfileCard key={p.id} p={p} />)}</div> : <Empty title="Coming soon" text="This collection is being curated." />}
      </div>
    );
  }
  if (!list) return <Loading />;
  return (
    <div>
      <h2>VIP collections</h2>
      <div className="grid-2">
        {list.map((c) => (
          <Link key={c.slug} to={c.locked ? '/account/membership' : `/account/collections/${c.slug}`} className="panel" style={{ color: 'var(--text)', display: 'block' }}>
            <div className="row" style={{ justifyContent: 'space-between' }}><h3 style={{ margin: 0 }}>{c.title}</h3>{c.locked ? <IconLock size={20} style={{ color: 'var(--primary)' }} /> : <IconCrown size={20} style={{ color: 'var(--primary)' }} />}</div>
            <p className="muted" style={{ margin: '8px 0' }}>{c.description}</p>
            <span className="vip-chip">{c.locked ? `${c.tierName || 'VIP'} members` : `${c.profileCount} companions`}</span>
          </Link>
        ))}
      </div>
      {!list.length && <Empty title="No collections yet" />}
    </div>
  );
}

function Membership() {
  const { refreshMember, toast } = useSite();
  const [params] = useSearchParams();
  const [data, setData] = useState(null);
  const [form, setForm] = useState({ tierId: Number(params.get('tier')) || '', paymentMethod: '', paymentReference: '', note: '' });
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const load = () => api('GET', '/account/me/membership').then((d) => { setData(d); setForm((f) => ({ ...f, paymentMethod: f.paymentMethod || d.paymentMethods[0] })); });
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  if (!data) return <Loading />;
  const pending = data.history.find((h) => h.status === 'Pending');
  const tier = data.tiers.find((t) => t.id === Number(form.tierId));
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setErrors({});
    try {
      await api('POST', '/account/me/membership', form);
      toast('Request sent — we’ll email you once it’s activated');
      await Promise.all([load(), refreshMember()]);
    } catch (err) { setErrors(err.details || {}); toast(err.message, 'error'); } finally { setBusy(false); }
  };
  const cancel = async () => {
    await api('DELETE', `/account/me/membership/${pending.membershipNo}`);
    toast('Request cancelled');
    await Promise.all([load(), refreshMember()]);
  };
  return (
    <div className="stack" style={{ gap: 22 }}>
      <div className="panel">
        <h2>Membership</h2>
        {data.current?.active
          ? <p className="lead" style={{ margin: 0 }}><IconCrown size={18} style={{ color: 'var(--primary)', verticalAlign: '-3px' }} /> {data.current.tierName} — valid until <strong>{day(data.current.expiresOn)}</strong> ({data.current.daysLeft} day{data.current.daysLeft === 1 ? '' : 's'} left).</p>
          : <p className="lead" style={{ margin: 0 }}>{data.current ? `Your ${data.current.tierName} membership ended on ${day(data.current.expiresOn)}.` : 'You don’t have a membership yet.'}</p>}
      </div>
      {pending ? (
        <div className="panel">
          <h3>Request {pending.membershipNo} is being checked</h3>
          <p className="muted">{pending.kind} · {pending.tierName} · {money(pending.amount)} · {pending.paymentMethod} ref {pending.paymentReference}</p>
          <button className="btn btn-ghost btn-sm" onClick={cancel}>Cancel request</button>
        </div>
      ) : (
        <form className="panel stack" onSubmit={submit}>
          <h3>{data.current?.active ? 'Renew or upgrade' : 'Choose a tier'}</h3>
          <div className="grid-3">
            {data.tiers.map((t) => (
              <button type="button" key={t.id} className={`tier-card ${Number(form.tierId) === t.id ? 'featured' : ''}`} style={{ textAlign: 'left', cursor: 'pointer', color: 'inherit' }} onClick={() => setForm({ ...form, tierId: t.id })} aria-pressed={Number(form.tierId) === t.id}>
                <div className="row"><span className="tier-dot" style={{ background: t.color || 'var(--primary)' }} /><strong style={{ fontSize: '1.2rem' }}>{t.name}</strong><span className="spacer" /><span className="vip-chip">{t.kind}</span></div>
                <div><span className="price" style={{ fontSize: '2rem' }}>{money(t.price)}</span> <span className="muted">/ {t.durationDays} days</span></div>
                <ul>{t.perks.slice(0, 4).map((x) => <li key={x}><IconCheck size={14} />{x}</li>)}</ul>
              </button>
            ))}
          </div>
          {errors.tierId && <small className="field-error">{errors.tierId}</small>}
          {tier && (
            <>
              <div className="notice" style={{ whiteSpace: 'pre-line' }}>{data.instructions}</div>
              <div className="form-grid">
                <Field label="Paid with" error={errors.paymentMethod}><select value={form.paymentMethod} onChange={(e) => setForm({ ...form, paymentMethod: e.target.value })}>{data.paymentMethods.map((m) => <option key={m}>{m}</option>)}</select></Field>
                <Field label="Payment reference" error={errors.paymentReference} required hint="From your receipt or app"><input value={form.paymentReference} onChange={(e) => setForm({ ...form, paymentReference: e.target.value })} required /></Field>
                <Field label="Note (optional)" className="span-2"><input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} /></Field>
              </div>
              <button className="btn btn-primary btn-lg" disabled={busy}>{busy ? 'Sending…' : `Request ${tier.kind.toLowerCase()} — ${money(tier.price)}`}</button>
            </>
          )}
        </form>
      )}
      {data.history.length > 0 && (
        <div className="panel table-wrap">
          <h3>History</h3>
          <table className="table">
            <thead><tr><th>Request</th><th>Tier</th><th>Period</th><th>Amount</th><th>Status</th></tr></thead>
            <tbody>{data.history.map((h) => (
              <tr key={h.membershipNo}><td>{h.membershipNo}<div className="muted" style={{ fontSize: '0.8rem' }}>{h.kind} · {day(h.createdAt)}</div></td><td>{h.tierName}</td>
                <td>{h.startsOn ? `${day(h.startsOn)} – ${day(h.endsOn)}` : '—'}</td><td>{money(h.amount)}</td><td><Status value={h.status} />{h.staffNote && <div className="muted" style={{ fontSize: '0.8rem' }}>{h.staffNote}</div>}</td></tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Profile() {
  const { member, setMember, toast } = useSite();
  const [form, setForm] = useState({ firstName: member.firstName, lastName: member.lastName, phone: member.phone || '', marketingOptIn: member.marketingOptIn });
  const [errors, setErrors] = useState({});
  const save = async (e) => {
    e.preventDefault();
    try { setMember(await api('PUT', '/account/me', form)); toast('Details saved'); setErrors({}); } catch (err) { setErrors(err.details || {}); toast(err.message, 'error'); }
  };
  return (
    <form className="panel stack" onSubmit={save}>
      <h2>My details</h2>
      <div className="form-grid">
        <Field label="First name" error={errors.firstName}><input value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} /></Field>
        <Field label="Last name" error={errors.lastName}><input value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} /></Field>
        <Field label="Email" hint="Contact us to change your email"><input value={member.email} disabled /></Field>
        <Field label="Mobile" error={errors.phone}><input type="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></Field>
      </div>
      <label className="check"><input type="checkbox" checked={form.marketingOptIn} onChange={(e) => setForm({ ...form, marketingOptIn: e.target.checked })} /> Email me about new companions and member offers</label>
      <div><button className="btn btn-primary">Save</button></div>
    </form>
  );
}

const MemberSecurity = () => <SecurityPanel base="/account" />;

const TABS = [['', 'Overview'], ['bookings', 'Bookings'], ['favorites', 'Favourites'], ['collections', 'VIP collections'], ['membership', 'Membership'], ['profile', 'My details'], ['security', 'Security']];

export default function Account() {
  const { tab = '' } = useParams();
  const { member, authReady, logout } = useSite();
  useSeo({ title: 'My account', noindex: true });
  if (!authReady) return <Loading />;
  if (tab === 'verify-email' || tab === 'reset-password') {
    return <div className="auth-wrap"><div className="auth-card"><TokenScreen kind={tab === 'verify-email' ? 'verify' : 'reset'} /></div></div>;
  }
  if (!member) {
    return (
      <div className="auth-wrap">
        <div className="auth-card">
          <div className="center" style={{ marginBottom: 20 }}><span className="kicker">Members</span><h1 style={{ fontSize: '2.6rem' }}>Your account</h1><p className="muted">Keep favourites on every device, track bookings and unlock VIP access.</p></div>
          <AuthForms />
        </div>
      </div>
    );
  }
  const View = { '': Overview, bookings: Bookings, favorites: FavoritesTab, collections: Collections, membership: Membership, profile: Profile, security: MemberSecurity }[tab] || Overview;
  return (
    <div className="container account">
      <nav className="account-nav" aria-label="Account">
        {TABS.map(([k, label]) => <NavLink key={k} to={`/account${k ? `/${k}` : ''}`} end={!k}>{label}</NavLink>)}
        <button className="link" style={{ textAlign: 'left', padding: '10px 14px' }} onClick={logout}>Sign out</button>
      </nav>
      <div><View /></div>
    </div>
  );
}
