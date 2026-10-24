// Booking request wizard: session → date & time → details → review (fees shown before confirming).
// ?rate=<id> preselects a session; ?kind=inquiry sends a question instead (date optional).
import { useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useSite } from '../context/SiteContext';
import { api, lookupEmail, qs } from '../utils/api';
import { useSeo } from '../utils/seo';
import { addDays, dayLong, dayShort, duration, money, time12, todayIso, WEEKDAYS } from '../utils/format';
import { Empty, Field, Loading, Photo, Status } from '../components/Common';
import { IconCheck } from '../components/Icons';

function Summary({ p, rate, date, time, quote, locationName, kind }) {
  return (
    <aside className="cta-box sticky-cta">
      <div className="mini-profile" style={{ marginBottom: 16 }}>
        <Photo src={p.photoUrl} alt={p.photoAlt} name={p.name} />
        <div><strong style={{ fontFamily: 'var(--serif)', fontSize: '1.4rem' }}>{p.name}</strong><div className="muted" style={{ fontSize: '0.86rem' }}>{p.category.name}{p.location ? ` · ${p.location.name}` : ''}</div></div>
      </div>
      <div className="summary">
        {kind === 'Inquiry' ? <div className="summary-line"><span>Request</span><span>Inquiry</span></div> : <>
          <div className="summary-line"><span>Session</span><span>{rate ? `${rate.label} · ${duration(rate.durationMinutes)}` : '—'}</span></div>
          <div className="summary-line"><span>Date</span><span>{date ? dayShort(date) : '—'}</span></div>
          <div className="summary-line"><span>Time</span><span>{time ? time12(time) : '—'}</span></div>
          {locationName && <div className="summary-line"><span>Location</span><span>{locationName}</span></div>}
          {quote && <>
            <div className="summary-line" style={{ borderTop: '1px solid var(--line)', paddingTop: 10 }}><span>Rate</span><span>{money(quote.ratePrice)}</span></div>
            {quote.fees.map((f) => <div key={f.name} className="summary-line" title={f.description || ''}><span>{f.name}{f.percent ? ` (${f.percent}%)` : ''}</span><span>{money(f.amount)}</span></div>)}
            <div className="summary-line summary-total"><span>Total</span><span>{money(quote.total)}</span></div>
          </>}
        </>}
      </div>
      <p className="muted" style={{ fontSize: '0.8rem', marginTop: 14, marginBottom: 0 }}>No payment is taken online. Fees are settled as agreed with the concierge once your booking is confirmed.</p>
    </aside>
  );
}

function Confirmation({ b, email }) {
  const { site } = useSite();
  return (
    <section className="section">
      <div className="narrow">
        <div className="panel center" style={{ padding: 36 }}>
          <IconCheck size={44} style={{ color: 'var(--ok)' }} />
          <h1 style={{ fontSize: '2.4rem' }}>{b.kind === 'Inquiry' ? 'Inquiry sent' : b.status === 'Confirmed' ? 'Booking confirmed' : 'Request received'}</h1>
          <p className="lead" style={{ margin: '0 auto 14px' }}>{b.kind === 'Inquiry' ? 'Our concierge will reply shortly using your preferred contact method.' : b.status === 'Confirmed' ? 'Your booking is confirmed. Details have been emailed to you.' : 'Our concierge will review and confirm shortly. We’ve emailed you the details.'}</p>
          <div className="muted" style={{ fontSize: '0.8rem', letterSpacing: '0.18em', textTransform: 'uppercase' }}>Your reference</div>
          <div className="ref-big">{b.reference}</div>
          <div style={{ margin: '12px 0 20px' }}><Status value={b.status} /></div>
          {b.kind === 'Booking' && (
            <div className="summary" style={{ textAlign: 'left', maxWidth: 420, margin: '0 auto 24px' }}>
              <div className="summary-line"><span>Companion</span><span>{b.profile.name}</span></div>
              <div className="summary-line"><span>Session</span><span>{b.rateLabel}</span></div>
              <div className="summary-line"><span>When</span><span>{dayLong(b.date)}, {time12(b.time)}</span></div>
              <div className="summary-line summary-total"><span>Total</span><span>{money(b.total)}</span></div>
            </div>
          )}
          <div className="row" style={{ justifyContent: 'center' }}>
            <Link to={`/booking-status/${b.reference}`} className="btn btn-primary" onClick={() => lookupEmail.set(b.reference, email)}>Track status</Link>
            <Link to="/companions" className="btn btn-ghost">Back to directory</Link>
          </div>
          {site.bookingPolicy && <p className="muted" style={{ fontSize: '0.84rem', marginTop: 22 }}>{site.bookingPolicy}</p>}
        </div>
      </div>
    </section>
  );
}

export default function Book() {
  const { slug } = useParams();
  const [params] = useSearchParams();
  const { contactMethods, site, toast } = useSite();
  const kind = params.get('kind') === 'inquiry' ? 'Inquiry' : 'Booking';
  const [p, setP] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [rateId, setRateId] = useState(Number(params.get('rate')) || null);
  const [days, setDays] = useState(null);
  const [from, setFrom] = useState(todayIso());
  const [date, setDate] = useState('');
  const [slots, setSlots] = useState(null);
  const [time, setTime] = useState('');
  const [quote, setQuote] = useState(null);
  const [form, setForm] = useState({ name: '', email: '', phone: '', preferredContact: 'Email', locationId: '', meetingPlace: '', notes: '', consent: false, website: '' });
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);
  const [tick, setTick] = useState(0); // refreshes availability after a slot was taken
  useSeo({ title: p ? `${kind === 'Inquiry' ? 'Inquiry' : 'Book'} — ${p.name}` : 'Booking', noindex: true });

  useEffect(() => {
    api('GET', `/site/profiles/${slug}`).then((x) => {
      setP(x);
      if (!x.rates.some((r) => r.id === rateId)) setRateId(x.rates.length === 1 ? x.rates[0].id : null);
      setForm((f) => ({ ...f, locationId: x.baseLocationId || '' }));
    }).catch((e) => setLoadError(e));
  }, [slug]); // eslint-disable-line react-hooks/exhaustive-deps

  const rate = p?.rates.find((r) => r.id === rateId) || null;
  // open days for the chosen session
  useEffect(() => {
    if (!p || !rate || kind !== 'Booking') return;
    setDays(null);
    api('GET', `/site/availability/days${qs({ profileId: p.id, rateId: rate.id, from, days: 14 })}`).then((d) => {
      setDays(d);
      if (!date || !d.some((x) => x.date === date && x.slots)) setDate(d.find((x) => x.slots)?.date || '');
    }).catch(() => setDays([]));
  }, [p?.id, rate?.id, from, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!p || !rate || !date) { setSlots(null); return; }
    setSlots(null);
    api('GET', `/site/availability${qs({ profileId: p.id, rateId: rate.id, date })}`).then((r) => {
      setSlots(r.slots);
      if (!r.slots.includes(time)) setTime('');
    }).catch(() => setSlots([]));
  }, [p?.id, rate?.id, date, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!p || !rate) { setQuote(null); return; }
    api('POST', '/site/quote', { profileId: p.id, rateId: rate.id, locationId: form.locationId || null }).then(setQuote).catch(() => setQuote(null));
  }, [p?.id, rate?.id, form.locationId]); // eslint-disable-line react-hooks/exhaustive-deps

  const locations = useMemo(() => {
    if (!p) return [];
    const list = [];
    if (p.baseLocationId && p.location) list.push({ id: p.baseLocationId, name: p.location.parent ? `${p.location.name}, ${p.location.parent}` : p.location.name });
    for (const a of p.areas) if (!list.some((x) => x.id === a.id)) list.push({ id: a.id, name: a.parentName ? `${a.name}, ${a.parentName}` : a.name });
    return list;
  }, [p]);

  if (loadError) return <section className="section"><div className="narrow"><Empty title="Profile not available" text="This profile can’t be booked right now." action={<Link to="/companions" className="btn btn-primary">Browse companions</Link>} /></div></section>;
  if (!p) return <Loading />;
  if (done) return <Confirmation b={done} email={form.email} />;
  const bookable = kind === 'Inquiry' || (p.bookingEnabled && p.rates.length > 0);
  const set = (k) => (e) => { setForm({ ...form, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }); setErrors((x) => ({ ...x, [k]: undefined })); };
  const step = kind === 'Inquiry' ? 3 : !rate ? 1 : !time ? 2 : 3;

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setErrors({});
    try {
      const b = await api('POST', '/site/bookings', {
        kind, profileId: p.id, rateId: rate?.id, date: date || undefined, time: kind === 'Booking' ? time : (form.prefTime || undefined),
        name: form.name, email: form.email, phone: form.phone, preferredContact: form.preferredContact, locationId: form.locationId || undefined,
        meetingPlace: form.meetingPlace, notes: form.notes, consent: form.consent, website: form.website,
      });
      lookupEmail.set(b.reference, form.email);
      setDone(b);
      window.scrollTo(0, 0);
    } catch (err) {
      setErrors(err.details || {});
      toast(err.message, 'error');
      if (err.status === 409 && kind === 'Booking') { setTime(''); setTick((n) => n + 1); }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="container booking-layout">
      <div>
        <Link to={`/companions/${p.slug}`} className="muted" style={{ fontSize: '0.9rem' }}>← Back to {p.name}</Link>
        <h1 style={{ fontSize: '2.6rem', margin: '10px 0 16px' }}>{kind === 'Inquiry' ? `Send an inquiry about ${p.name}` : `Request a booking with ${p.name}`}</h1>
        {kind === 'Booking' && (
          <div className="steps" aria-label="Steps">
            {['Session', 'Date & time', 'Your details'].map((s, i) => <span key={s} className={step === i + 1 ? 'on' : step > i + 1 ? 'done' : ''}>{i + 1}. {s}</span>)}
          </div>
        )}
        {!bookable && <div className="notice">Online booking is paused for this profile. <Link to={`/book/${p.slug}?kind=inquiry`}>Send an inquiry instead</Link>.</div>}

        {kind === 'Booking' && bookable && (
          <>
            <div className="panel" style={{ marginBottom: 18 }}>
              <h3>1. Choose a session</h3>
              <div className="rate-list">
                {p.rates.map((r) => (
                  <button key={r.id} type="button" className={`rate ${rateId === r.id ? 'on' : ''}`} onClick={() => setRateId(r.id)} aria-pressed={rateId === r.id}>
                    <span><strong>{r.label}</strong><small>{duration(r.durationMinutes)}{r.notes ? ` · ${r.notes}` : ''}</small></span>
                    <span className="price">{money(r.price)}</span>
                  </button>
                ))}
              </div>
            </div>
            {rate && (
              <div className="panel" style={{ marginBottom: 18 }}>
                <div className="row" style={{ justifyContent: 'space-between', marginBottom: 10 }}>
                  <h3 style={{ margin: 0 }}>2. Choose a date and time</h3>
                  <div className="row">
                    <button type="button" className="btn btn-ghost btn-sm" disabled={from <= todayIso()} onClick={() => setFrom(addDays(from, -14) < todayIso() ? todayIso() : addDays(from, -14))}>‹ Earlier</button>
                    <button type="button" className="btn btn-ghost btn-sm" disabled={addDays(from, 14) > addDays(todayIso(), rules.windowDays)} onClick={() => setFrom(addDays(from, 14))}>Later ›</button>
                  </div>
                </div>
                {!days ? <Loading text="Checking availability…" /> : (
                  <div className="days" role="listbox" aria-label="Dates">
                    {days.map((d) => (
                      <button key={d.date} type="button" role="option" aria-selected={date === d.date} className={`day ${date === d.date ? 'on' : ''}`} disabled={!d.slots} onClick={() => setDate(d.date)} title={d.closed || ''}>
                        <small>{WEEKDAYS[new Date(`${d.date}T00:00:00Z`).getUTCDay()]}</small><b>{Number(d.date.slice(8))}</b><em>{d.slots ? `${d.slots} times` : 'Full'}</em>
                      </button>
                    ))}
                  </div>
                )}
                {days && !days.some((d) => d.slots) && <p className="muted" style={{ marginTop: 12 }}>No open times in these two weeks. Try later dates or <Link to={`/book/${p.slug}?kind=inquiry`}>send an inquiry</Link>.</p>}
                {date && (
                  <div style={{ marginTop: 16 }}>
                    <div className="muted" style={{ marginBottom: 8, fontWeight: 700 }}>{dayLong(date)}</div>
                    {!slots ? <Loading text="Loading times…" /> : slots.length ? (
                      <div className="slots">{slots.map((t) => <button key={t} type="button" className={`slot ${time === t ? 'on' : ''}`} onClick={() => setTime(t)} aria-pressed={time === t}>{time12(t)}</button>)}</div>
                    ) : <p className="muted">No times left on this day.</p>}
                    {errors.time && <p className="field-error">{errors.time}</p>}
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {(kind === 'Inquiry' || (rate && time)) && bookable && (
          <form className="panel" onSubmit={submit} noValidate>
            <h3>{kind === 'Inquiry' ? 'Your inquiry' : '3. Your details'}</h3>
            <div className="form-grid">
              <Field label="Name" error={errors.name} required><input value={form.name} onChange={set('name')} autoComplete="name" required /></Field>
              <Field label="Email" error={errors.email} required><input type="email" value={form.email} onChange={set('email')} autoComplete="email" required /></Field>
              <Field label="Mobile number" error={errors.phone} required={kind === 'Booking'} hint="Only used by the concierge to confirm"><input type="tel" value={form.phone} onChange={set('phone')} autoComplete="tel" /></Field>
              <Field label="Preferred contact" error={errors.preferredContact}><select value={form.preferredContact} onChange={set('preferredContact')}>{contactMethods.map((m) => <option key={m}>{m}</option>)}</select></Field>
              {locations.length > 0 && <Field label="Meeting area" error={errors.locationId}><select value={form.locationId} onChange={set('locationId')}>{locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></Field>}
              <Field label="Venue (optional)" error={errors.meetingPlace} hint="e.g. hotel or restaurant — you can also share it later"><input value={form.meetingPlace} onChange={set('meetingPlace')} /></Field>
              {kind === 'Inquiry' && <>
                <Field label="Preferred date (optional)" error={errors.date}><input type="date" min={todayIso()} value={date} onChange={(e) => setDate(e.target.value)} /></Field>
                <Field label="Preferred time (optional)" error={errors.time}><input type="time" value={form.prefTime || ''} onChange={set('prefTime')} /></Field>
              </>}
              <Field label={kind === 'Inquiry' ? 'Your question' : 'Notes for the concierge (optional)'} error={errors.notes} className="span-2" required={kind === 'Inquiry'}>
                <textarea rows={4} value={form.notes} onChange={set('notes')} placeholder={kind === 'Inquiry' ? 'Dates, occasion, questions…' : 'Occasion, dress code, anything we should know'} />
              </Field>
              <label className="honeypot" aria-hidden="true">Website <input tabIndex={-1} autoComplete="off" value={form.website} onChange={set('website')} /></label>
              <div className="span-2">
                <label className="check"><input type="checkbox" checked={form.consent} onChange={set('consent')} />
                  <span>I confirm I am 18 or over and accept the <Link to="/pages/booking-policy" target="_blank">booking policy</Link> and <Link to="/pages/terms" target="_blank">terms</Link>. Rates are for time and companionship only.</span></label>
                {errors.consent && <small className="field-error">Please confirm to continue.</small>}
              </div>
            </div>
            {kind === 'Booking' && quote && <div className="notice" style={{ marginTop: 16 }}>Total for this booking: <strong>{money(quote.total)}</strong> ({money(quote.ratePrice)} rate{quote.fees.length ? ` + ${money(quote.feesTotal)} fees` : ''}). Nothing is charged online.</div>}
            <button className="btn btn-primary btn-lg btn-block" style={{ marginTop: 18 }} disabled={busy}>{busy ? 'Sending…' : kind === 'Inquiry' ? 'Send inquiry' : rules.autoConfirm ? 'Confirm booking' : 'Send booking request'}</button>
            <p className="muted center" style={{ fontSize: '0.8rem', marginTop: 10, marginBottom: 0 }}>You’ll get a reference number immediately{site.email ? ` · questions: ${site.email}` : ''}</p>
          </form>
        )}
      </div>
      <Summary p={p} rate={rate} date={date} time={kind === 'Booking' ? time : ''} quote={kind === 'Booking' ? quote : null} kind={kind} locationName={locations.find((l) => String(l.id) === String(form.locationId))?.name} />
    </div>
  );
}
