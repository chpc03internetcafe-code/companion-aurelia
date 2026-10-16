import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useUi } from '../lib/ui';
import { useLiveRefresh } from '../lib/notifications';
import { dateTime, dayLong, duration, money, time12 } from '../lib/format';
import { ErrorBox, Field, KeyVals, Loading, Modal, PageHead, Pill, Thumb, Toggle, useAction, useForm, useLoad } from '../components/kit';
import { SlotPicker } from './Bookings';

const ACTION = {
  Confirmed: ['Confirm', 'btn-primary'], Declined: ['Decline', 'btn-danger-ghost'], Cancelled: ['Cancel booking', 'btn-danger-ghost'], Completed: ['Mark completed', 'btn-primary'],
  'No-Show': ['No-show', 'btn-ghost'], Pending: ['Reopen', 'btn-ghost'], Answered: ['Mark answered', 'btn-primary'], Closed: ['Close', 'btn-ghost'],
};

function StatusModal({ b, status, onClose, onDone }) {
  const [form, setForm] = useState({ note: '', reason: '', notify: !['No-Show', 'Pending', 'Closed'].includes(status) });
  const [run, busy] = useAction();
  const needsReason = ['Cancelled', 'Declined'].includes(status);
  const go = async () => { const r = await run(() => api.post(`/bookings/${b.id}/status`, { status, ...form }), `${b.reference}: ${status}`); if (r) onDone(r); };
  return (
    <Modal title={`${ACTION[status][0]} — ${b.reference}`} onClose={onClose} footer={<><button className="btn btn-ghost" onClick={onClose}>Back</button><button className={`btn ${needsReason ? 'btn-danger' : 'btn-primary'}`} onClick={go} disabled={busy}>{ACTION[status][0]}</button></>}>
      <div className="stack">
        {needsReason && <Field label="Reason" hint="Shown to the client"><input value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} placeholder={status === 'Declined' ? 'Companion unavailable at that time' : 'Change of plans'} /></Field>}
        <Field label="Message to the client (optional)" hint="Added to the status page and the email"><textarea rows={3} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} /></Field>
        <Toggle checked={form.notify} onChange={(v) => setForm({ ...form, notify: v })} label="Email the client" />
      </div>
    </Modal>
  );
}

function RescheduleModal({ b, onClose, onDone }) {
  const profiles = useLoad(() => api.get('/profiles/options'), []);
  const rates = profiles.data?.find((p) => p.id === b.profileId)?.rates || [];
  const [form, setForm] = useState({ date: b.bookingDate, time: '', rateId: b.rateId || '', note: '', notify: true, force: false, manual: false });
  const [run, busy] = useAction();
  const go = async () => { const r = await run(() => api.post(`/bookings/${b.id}/reschedule`, { ...form, rateId: form.rateId || null }), 'Booking moved'); if (r) onDone(r); };
  const rate = rates.find((r) => r.id === Number(form.rateId));
  return (
    <Modal title={`Reschedule ${b.reference}`} size="wide" onClose={onClose} footer={<><button className="btn btn-ghost" onClick={onClose}>Back</button><button className="btn btn-primary" onClick={go} disabled={busy || !form.date || !form.time}>Move booking</button></>}>
      <div className="stack">
        <p className="muted">Now: {dayLong(b.bookingDate)}, {time12(b.startTime)} – {time12(b.endTime)} · {b.rateLabel}</p>
        {rates.length > 0 && <Field label="Session"><select value={form.rateId} onChange={(e) => setForm({ ...form, rateId: e.target.value, time: '' })}>{!rates.some((r) => r.id === b.rateId) && <option value="">{b.rateLabel} (current)</option>}{rates.map((r) => <option key={r.id} value={r.id}>{r.label} · {duration(r.durationMinutes)} · {money(r.price, true)}</option>)}</select></Field>}
        <Toggle checked={form.manual} onChange={(v) => setForm({ ...form, manual: v, force: v })} label="Ignore availability (staff override)" hint="Still never overlaps another booking" />
        {form.manual ? (
          <div className="form-grid"><Field label="Date"><input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></Field><Field label="Start"><input type="time" value={form.time} onChange={(e) => setForm({ ...form, time: e.target.value })} /></Field></div>
        ) : <SlotPicker profileId={b.profileId} rateId={form.rateId || undefined} duration={form.rateId ? undefined : b.durationMinutes} exclude={b.id} date={form.date} time={form.time} onChange={(x) => setForm({ ...form, ...x })} />}
        {rate && rate.id !== b.rateId && <div className="banner-info">The price changes to {money(rate.price)} plus fees.</div>}
        <Field label="Message to the client (optional)"><input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} /></Field>
        <Toggle checked={form.notify} onChange={(v) => setForm({ ...form, notify: v })} label="Email the client the new time" />
      </div>
    </Modal>
  );
}

function EditModal({ b, onClose, onDone }) {
  const { meta } = useUi();
  const { form, set, errors, saving, submit } = useForm({ clientName: b.clientName, clientEmail: b.clientEmail, clientPhone: b.clientPhone || '', preferredContact: b.preferredContact || 'Email',
    locationId: b.locationId || '', meetingPlace: b.meetingPlace || '', clientNotes: b.clientNotes || '', staffNotes: b.staffNotes || '' });
  const save = () => submit(async (f) => onDone(await api.put(`/bookings/${b.id}`, { ...f, locationId: f.locationId || null })), 'Saved');
  return (
    <Modal title="Edit details" onClose={onClose} footer={<><button className="btn btn-ghost" onClick={onClose}>Cancel</button><button className="btn btn-primary" onClick={save} disabled={saving}>Save</button></>}>
      <div className="form-grid">
        <Field label="Client name" error={errors.clientName}><input value={form.clientName} onChange={set('clientName')} /></Field>
        <Field label="Email" error={errors.clientEmail}><input value={form.clientEmail} onChange={set('clientEmail')} /></Field>
        <Field label="Phone" error={errors.clientPhone}><input value={form.clientPhone} onChange={set('clientPhone')} /></Field>
        <Field label="Contact by"><select value={form.preferredContact} onChange={set('preferredContact')}>{meta.contactMethods.map((m) => <option key={m}>{m}</option>)}</select></Field>
        <Field label="Meeting area"><select value={form.locationId} onChange={set('locationId')}><option value="">—</option>{meta.locations.map((l) => <option key={l.id} value={l.id}>{l.parentId ? `${l.parentName} — ${l.name}` : l.name}</option>)}</select></Field>
        <Field label="Venue"><input value={form.meetingPlace} onChange={set('meetingPlace')} /></Field>
        <Field label="Client notes" className="span-2"><textarea rows={2} value={form.clientNotes} onChange={set('clientNotes')} /></Field>
        <Field label="Staff notes (internal)" className="span-2"><textarea rows={3} value={form.staffNotes} onChange={set('staffNotes')} /></Field>
      </div>
    </Modal>
  );
}

// The client ↔ companion chat. Staff read it and can step in as the concierge (both sides see it).
function ChatCard({ b, manage, onSent }) {
  const [text, setText] = useState('');
  const [run, busy] = useAction();
  const listRef = useRef(null);
  const c = b.chat;
  useEffect(() => { if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight; }, [c.messages.length]);
  const send = async () => {
    const r = await run(() => api.post(`/bookings/${b.id}/messages`, { body: text }), 'Message sent');
    if (r) { onSent(r); setText(''); }
  };
  return (
    <div className="card card-pad">
      <div className="section-title" style={{ marginTop: 0 }}>Client ↔ companion chat {c.open ? <Pill tone="green">Open</Pill> : <Pill tone="grey">Closed</Pill>}</div>
      <div className="chat-list" ref={listRef}>
        {c.messages.length ? c.messages.map((m) => (
          <div key={m.id} className={`chat-msg ${m.sender.toLowerCase()}`}>
            <div className="chat-bubble">{m.body}</div>
            <small>{m.name} · {dateTime(m.at)}</small>
          </div>
        )) : <p className="muted" style={{ margin: 0 }}>{c.open ? 'No messages yet.' : c.note}</p>}
      </div>
      {manage && (
        <div className="stack" style={{ marginTop: 10 }}>
          <textarea rows={2} maxLength={2000} placeholder="Write as the concierge (the client and the companion both see it)…" value={text} onChange={(e) => setText(e.target.value)} aria-label="Concierge message" />
          <div className="row"><span className="muted" style={{ fontSize: 12 }}>The client and companion are emailed about new messages.</span><span className="spacer" /><button className="btn btn-sm btn-primary" disabled={!text.trim() || busy} onClick={send}>Send</button></div>
        </div>
      )}
    </div>
  );
}

export default function BookingDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { can } = useAuth();
  const { confirm, meta } = useUi();
  const manage = can('bookings', 'manage');
  const { data: b, loading, error, reload, setData } = useLoad(() => api.get(`/bookings/${id}`), [id]);
  useLiveRefresh('bookings', () => reload(true));
  // chat messages don't raise staff notifications, so look for new ones while an open chat is on screen
  const chatOpen = !!b?.chat?.open;
  useEffect(() => {
    if (!chatOpen) return undefined;
    const t = setInterval(() => { if (document.visibilityState === 'visible') reload(true); }, 15000);
    return () => clearInterval(t);
  }, [chatOpen, reload]);
  const [modal, setModal] = useState(null);
  const [msg, setMsg] = useState({ note: '', visible: true, notify: true });
  const [run, busy] = useAction();
  if (loading && !b) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  const done = (r) => { setModal(null); setData(r); };
  const sendMsg = async () => {
    const r = await run(() => api.post(`/bookings/${b.id}/notes`, msg), msg.visible ? 'Message added' : 'Note added');
    if (r) { setData(r); setMsg({ ...msg, note: '' }); }
  };
  const website = meta.websiteUrl || 'http://localhost:5173';

  return (
    <>
      <PageHead back={['Bookings', '/bookings']} title={<>{b.reference} <Pill>{b.status}</Pill> <Pill>{b.kind}</Pill></>} subtitle={`${b.source} · received ${dateTime(b.createdAt)}`}
        actions={manage && <>
          {b.transitions.map((s) => <button key={s} className={`btn ${ACTION[s][1]}`} onClick={() => setModal({ status: s })}>{ACTION[s][0]}</button>)}
          {b.kind === 'Booking' && ['Pending', 'Confirmed'].includes(b.status) && <button className="btn btn-ghost" onClick={() => setModal({ reschedule: true })}>Reschedule</button>}
          <button className="btn btn-ghost" onClick={() => setModal({ edit: true })}>Edit details</button>
          {['Cancelled', 'Declined', 'Closed'].includes(b.status) && <button className="btn btn-danger-ghost" onClick={async () => { if (await confirm({ title: `Delete ${b.reference}?`, message: 'The audit trail keeps a record.', danger: true, confirmLabel: 'Delete' }) && await run(() => api.del(`/bookings/${b.id}`), 'Deleted')) navigate('/bookings'); }}>Delete</button>}
        </>} />
      <div className="split" style={{ gridTemplateColumns: 'minmax(0, 3fr) minmax(280px, 2fr)' }}>
        <div className="stack">
          <div className="card card-pad">
            <div className="row" style={{ flexWrap: 'nowrap', marginBottom: 14 }}>
              <Thumb src={b.profilePhoto} name={b.profileName} w={56} h={70} />
              <div><h2 style={{ fontSize: 20 }}><Link to={`/profiles/${b.profileId}`}>{b.profileName}</Link></h2>
                {b.profileStatus === 'Published' && <a className="muted" href={`${website}/companions/${b.profileSlug}`} target="_blank" rel="noreferrer">View on website ↗</a>}</div>
            </div>
            <KeyVals rows={[
              ...(b.kind === 'Booking' ? [['Session', `${b.rateLabel} · ${duration(b.durationMinutes)}`]] : []),
              ['Date', b.bookingDate ? dayLong(b.bookingDate) : 'Not set'],
              ['Time', b.startTime ? `${time12(b.startTime)}${b.endTime ? ` – ${b.endDate !== b.bookingDate ? `${dayLong(b.endDate)} ` : ''}${time12(b.endTime)}` : ''}` : null],
              ['Meeting area', b.locationName], ['Venue', b.meetingPlace],
              ['Reschedules by client', b.rescheduleCount || null],
              ['Cancellation', b.cancelReason ? `${b.cancelReason}${b.cancelledBy ? ` (by ${b.cancelledBy.toLowerCase()})` : ''}` : undefined],
            ]} />
          </div>
          {b.kind === 'Booking' && (
            <div className="card card-pad">
              <div className="section-title" style={{ marginTop: 0 }}>Quoted to the client</div>
              <div className="kv-line"><span>Rate</span><strong>{money(b.ratePrice)}</strong></div>
              {b.fees.map((f) => <div key={f.name} className="kv-line"><span>{f.name}</span><span>{money(f.amount)}</span></div>)}
              <div className="kv-line" style={{ borderTop: '1px solid var(--line)', paddingTop: 6, marginTop: 6 }}><strong>Total</strong><strong>{money(b.total)}</strong></div>
            </div>
          )}
          {(b.clientNotes || b.staffNotes) && (
            <div className="card card-pad stack">
              {b.clientNotes && <div><div className="section-title" style={{ marginTop: 0 }}>Client notes</div><p style={{ whiteSpace: 'pre-wrap' }}>{b.clientNotes}</p></div>}
              {b.staffNotes && <div><div className="section-title" style={{ marginTop: 0 }}>Staff notes</div><p style={{ whiteSpace: 'pre-wrap' }}>{b.staffNotes}</p></div>}
            </div>
          )}
          {b.chat && <ChatCard b={b} manage={manage} onSent={setData} />}
          <div className="card card-pad">
            <div className="section-title" style={{ marginTop: 0 }}>Timeline</div>
            <ul className="timeline">
              {b.events.map((e) => (
                <li key={e.id} className={e.visibleToClient ? '' : 'internal'}>
                  <strong>{e.title}</strong> {!e.visibleToClient && <Pill tone="grey">Internal</Pill>}
                  <small>{dateTime(e.createdAt)}{e.actor ? ` · ${e.actor}` : ''}</small>
                  {e.note && <p style={{ margin: '4px 0 0', whiteSpace: 'pre-wrap' }}>{e.note}</p>}
                </li>
              ))}
            </ul>
            {manage && (
              <div className="stack" style={{ marginTop: 10 }}>
                <textarea rows={2} placeholder={msg.visible ? 'Message to the client (shown on their status page)…' : 'Internal note…'} value={msg.note} onChange={(e) => setMsg({ ...msg, note: e.target.value })} aria-label="Message" />
                <div className="row">
                  <Toggle checked={msg.visible} onChange={(v) => setMsg({ ...msg, visible: v })} label="Visible to the client" />
                  {msg.visible && <Toggle checked={msg.notify} onChange={(v) => setMsg({ ...msg, notify: v })} label="Also email" />}
                  <span className="spacer" />
                  <button className="btn btn-sm btn-primary" disabled={!msg.note.trim() || busy} onClick={sendMsg}>Add</button>
                </div>
              </div>
            )}
          </div>
        </div>
        <div className="stack">
          <div className="card card-pad">
            <div className="section-title" style={{ marginTop: 0 }}>Client</div>
            <KeyVals rows={[
              ['Name', b.clientName], ['Email', <a key="e" href={`mailto:${b.clientEmail}?subject=${encodeURIComponent(`Your booking ${b.reference}`)}`}>{b.clientEmail}</a>],
              ['Phone', b.clientPhone ? <a key="p" href={`tel:${b.clientPhone.replace(/\s/g, '')}`}>{b.clientPhone}</a> : null], ['Contact by', b.preferredContact],
              ['Member', b.memberId ? <Link key="m" to={`/members/${b.memberId}`}>{b.memberName} ({b.memberNo})</Link> : 'Guest'],
            ]} />
          </div>
          <div className="card card-pad muted" style={{ fontSize: 13 }}>
            The client can see the status, client-visible messages and the quote on the website with the reference and email. They can cancel or reschedule online until the cut-off in Site Settings.
          </div>
        </div>
      </div>
      {modal?.status && <StatusModal b={b} status={modal.status} onClose={() => setModal(null)} onDone={done} />}
      {modal?.reschedule && <RescheduleModal b={b} onClose={() => setModal(null)} onDone={done} />}
      {modal?.edit && <EditModal b={b} onClose={() => setModal(null)} onDone={done} />}
    </>
  );
}
