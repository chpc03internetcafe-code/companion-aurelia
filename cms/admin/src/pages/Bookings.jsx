import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, qs } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useUi } from '../lib/ui';
import { useLiveRefresh } from '../lib/notifications';
import { addDays, dateTime, dayLong, duration, money, time12, todayIso } from '../lib/format';
import { Empty, ErrorBox, Field, Loading, Modal, PageHead, Pager, Pill, SearchBox, Stats, Thumb, Toggle, useForm, useLoad, useQueryState } from '../components/kit';

/** Day strip + start times for a profile/rate (staff view: ignores nothing, shows why a day is closed). */
export function SlotPicker({ profileId, rateId, duration: dur, exclude, date, time, onChange }) {
  const [from, setFrom] = useState(todayIso());
  const days = useLoad(() => (profileId && (rateId || dur) ? api.get('/bookings/slots', { profileId, rateId, duration: dur, from, days: 14, exclude }) : Promise.resolve(null)), [profileId, rateId, dur, from, exclude]);
  const slots = useLoad(() => (profileId && date && (rateId || dur) ? api.get('/bookings/slots', { profileId, rateId, duration: dur, date, exclude }) : Promise.resolve(null)), [profileId, rateId, dur, date, exclude]);
  if (!profileId || !(rateId || dur)) return <p className="muted">Choose a profile and session first.</p>;
  return (
    <div className="stack">
      <div className="row">
        <button type="button" className="btn btn-sm btn-ghost" disabled={from <= todayIso()} onClick={() => setFrom(addDays(from, -14))}>‹</button>
        <div className="day-strip" style={{ flex: 1 }}>
          {(days.data || []).map((d) => (
            <button type="button" key={d.date} className={date === d.date ? 'on' : ''} onClick={() => onChange({ date: d.date, time: '' })} title={d.closed || ''}>
              {new Date(`${d.date}T00:00:00Z`).toLocaleDateString('en-PH', { weekday: 'short', timeZone: 'UTC' })}<b>{Number(d.date.slice(8))}</b><small>{d.slots || '—'}</small>
            </button>
          ))}
        </div>
        <button type="button" className="btn btn-sm btn-ghost" onClick={() => setFrom(addDays(from, 14))}>›</button>
      </div>
      {date && (slots.loading ? <Loading /> : slots.data?.slots.length
        ? <div className="slot-grid">{slots.data.slots.map((t) => <button type="button" key={t} className={time === t ? 'on' : ''} onClick={() => onChange({ date, time: t })}>{time12(t)}</button>)}</div>
        : <p className="muted">{slots.data?.closed || 'No open times.'}</p>)}
    </div>
  );
}

function NewBooking({ onClose, onSaved, preset = {} }) {
  const { meta } = useUi();
  const profiles = useLoad(() => api.get('/profiles/options'), []);
  const { form, setForm, set, errors, saving, submit } = useForm({ kind: 'Booking', profileId: preset.profileId || '', rateId: '', date: '', time: '', locationId: '', meetingPlace: '', memberId: preset.memberId || '',
    clientName: preset.clientName || '', clientEmail: preset.clientEmail || '', clientPhone: preset.clientPhone || '', preferredContact: 'Phone call', clientNotes: '', staffNotes: '', source: 'Phone', status: 'Confirmed', sendEmail: true, manualTime: false });
  const [quote, setQuote] = useState(null);
  const profile = profiles.data?.find((p) => p.id === Number(form.profileId));
  useEffect(() => {
    if (!form.profileId || !form.rateId) { setQuote(null); return; }
    api.post('/bookings/quote', { profileId: form.profileId, rateId: form.rateId, locationId: form.locationId || null }).then(setQuote).catch(() => setQuote(null));
  }, [form.profileId, form.rateId, form.locationId]);
  const save = () => submit(async (f) => onSaved(await api.post('/bookings', { ...f, rateId: f.rateId || null, locationId: f.locationId || null, memberId: f.memberId || null, date: f.date || null, time: f.time || null })), 'Booking created');
  return (
    <Modal title="New booking" size="wide" onClose={onClose} footer={<><button className="btn btn-ghost" onClick={onClose}>Cancel</button><button className="btn btn-primary" onClick={save} disabled={saving}>Create</button></>}>
      <div className="split" style={{ gridTemplateColumns: 'minmax(0, 3fr) minmax(240px, 2fr)' }}>
        <div className="stack">
          <div className="form-grid">
            <Field label="Type"><select value={form.kind} onChange={set('kind')}><option>Booking</option><option>Inquiry</option></select></Field>
            <Field label="Source"><select value={form.source} onChange={set('source')}>{meta.bookingSources.map((s) => <option key={s}>{s}</option>)}</select></Field>
            <Field label="Profile" error={errors.profileId} required className="span-2">
              <select value={form.profileId} onChange={(e) => setForm({ ...form, profileId: e.target.value, rateId: '', date: '', time: '' })}><option value="">Choose…</option>{(profiles.data || []).map((p) => <option key={p.id} value={p.id}>{p.displayName} · {p.categoryName}{p.locationName ? ` · ${p.locationName}` : ''}{p.status !== 'Published' ? ` (${p.status})` : ''}</option>)}</select>
            </Field>
            {form.kind === 'Booking' && <Field label="Session" error={errors.rateId} required className="span-2">
              <select value={form.rateId} onChange={(e) => setForm({ ...form, rateId: e.target.value, time: '' })}><option value="">Choose…</option>{(profile?.rates || []).map((r) => <option key={r.id} value={r.id}>{r.label} · {duration(r.durationMinutes)} · {money(r.price, true)}</option>)}</select>
            </Field>}
          </div>
          {form.kind === 'Booking' && (
            <div className="card card-pad stack">
              <div className="row" style={{ justifyContent: 'space-between' }}><strong>Date & time</strong><Toggle checked={form.manualTime} onChange={(v) => setForm({ ...form, manualTime: v })} label="Enter manually" /></div>
              {form.manualTime ? (
                <div className="form-grid">
                  <Field label="Date" error={errors.date}><input type="date" value={form.date} onChange={set('date')} /></Field>
                  <Field label="Start" error={errors.time} hint="Must not overlap another booking"><input type="time" value={form.time} onChange={set('time')} /></Field>
                </div>
              ) : <SlotPicker profileId={form.profileId} rateId={form.rateId} date={form.date} time={form.time} onChange={(x) => setForm({ ...form, ...x })} />}
              {(errors.date || errors.time) && <small className="error">{errors.date || errors.time}</small>}
            </div>
          )}
          <div className="form-grid">
            <Field label="Client name" error={errors.clientName} required><input value={form.clientName} onChange={set('clientName')} /></Field>
            <Field label="Client email" error={errors.clientEmail} required><input type="email" value={form.clientEmail} onChange={set('clientEmail')} /></Field>
            <Field label="Phone" error={errors.clientPhone}><input value={form.clientPhone} onChange={set('clientPhone')} /></Field>
            <Field label="Contact by"><select value={form.preferredContact} onChange={set('preferredContact')}>{meta.contactMethods.map((m) => <option key={m}>{m}</option>)}</select></Field>
            <Field label="Meeting area"><select value={form.locationId} onChange={set('locationId')}><option value="">—</option>{meta.locations.map((l) => <option key={l.id} value={l.id}>{l.parentId ? `${l.parentName} — ${l.name}` : l.name}</option>)}</select></Field>
            <Field label="Venue"><input value={form.meetingPlace} onChange={set('meetingPlace')} /></Field>
            <Field label="Client notes" className="span-2"><textarea rows={2} value={form.clientNotes} onChange={set('clientNotes')} /></Field>
            <Field label="Staff notes (internal)" className="span-2"><textarea rows={2} value={form.staffNotes} onChange={set('staffNotes')} /></Field>
          </div>
        </div>
        <div className="stack">
          {form.kind === 'Booking' && <Field label="Status"><select value={form.status} onChange={set('status')}><option>Confirmed</option><option>Pending</option></select></Field>}
          <Toggle checked={form.sendEmail} onChange={(v) => setForm({ ...form, sendEmail: v })} label="Email the client" hint="Sends the reference and status link" />
          {quote && (
            <div className="card card-pad">
              <div className="kv-line"><span>Rate</span><strong>{money(quote.ratePrice)}</strong></div>
              {quote.fees.map((f) => <div key={f.name} className="kv-line"><span>{f.name}</span><span>{money(f.amount)}</span></div>)}
              <div className="kv-line" style={{ borderTop: '1px solid var(--line)', paddingTop: 6, marginTop: 6 }}><strong>Total</strong><strong>{money(quote.total)}</strong></div>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}

export default function Bookings() {
  const { meta } = useUi();
  const { can } = useAuth();
  const navigate = useNavigate();
  const manage = can('bookings', 'manage');
  const [q, setQ] = useQueryState({ kind: '', status: 'Open', profileId: '', source: '', from: '', to: '', search: '', sort: 'upcoming', page: 1, pageSize: 25 });
  const { data, loading, error, reload } = useLoad(() => api.get('/bookings', q), [JSON.stringify(q)]);
  const stats = useLoad(() => api.get('/bookings/stats'), []);
  const profiles = useLoad(() => api.get('/profiles/options'), []);
  useLiveRefresh('bookings', () => { reload(true); stats.reload(true); });
  const [creating, setCreating] = useState(false);
  const s = stats.data;
  const statuses = q.kind === 'Inquiry' ? meta.profileInquiryStatuses : meta.bookingStatuses;
  return (
    <>
      <PageHead title="Bookings & inquiries" subtitle="Booking requests from the website, phone and messaging, and questions about profiles."
        actions={<>
          <a className="btn btn-ghost" href={`/api/bookings/export${qs({ ...q, page: '', pageSize: '' })}`}>Export CSV</a>
          {manage && <button className="btn btn-primary" onClick={() => setCreating(true)}>+ New booking</button>}
        </>} />
      {s && <Stats items={[
        { label: 'To confirm', value: s.pending, tone: s.pending ? 'warn' : '', onClick: () => setQ({ kind: 'Booking', status: 'Pending', sort: 'newest' }), active: q.kind === 'Booking' && q.status === 'Pending' },
        { label: 'Inquiries to answer', value: s.inquiries, tone: s.inquiries ? 'warn' : '', onClick: () => setQ({ kind: 'Inquiry', status: 'Pending', sort: 'newest' }), active: q.kind === 'Inquiry' && q.status === 'Pending' },
        { label: 'Confirmed today', value: s.today, onClick: () => setQ({ kind: 'Booking', status: 'Confirmed', from: todayIso(), to: todayIso(), sort: 'upcoming' }) },
        { label: 'Upcoming confirmed', value: s.upcoming, onClick: () => setQ({ kind: 'Booking', status: 'Confirmed', from: todayIso(), to: '', sort: 'upcoming' }) },
        { label: 'Completed this month', value: s.completedMonth },
      ]} />}
      <div className="card">
        <div className="filters">
          <SearchBox value={q.search} onChange={(search) => setQ({ search })} placeholder="Reference, client, email, phone, profile…" />
          <select value={q.kind} onChange={(e) => setQ({ kind: e.target.value, status: '' })} aria-label="Type"><option value="">Bookings & inquiries</option><option>Booking</option><option>Inquiry</option></select>
          <select value={q.status} onChange={(e) => setQ({ status: e.target.value })} aria-label="Status"><option value="">Any status</option><option value="Open">Open (pending + confirmed)</option>{[...new Set([...statuses])].map((x) => <option key={x}>{x}</option>)}</select>
          <select value={q.profileId} onChange={(e) => setQ({ profileId: e.target.value })} aria-label="Profile"><option value="">All profiles</option>{(profiles.data || []).map((p) => <option key={p.id} value={p.id}>{p.displayName}</option>)}</select>
          <select value={q.source} onChange={(e) => setQ({ source: e.target.value })} aria-label="Source"><option value="">All sources</option>{meta.bookingSources.map((x) => <option key={x}>{x}</option>)}</select>
          <input type="date" value={q.from} onChange={(e) => setQ({ from: e.target.value })} aria-label="From" />
          <input type="date" value={q.to} onChange={(e) => setQ({ to: e.target.value })} aria-label="To" />
          <select value={q.sort} onChange={(e) => setQ({ sort: e.target.value })} aria-label="Sort"><option value="upcoming">Soonest first</option><option value="newest">Newest requests</option><option value="date_desc">Latest date first</option></select>
        </div>
        <ErrorBox error={error} onRetry={reload} />
        {loading && !data ? <Loading /> : data?.items.length ? (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>When</th><th>Profile</th><th>Client</th><th className="hide-sm">Total</th><th>Status</th></tr></thead>
              <tbody>{data.items.map((b) => (
                <tr key={b.id} className="clickable" onClick={() => navigate(`/bookings/${b.id}`)}>
                  <td className="nowrap">{b.bookingDate ? <><strong>{dayLong(b.bookingDate)}</strong><span className="sub">{b.startTime ? `${time12(b.startTime)} – ${time12(b.endTime)}` : 'No time'}</span></> : <span className="muted">No date</span>}</td>
                  <td><div className="row" style={{ flexWrap: 'nowrap' }}><Thumb src={b.profilePhoto} name={b.profileName} w={32} h={40} /><div><strong>{b.profileName}</strong><span className="sub">{b.kind === 'Inquiry' ? 'Inquiry' : `${b.rateLabel} · ${duration(b.durationMinutes)}`}</span></div></div></td>
                  <td>{b.clientName}{b.memberNo && <> <Pill tone="violet">{b.memberNo}</Pill></>}<span className="sub">{b.reference} · {b.source} · {dateTime(b.createdAt)}</span></td>
                  <td className="hide-sm">{b.kind === 'Booking' ? money(b.total, true) : '—'}</td>
                  <td><Pill>{b.status}</Pill></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        ) : <Empty icon="📅" title="Nothing here" text="No bookings match these filters." />}
        {data && <Pager page={q.page} pageSize={q.pageSize} total={data.total} onChange={setQ} />}
      </div>
      {creating && <NewBooking onClose={() => setCreating(false)} onSaved={(b) => { setCreating(false); navigate(`/bookings/${b.id}`); }} />}
    </>
  );
}

export { NewBooking };
