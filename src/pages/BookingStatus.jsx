// Booking status: look up with reference + email (or signed in), see the timeline, cancel or reschedule within the policy,
// and chat with the companion once the booking is confirmed.
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useSite } from '../context/SiteContext';
import { api, lookupEmail, qs } from '../utils/api';
import { useSeo } from '../utils/seo';
import { dateTime, dayLong, duration, money, time12, todayIso, WEEKDAYS } from '../utils/format';
import { Field, Loading, PageHero, Photo, Status } from '../components/Common';
import Chat from '../components/Chat';

function Reschedule({ b, email, onDone, onCancel }) {
  const { toast } = useSite();
  const [days, setDays] = useState(null);
  const [date, setDate] = useState('');
  const [slots, setSlots] = useState(null);
  const [time, setTime] = useState('');
  const [busy, setBusy] = useState(false);
  const from = todayIso();
  useEffect(() => {
    api('GET', `/site/availability/days${qs({ profileId: b.profileId, rateId: b.rateId, from, days: 21, exclude: b.reference })}`).then(setDays).catch(() => setDays([]));
  }, [b.profileId, b.rateId, b.reference, from]);
  useEffect(() => {
    if (!date) return;
    setSlots(null);
    setTime('');
    api('GET', `/site/availability${qs({ profileId: b.profileId, rateId: b.rateId, date, exclude: b.reference })}`).then((r) => setSlots(r.slots)).catch(() => setSlots([]));
  }, [date, b.profileId, b.rateId, b.reference]);
  const save = async () => {
    setBusy(true);
    try {
      onDone(await api('POST', `/site/bookings/${b.reference}/reschedule`, { email, date, time }));
      toast('Booking moved — we’ll confirm the new time');
    } catch (e) { toast(e.message, 'error'); } finally { setBusy(false); }
  };
  if (!b.rateId) return <div className="notice">This session is no longer offered online. Please contact the concierge to change the time.</div>;
  return (
    <div className="panel">
      <h3>Choose a new time</h3>
      {!days ? <Loading /> : (
        <div className="days">
          {days.map((d) => (
            <button key={d.date} type="button" className={`day ${date === d.date ? 'on' : ''}`} disabled={!d.slots} onClick={() => setDate(d.date)}>
              <small>{WEEKDAYS[new Date(`${d.date}T00:00:00Z`).getUTCDay()]}</small><b>{Number(d.date.slice(8))}</b><em>{d.slots ? `${d.slots} times` : 'Full'}</em>
            </button>
          ))}
        </div>
      )}
      {date && (slots ? <div className="slots" style={{ marginTop: 14 }}>{slots.map((t) => <button key={t} type="button" className={`slot ${time === t ? 'on' : ''}`} onClick={() => setTime(t)}>{time12(t)}</button>)}</div> : <Loading />)}
      <div className="row" style={{ marginTop: 16 }}>
        <button className="btn btn-primary" disabled={!time || busy} onClick={save}>{busy ? 'Saving…' : 'Move my booking'}</button>
        <button className="btn btn-ghost" onClick={onCancel}>Keep current time</button>
      </div>
    </div>
  );
}

export default function BookingStatus() {
  const { ref } = useParams();
  const navigate = useNavigate();
  const { member, toast, site } = useSite();
  const [form, setForm] = useState({ reference: ref || '', email: (ref && lookupEmail.get(ref)) || '' });
  const [b, setB] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState('');
  const [reason, setReason] = useState('');
  useSeo({ title: 'Booking status', noindex: true });

  const lookup = async (reference, email) => {
    setBusy(true);
    setError('');
    try {
      // the email goes in a header, not the URL, so it isn't written to server logs
      const r = await api('GET', `/site/bookings/${encodeURIComponent(reference.trim().toUpperCase())}`, null, { headers: { 'X-Booking-Email': email } });
      setB(r);
      lookupEmail.set(r.reference, email);
      if (r.reference !== ref) navigate(`/booking-status/${r.reference}`, { replace: true });
    } catch (e) { setError(e.message); setB(null); } finally { setBusy(false); }
  };
  useEffect(() => { if (ref && (form.email || member)) lookup(ref, form.email); }, [ref, member?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const cancel = async () => {
    setBusy(true);
    try {
      setB(await api('POST', `/site/bookings/${b.reference}/cancel`, { email: form.email, reason }));
      setMode('');
      toast('Booking cancelled');
    } catch (e) { toast(e.message, 'error'); } finally { setBusy(false); }
  };

  if (!b) {
    return (
      <>
        <PageHero compact kicker="Bookings" title="Check my booking" text="Enter the reference number from your confirmation email and the email you used." />
        <section className="section" style={{ paddingTop: 30 }}>
          <div className="narrow" style={{ maxWidth: 520 }}>
            <form className="panel stack" onSubmit={(e) => { e.preventDefault(); lookup(form.reference, form.email); }}>
              <Field label="Reference" required><input value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value.toUpperCase() })} placeholder="BK-261015-1234" required /></Field>
              <Field label="Email" required><input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required /></Field>
              {error && <div className="notice error">{error}</div>}
              <button className="btn btn-primary btn-block" disabled={busy}>{busy ? 'Looking up…' : 'Find my booking'}</button>
              {member && <p className="muted center" style={{ margin: 0 }}>Signed in? All your bookings are in <Link to="/account/bookings">your account</Link>.</p>}
            </form>
          </div>
        </section>
      </>
    );
  }

  const isBooking = b.kind === 'Booking';
  return (
    <>
      <PageHero compact kicker={b.kind} title={b.reference} crumbs={[['Home', '/'], ['Check my booking', '/booking-status'], [b.reference]]}><Status value={b.status} /></PageHero>
      <section className="section" style={{ paddingTop: 30 }}>
        <div className="container grid-2" style={{ alignItems: 'start' }}>
          <div className="stack">
            <div className="panel">
              <div className="mini-profile" style={{ marginBottom: 16 }}>
                <Photo src={b.profile.photo} name={b.profile.name} />
                <div><div className="muted" style={{ fontSize: '0.8rem' }}>Companion</div><strong style={{ fontFamily: 'var(--serif)', fontSize: '1.5rem' }}>{b.profile.slug ? <Link to={`/companions/${b.profile.slug}`}>{b.profile.name}</Link> : b.profile.name}</strong></div>
              </div>
              <div className="summary">
                {isBooking && <div className="summary-line"><span>Session</span><span>{b.rateLabel} · {duration(b.durationMinutes)}</span></div>}
                <div className="summary-line"><span>When</span><span>{b.date ? `${dayLong(b.date)}${b.time ? `, ${time12(b.time)}` : ''}` : 'To be agreed'}</span></div>
                {isBooking && b.endTime && <div className="summary-line"><span>Until</span><span>{b.endDate !== b.date ? `${dayLong(b.endDate)}, ` : ''}{time12(b.endTime)}</span></div>}
                {(b.locationName || b.meetingPlace) && <div className="summary-line"><span>Where</span><span>{[b.locationName, b.meetingPlace].filter(Boolean).join(' — ')}</span></div>}
                <div className="summary-line"><span>Contact by</span><span>{b.preferredContact}</span></div>
                {isBooking && <>
                  <div className="summary-line" style={{ borderTop: '1px solid var(--line)', paddingTop: 10 }}><span>Rate</span><span>{money(b.ratePrice)}</span></div>
                  {b.fees.map((f) => <div key={f.name} className="summary-line"><span>{f.name}</span><span>{money(f.amount)}</span></div>)}
                  <div className="summary-line summary-total"><span>Total</span><span>{money(b.total)}</span></div>
                </>}
              </div>
              {b.cancelReason && <p className="muted" style={{ marginTop: 14 }}>Reason: {b.cancelReason}</p>}
            </div>
            {isBooking && (b.canCancel || b.canReschedule) && !mode && (
              <div className="panel">
                <h3>Need to change something?</h3>
                <p className="muted">You can make changes online until {b.cutoffHours} hours before your booking{b.rescheduleLimit ? ` (up to ${b.rescheduleLimit} reschedules)` : ''}.</p>
                <div className="row">
                  {b.canReschedule && <button className="btn btn-ghost" onClick={() => setMode('reschedule')}>Reschedule</button>}
                  {b.canCancel && <button className="btn btn-danger" onClick={() => setMode('cancel')}>Cancel booking</button>}
                </div>
              </div>
            )}
            {isBooking && !b.canCancel && b.upcoming && <div className="notice">Online changes are closed for this booking. Please contact the concierge{site.email ? ` at ${site.email}` : ''}{site.messaging ? ` or ${site.messaging}` : ''}.</div>}
            {mode === 'reschedule' && <Reschedule b={b} email={form.email} onDone={(x) => { setB(x); setMode(''); }} onCancel={() => setMode('')} />}
            {mode === 'cancel' && (
              <div className="panel stack">
                <h3>Cancel this booking?</h3>
                <Field label="Reason (optional)"><textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
                <div className="row"><button className="btn btn-danger" onClick={cancel} disabled={busy}>Yes, cancel</button><button className="btn btn-ghost" onClick={() => setMode('')}>Keep booking</button></div>
              </div>
            )}
          </div>
          <div className="stack">
          {b.chat && (
            <Chat key={b.reference} path={`/site/bookings/${b.reference}/messages`} extra={form.email ? { email: form.email } : {}}
              title={`Messages with ${b.profile.name}`} placeholder={`Write to ${b.profile.name}…`}
              hint="Our concierge can read this chat to help if anything goes wrong. Please keep payments and personal details within the booking." />
          )}
          <div className="panel">
            <h3>Status updates</h3>
            <ul className="timeline">
              {b.timeline.map((e, i) => (
                <li key={i}><strong>{e.title}</strong><small>{dateTime(e.at)}</small>{e.note && <p style={{ margin: '6px 0 0', color: 'var(--text-2)', whiteSpace: 'pre-line' }}>{e.note}</p>}</li>
              ))}
            </ul>
            <p className="muted" style={{ fontSize: '0.84rem', marginBottom: 0 }}>We email you whenever the status changes. Requested {dateTime(b.createdAt)}.</p>
          </div>
          </div>
        </div>
      </section>
    </>
  );
}
