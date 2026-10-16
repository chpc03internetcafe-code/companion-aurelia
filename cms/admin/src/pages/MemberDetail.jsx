import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useUi } from '../lib/ui';
import { dateTime, day, money, time12 } from '../lib/format';
import { ErrorBox, Field, KeyVals, Loading, Modal, PageHead, Pill, Toggle, useAction, useForm, useLoad } from '../components/kit';
import { DecideModal } from './Members';

function EditMember({ m, onClose, onSaved }) {
  const { form, set, setForm, errors, saving, submit } = useForm({ firstName: m.firstName, lastName: m.lastName, email: m.email, phone: m.phone || '', birthdate: m.birthdate || '', status: m.status, marketingOptIn: m.marketingOptIn, notes: m.notes || '' });
  const save = () => submit(async (f) => onSaved(await api.put(`/members/${m.id}`, { ...f, birthdate: f.birthdate || null })), 'Member saved');
  return (
    <Modal title={`Edit ${m.fullName}`} onClose={onClose} footer={<><button className="btn btn-ghost" onClick={onClose}>Cancel</button><button className="btn btn-primary" onClick={save} disabled={saving}>Save</button></>}>
      <div className="form-grid">
        <Field label="First name" error={errors.firstName}><input value={form.firstName} onChange={set('firstName')} /></Field>
        <Field label="Last name" error={errors.lastName}><input value={form.lastName} onChange={set('lastName')} /></Field>
        <Field label="Email" error={errors.email} className="span-2"><input value={form.email} onChange={set('email')} /></Field>
        <Field label="Phone" error={errors.phone}><input value={form.phone} onChange={set('phone')} /></Field>
        <Field label="Date of birth" error={errors.birthdate}><input type="date" value={form.birthdate} onChange={set('birthdate')} /></Field>
        <Field label="Notes (staff only)" className="span-2"><textarea rows={3} value={form.notes} onChange={set('notes')} /></Field>
        <div className="span-2 stack">
          <Toggle checked={form.status === 'Active'} onChange={(v) => setForm({ ...form, status: v ? 'Active' : 'Suspended' })} label="Account active" hint="Suspended members are signed out and can’t sign in" />
          <Toggle checked={form.marketingOptIn} onChange={(v) => setForm({ ...form, marketingOptIn: v })} label="Agreed to marketing emails" />
        </div>
      </div>
    </Modal>
  );
}

function Grant({ m, onClose, onSaved }) {
  const { meta } = useUi();
  const { form, set, setForm, errors, saving, submit } = useForm({ tierId: m.tierId || meta.tiers.find((t) => t.isActive)?.id || '', startsOn: '', days: '', amount: '', paymentMethod: '', paymentReference: '', staffNote: '', notify: true });
  const tier = meta.tiers.find((t) => t.id === Number(form.tierId));
  const save = () => submit(async (f) => onSaved(await api.post(`/members/${m.id}/grant`, { ...f, days: f.days || null, amount: f.amount === '' ? null : f.amount, startsOn: f.startsOn || null, paymentMethod: f.paymentMethod || null })), 'Membership granted');
  return (
    <Modal title="Grant or renew membership" onClose={onClose} footer={<><button className="btn btn-ghost" onClick={onClose}>Cancel</button><button className="btn btn-primary" onClick={save} disabled={saving}>Grant</button></>}>
      <div className="form-grid">
        <Field label="Tier" error={errors.tierId} required><select value={form.tierId} onChange={set('tierId')}>{meta.tiers.filter((t) => t.isActive).map((t) => <option key={t.id} value={t.id}>{t.name} · {money(t.price, true)} / {t.durationDays} days</option>)}</select></Field>
        <Field label="Length (days)" error={errors.days} hint={tier ? `Blank = ${tier.durationDays}` : ''}><input type="number" min={1} value={form.days} onChange={set('days')} /></Field>
        <Field label="Start date" error={errors.startsOn} hint="Blank = today (or after the current expiry for the same tier)"><input type="date" value={form.startsOn} onChange={set('startsOn')} /></Field>
        <Field label="Amount paid" error={errors.amount} hint="0 for complimentary"><input type="number" min={0} value={form.amount} onChange={set('amount')} placeholder={tier ? String(tier.price) : ''} /></Field>
        <Field label="Paid with"><select value={form.paymentMethod} onChange={set('paymentMethod')}><option value="">—</option>{meta.paymentMethods.map((x) => <option key={x}>{x}</option>)}</select></Field>
        <Field label="Payment reference"><input value={form.paymentReference} onChange={set('paymentReference')} /></Field>
        <Field label="Note to the member" className="span-2"><input value={form.staffNote} onChange={set('staffNote')} /></Field>
        <div className="span-2"><Toggle checked={form.notify} onChange={(v) => setForm({ ...form, notify: v })} label="Email the member" /></div>
      </div>
    </Modal>
  );
}

export default function MemberDetail() {
  const { id } = useParams();
  const { can } = useAuth();
  const { prompt, toast, confirm } = useUi();
  const manage = can('members', 'manage');
  const { data: m, loading, error, reload, setData } = useLoad(() => api.get(`/members/${id}`), [id]);
  const [modal, setModal] = useState(null);
  const [run, busy] = useAction();
  if (loading && !m) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  const pending = m.memberships.filter((x) => x.status === 'Pending');
  const sendLink = async () => {
    const r = await run(() => api.post(`/members/${m.id}/password-reset`));
    if (r) r.sent ? toast('Password link emailed') : r.link ? prompt({ title: 'Email is not set up', message: 'Copy this link and send it to the member securely:', defaultValue: r.link, confirmLabel: 'Done' }) : toast('Email is not set up', 'error');
  };
  const resetTwoStep = async () => {
    const ok = await confirm({ title: `Turn off two-step sign-in for ${m.fullName}?`, message: 'Only do this after confirming who you’re talking to (e.g. a call back on their registered number). They’ll be signed out everywhere and can sign in with just their password, then set it up again.', confirmLabel: 'Reset two-step', danger: true });
    if (!ok) return;
    const r = await run(() => api.post(`/members/${m.id}/two-step/reset`), 'Two-step sign-in turned off');
    if (r) setData(r);
  };
  const endMembership = async () => {
    const reason = await prompt({ title: `End ${m.fullName}’s membership today?`, label: 'Reason (internal)', confirmLabel: 'End membership' });
    if (reason === null) return;
    const r = await run(() => api.post(`/members/${m.id}/end-membership`, { reason }), 'Membership ended');
    if (r) setData(r);
  };
  return (
    <>
      <PageHead back={['Members', '/members']} title={<>{m.fullName} <Pill>{m.status}</Pill> {m.vipActive && <Pill tone="violet">{m.tierName}</Pill>}</>}
        subtitle={`${m.memberNo} · joined ${day(m.createdAt)}${m.lastLoginAt ? ` · last sign-in ${dateTime(m.lastLoginAt)}` : ''}`}
        actions={manage && <>
          <button className="btn btn-primary" onClick={() => setModal('grant')}>Grant / renew</button>
          {m.vipActive && <button className="btn btn-danger-ghost" onClick={endMembership} disabled={busy}>End membership</button>}
          <button className="btn btn-ghost" onClick={sendLink} disabled={busy || m.status !== 'Active'}>Send password link</button>
          {m.sessions.length > 0 && <button className="btn btn-ghost" disabled={busy} onClick={async () => { if (await confirm({ title: 'Sign out all devices?', confirmLabel: 'Sign out' })) { const r = await run(() => api.post(`/members/${m.id}/sessions`), 'Signed out everywhere'); if (r) setData(r); } }}>Sign out devices</button>}
          {m.twoStepSince && <button className="btn btn-ghost" disabled={busy} onClick={resetTwoStep}>Reset two-step</button>}
          <button className="btn btn-ghost" onClick={() => setModal('edit')}>Edit</button>
        </>} />
      {pending.map((ms) => (
        <div key={ms.id} className="banner-info row">
          <span><strong>{ms.kind} request {ms.membershipNo}</strong> · {ms.tierName} · {money(ms.amount)} via {ms.paymentMethod} (ref {ms.paymentReference}) · {dateTime(ms.createdAt)}</span>
          <span className="spacer" />
          {manage && <><button className="btn btn-sm btn-primary" onClick={() => setModal({ ms, approve: true })}>Approve</button><button className="btn btn-sm btn-danger-ghost" onClick={() => setModal({ ms, approve: false })}>Reject</button></>}
        </div>
      ))}
      <div className="split">
        <div className="stack">
          <div className="card">
            <div className="card-head"><h2>Memberships</h2></div>
            {m.memberships.length ? (
              <table className="table">
                <thead><tr><th>Request</th><th>Tier</th><th>Period</th><th>Payment</th><th>Status</th></tr></thead>
                <tbody>{m.memberships.map((ms) => (
                  <tr key={ms.id}>
                    <td>{ms.membershipNo}<span className="sub">{ms.kind} · {day(ms.createdAt)}{ms.decidedBy ? ` · by ${ms.decidedBy}` : ''}</span></td>
                    <td>{ms.tierName}</td>
                    <td>{ms.startsOn ? `${day(ms.startsOn)} – ${day(ms.endsOn)}` : '—'}</td>
                    <td>{money(ms.amount)}<span className="sub">{ms.paymentMethod || ''}{ms.paymentReference ? ` · ${ms.paymentReference}` : ''}</span></td>
                    <td><Pill>{ms.status}</Pill>{ms.staffNote && <span className="sub">{ms.staffNote}</span>}</td>
                  </tr>
                ))}</tbody>
              </table>
            ) : <div className="card-body muted">No memberships yet.</div>}
          </div>
          <div className="card">
            <div className="card-head"><h2>Bookings</h2>{can('bookings') && <Link to={`/bookings?memberId=${m.id}&status=`}>All →</Link>}</div>
            {m.bookings.length ? (
              <table className="table">
                <tbody>{m.bookings.map((b) => (
                  <tr key={b.id}>
                    <td><Link to={`/bookings/${b.id}`}>{b.reference}</Link><span className="sub">{b.kind}</span></td>
                    <td>{b.profileName}<span className="sub">{b.rateLabel || ''}</span></td>
                    <td>{b.bookingDate ? `${day(b.bookingDate)} ${time12(b.startTime)}` : '—'}</td>
                    <td><Pill>{b.status}</Pill></td>
                  </tr>
                ))}</tbody>
              </table>
            ) : <div className="card-body muted">No bookings made while signed in.</div>}
          </div>
        </div>
        <div className="stack">
          <div className="card card-pad">
            <KeyVals rows={[['Email', m.email], ['Email confirmed', m.emailVerifiedAt ? dateTime(m.emailVerifiedAt) : 'Not yet'], ['Phone', m.phone], ['Date of birth', m.birthdate ? day(m.birthdate) : null],
              ['Terms accepted', m.termsAcceptedAt ? dateTime(m.termsAcceptedAt) : null], ['Marketing emails', m.marketingOptIn ? 'Yes' : 'No'], ['Two-step sign-in', m.twoStepSince ? `On since ${day(m.twoStepSince)}` : 'Off'],
              ['Current tier', m.tierName ? `${m.tierName}${m.vipActive ? ` until ${day(m.membershipExpiresOn)}` : ` — expired ${day(m.membershipExpiresOn)}`}` : 'None']]} />
            {m.notes && <><div className="section-title">Notes</div><p style={{ whiteSpace: 'pre-wrap' }}>{m.notes}</p></>}
          </div>
          <div className="card card-pad">
            <div className="section-title" style={{ marginTop: 0 }}>Favourites</div>
            {m.favorites.length ? <div className="chips">{m.favorites.map((f) => <Link key={f.id} to={`/profiles/${f.id}`} className="chip">{f.displayName}</Link>)}</div> : <p className="muted">None</p>}
          </div>
          <div className="card card-pad">
            <div className="section-title" style={{ marginTop: 0 }}>Signed-in devices</div>
            {m.sessions.length ? m.sessions.map((s) => <p key={s.id} style={{ margin: '0 0 8px' }}><span className="muted">{(s.userAgent || 'Unknown device').slice(0, 70)}</span><br />last active {dateTime(s.lastSeenAt)}{s.ipAddress ? ` · ${s.ipAddress}` : ''}</p>) : <p className="muted">Not signed in anywhere.</p>}
          </div>
        </div>
      </div>
      {modal === 'edit' && <EditMember m={m} onClose={() => setModal(null)} onSaved={(r) => { setModal(null); setData(r); }} />}
      {modal === 'grant' && <Grant m={m} onClose={() => setModal(null)} onSaved={(r) => { setModal(null); setData(r); }} />}
      {modal?.ms && <DecideModal ms={modal.ms} approve={modal.approve} onClose={() => setModal(null)} onDone={(r) => { setModal(null); setData(r); }} />}
    </>
  );
}
