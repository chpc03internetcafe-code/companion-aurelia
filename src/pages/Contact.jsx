import { useState } from 'react';
import { useSite } from '../context/SiteContext';
import { api } from '../utils/api';
import { useSeo } from '../utils/seo';
import { Field, PageHero } from '../components/Common';
import { IconChat, IconClock, IconMail, IconPhone } from '../components/Icons';

export default function Contact() {
  const { site, inquirySubjects, member, toast } = useSite();
  const [form, setForm] = useState({ name: member?.fullName || '', email: member?.email || '', phone: '', subject: inquirySubjects[0], message: '', website: '' });
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(null);
  useSeo({ title: 'Contact', description: `Contact the ${site.siteName} concierge about bookings, membership or a profile.` });
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setErrors({});
    try { setSent((await api('POST', '/site/inquiries', form)).reference); } catch (err) { setErrors(err.details || {}); toast(err.message, 'error'); } finally { setBusy(false); }
  };
  return (
    <>
      <PageHero compact kicker="Concierge" title="Contact us" text="Questions about a booking, membership or a profile? We usually reply within a few hours." />
      <section className="section" style={{ paddingTop: 30 }}>
        <div className="container grid-2" style={{ alignItems: 'start', gridTemplateColumns: '1.3fr 1fr' }}>
          {sent ? (
            <div className="panel center" style={{ padding: 34 }}><h2>Message sent</h2><p className="muted">Your reference is</p><div className="ref-big">{sent}</div><p className="muted">We’ve emailed you a copy.</p></div>
          ) : (
            <form className="panel" onSubmit={submit} noValidate>
              <div className="form-grid">
                <Field label="Name" error={errors.name} required><input value={form.name} onChange={set('name')} required /></Field>
                <Field label="Email" error={errors.email} required><input type="email" value={form.email} onChange={set('email')} required /></Field>
                <Field label="Phone (optional)" error={errors.phone}><input type="tel" value={form.phone} onChange={set('phone')} /></Field>
                <Field label="Subject" error={errors.subject}><select value={form.subject} onChange={set('subject')}>{inquirySubjects.map((s) => <option key={s}>{s}</option>)}</select></Field>
                <Field label="Message" error={errors.message} className="span-2" required><textarea rows={6} value={form.message} onChange={set('message')} required /></Field>
                <label className="honeypot" aria-hidden="true">Website <input tabIndex={-1} autoComplete="off" value={form.website} onChange={set('website')} /></label>
              </div>
              <button className="btn btn-primary btn-lg" style={{ marginTop: 16 }} disabled={busy}>{busy ? 'Sending…' : 'Send message'}</button>
            </form>
          )}
          <div className="panel stack">
            {site.email && <p className="row"><IconMail size={20} style={{ color: 'var(--primary)' }} /><a href={`mailto:${site.email}`}>{site.email}</a></p>}
            {site.phone && <p className="row"><IconPhone size={20} style={{ color: 'var(--primary)' }} /><a href={`tel:${site.phone.replace(/[^\d+]/g, '')}`}>{site.phone}</a></p>}
            {site.messaging && <p className="row"><IconChat size={20} style={{ color: 'var(--primary)' }} />{site.messaging}</p>}
            {site.hours && <p className="row"><IconClock size={20} style={{ color: 'var(--primary)' }} />{site.hours}</p>}
            <p className="muted" style={{ fontSize: '0.88rem' }}>To report a concern about a profile, choose “Profile correction or removal”. We review every report.</p>
          </div>
        </div>
      </section>
    </>
  );
}
