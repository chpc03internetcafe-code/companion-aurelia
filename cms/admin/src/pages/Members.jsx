import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, qs } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useUi } from '../lib/ui';
import { useLiveRefresh } from '../lib/notifications';
import { dateTime, day, money } from '../lib/format';
import { Empty, ErrorBox, Field, Loading, Modal, PageHead, Pager, Pill, SearchBox, Stats, Tabs, Toggle, useAction, useForm, useLoad, useQueryState } from '../components/kit';

export function DecideModal({ ms, approve, onClose, onDone }) {
  const [form, setForm] = useState({ staffNote: '', startsOn: '', notify: true });
  const [run, busy] = useAction();
  const go = async () => {
    const r = await run(() => api.post(`/members/memberships/${ms.id}/${approve ? 'approve' : 'reject'}`, { ...form, startsOn: form.startsOn || undefined }), approve ? 'Membership activated' : 'Request rejected');
    if (r) onDone(r);
  };
  return (
    <Modal title={`${approve ? 'Approve' : 'Reject'} ${ms.membershipNo}`} onClose={onClose} footer={<><button className="btn btn-ghost" onClick={onClose}>Back</button><button className={`btn ${approve ? 'btn-primary' : 'btn-danger'}`} onClick={go} disabled={busy || (!approve && !form.staffNote.trim())}>{approve ? 'Activate membership' : 'Reject request'}</button></>}>
      <div className="stack">
        <p>{ms.memberName} · {ms.kind} · <strong>{ms.tierName}</strong> · {money(ms.amount)} via {ms.paymentMethod || '—'} (ref <code>{ms.paymentReference || '—'}</code>)</p>
        {ms.memberNote && <p className="muted">“{ms.memberNote}”</p>}
        {approve && <Field label="Start date (optional)" hint="Blank = today, or the day after the current expiry for a renewal"><input type="date" value={form.startsOn} onChange={(e) => setForm({ ...form, startsOn: e.target.value })} /></Field>}
        <Field label={approve ? 'Note to the member (optional)' : 'Reason (sent to the member)'} required={!approve}><textarea rows={3} value={form.staffNote} onChange={(e) => setForm({ ...form, staffNote: e.target.value })} placeholder={approve ? '' : 'We couldn’t find a payment with that reference.'} /></Field>
        <Toggle checked={form.notify} onChange={(v) => setForm({ ...form, notify: v })} label="Email the member" />
      </div>
    </Modal>
  );
}

function Requests() {
  const { can } = useAuth();
  const manage = can('members', 'manage');
  const [status, setStatus] = useState('Pending');
  const { data, loading, error, reload } = useLoad(() => api.get('/members/memberships', { status }), [status]);
  useLiveRefresh('members', () => reload(true));
  const [decide, setDecide] = useState(null);
  return (
    <div className="card">
      <div className="filters">
        <div className="seg">{['Pending', 'Active', 'Expired', 'Rejected', 'Cancelled'].map((s) => <button key={s} className={status === s ? 'on' : ''} onClick={() => setStatus(s)}>{s}</button>)}</div>
      </div>
      <ErrorBox error={error} onRetry={reload} />
      {loading && !data ? <Loading /> : data?.length ? (
        <table className="table">
          <thead><tr><th>Request</th><th>Member</th><th>Tier</th><th>Payment</th><th>{status === 'Pending' ? '' : 'Period'}</th></tr></thead>
          <tbody>{data.map((ms) => (
            <tr key={ms.id}>
              <td><strong>{ms.membershipNo}</strong><span className="sub">{ms.kind} · {dateTime(ms.createdAt)}</span></td>
              <td><Link to={`/members/${ms.memberId}`}>{ms.memberName}</Link><span className="sub">{ms.memberNo} · {ms.memberEmail}</span></td>
              <td>{ms.tierName}<span className="sub">{ms.durationDays} days</span></td>
              <td>{money(ms.amount)}<span className="sub">{ms.paymentMethod || '—'}{ms.paymentReference ? ` · ${ms.paymentReference}` : ''}</span></td>
              <td className="actions nowrap">
                {status === 'Pending' && manage ? <><button className="btn btn-sm btn-primary" onClick={() => setDecide({ ms, approve: true })}>Approve</button> <button className="btn btn-sm btn-danger-ghost" onClick={() => setDecide({ ms, approve: false })}>Reject</button></>
                  : ms.startsOn ? `${day(ms.startsOn)} – ${day(ms.endsOn)}` : <span className="muted">{ms.staffNote || '—'}</span>}
              </td>
            </tr>
          ))}</tbody>
        </table>
      ) : <Empty icon="♛" title={status === 'Pending' ? 'No requests waiting' : 'Nothing here'} />}
      {decide && <DecideModal ms={decide.ms} approve={decide.approve} onClose={() => setDecide(null)} onDone={() => { setDecide(null); reload(true); }} />}
    </div>
  );
}

function NewMember({ onClose, onSaved }) {
  const { form, set, errors, saving, submit } = useForm({ firstName: '', lastName: '', email: '', phone: '', birthdate: '', status: 'Active', marketingOptIn: false, notes: '' });
  const save = () => submit(async (f) => onSaved(await api.post('/members', f)), 'Member added');
  return (
    <Modal title="Add member" onClose={onClose} footer={<><button className="btn btn-ghost" onClick={onClose}>Cancel</button><button className="btn btn-primary" onClick={save} disabled={saving}>Add</button></>}>
      <div className="form-grid">
        <Field label="First name" error={errors.firstName} required><input value={form.firstName} onChange={set('firstName')} /></Field>
        <Field label="Last name" error={errors.lastName} required><input value={form.lastName} onChange={set('lastName')} /></Field>
        <Field label="Email" error={errors.email} required className="span-2"><input type="email" value={form.email} onChange={set('email')} /></Field>
        <Field label="Phone" error={errors.phone}><input value={form.phone} onChange={set('phone')} /></Field>
        <Field label="Date of birth" error={errors.birthdate}><input type="date" value={form.birthdate} onChange={set('birthdate')} /></Field>
        <Field label="Notes (staff only)" className="span-2"><textarea rows={2} value={form.notes} onChange={set('notes')} /></Field>
      </div>
      <p className="muted" style={{ marginTop: 10 }}>They can set a password with “Send password link” on their record.</p>
    </Modal>
  );
}

function List() {
  const { meta, toast } = useUi();
  const { can } = useAuth();
  const navigate = useNavigate();
  const manage = can('members', 'manage');
  const [q, setQ] = useQueryState({ search: '', status: '', vip: '', tierId: '', page: 1, pageSize: 25 });
  const filters = { search: q.search, status: q.status, vip: q.vip, tierId: q.tierId };
  const { data, loading, error, reload } = useLoad(() => api.get('/members', { ...filters, page: q.page, pageSize: q.pageSize }), [JSON.stringify(q)]);
  const stats = useLoad(() => api.get('/members/stats'), []);
  const [adding, setAdding] = useState(false);
  const [run, busy] = useAction();
  const s = stats.data;
  const remind = async () => {
    const r = await run(() => api.post('/members/remind', { days: 7 }));
    if (r) toast(`Reminders sent to ${r.sent} of ${r.due} member(s) expiring within 7 days`);
  };
  return (
    <>
      {s && <Stats items={[
        { label: 'Members', value: s.total, onClick: () => setQ({ vip: '' }), active: !q.vip },
        { label: 'Active VIP', value: s.vipActive, onClick: () => setQ({ vip: 'active' }), active: q.vip === 'active' },
        { label: 'Expiring in 14 days', value: s.expiring, tone: s.expiring ? 'warn' : '', onClick: () => setQ({ vip: 'expiring' }), active: q.vip === 'expiring' },
        { label: 'Requests waiting', value: s.pending, tone: s.pending ? 'warn' : '', onClick: () => setQ({ vip: 'pending' }), active: q.vip === 'pending' },
        { label: 'New (30 days)', value: s.new30d },
      ]} />}
      <div className="card">
        <div className="filters">
          <SearchBox value={q.search} onChange={(search) => setQ({ search })} placeholder="Name, email, member no., phone…" />
          <select value={q.vip} onChange={(e) => setQ({ vip: e.target.value })} aria-label="Membership"><option value="">Any membership</option><option value="active">Active VIP</option><option value="none">No active membership</option><option value="expiring">Expiring in 14 days</option><option value="pending">Request waiting</option></select>
          <select value={q.tierId} onChange={(e) => setQ({ tierId: e.target.value })} aria-label="Tier"><option value="">All tiers</option>{meta.tiers.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select>
          <select value={q.status} onChange={(e) => setQ({ status: e.target.value })} aria-label="Status"><option value="">Active & suspended</option><option>Active</option><option>Suspended</option></select>
          <span className="spacer" />
          <a className="btn btn-sm btn-ghost" href={`/api/members/export${qs(filters)}`}>Export CSV</a>
          {manage && <button className="btn btn-sm btn-ghost" disabled={busy} onClick={remind} title="Emails members whose membership ends within 7 days">Send renewal reminders</button>}
          {manage && <button className="btn btn-sm btn-primary" onClick={() => setAdding(true)}>+ Add member</button>}
        </div>
        <ErrorBox error={error} onRetry={reload} />
        {loading && !data ? <Loading /> : data?.items.length ? (
          <table className="table">
            <thead><tr><th>Member</th><th>Membership</th><th className="hide-sm">Bookings</th><th className="hide-sm">Last sign-in</th><th>Status</th></tr></thead>
            <tbody>{data.items.map((m) => (
              <tr key={m.id} className="clickable" onClick={() => navigate(`/members/${m.id}`)}>
                <td><strong>{m.fullName}</strong><span className="sub">{m.memberNo} · {m.email}{!m.emailVerifiedAt ? ' · not activated' : ''}</span></td>
                <td>{m.vipActive ? <><Pill tone="violet">{m.tierName}</Pill><span className="sub">until {day(m.membershipExpiresOn)}</span></> : m.tierName ? <><Pill tone="grey">{m.tierName} expired</Pill><span className="sub">{day(m.membershipExpiresOn)}</span></> : <span className="muted">—</span>}
                  {m.pendingRequests > 0 && <> <Pill tone="amber">Request</Pill></>}</td>
                <td className="hide-sm">{m.bookingCount}</td>
                <td className="hide-sm">{m.lastLoginAt ? dateTime(m.lastLoginAt) : <span className="muted">Never</span>}</td>
                <td><Pill>{m.status}</Pill></td>
              </tr>
            ))}</tbody>
          </table>
        ) : <Empty icon="♛" title="No members" text="Nothing matches these filters." />}
        {data && <Pager page={q.page} pageSize={q.pageSize} total={data.total} onChange={setQ} />}
      </div>
      {adding && <NewMember onClose={() => setAdding(false)} onSaved={(m) => { setAdding(false); navigate(`/members/${m.id}`); }} />}
    </>
  );
}

export default function Members() {
  const [q, setQ] = useQueryState({ tab: 'members' });
  const stats = useLoad(() => api.get('/members/stats'), []);
  return (
    <>
      <PageHead title="Members" subtitle="VIP portal accounts, memberships, renewals and requests waiting for approval." />
      <Tabs tabs={[['members', 'Members'], ['requests', 'Membership requests', stats.data?.pending]]} value={q.tab} onChange={(tab) => setQ({ tab })} />
      {q.tab === 'requests' ? <Requests /> : <List />}
    </>
  );
}
