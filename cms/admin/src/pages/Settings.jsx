import { useState } from 'react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useUi } from '../lib/ui';
import { money } from '../lib/format';
import { ErrorBox, Field, Loading, Modal, PageHead, Pill, Tabs, Toggle, useAction, useForm, useLoad, useQueryState } from '../components/kit';

const GROUPS = {
  general: ['siteName', 'logoText', 'logoSubtext', 'tagline', 'about', 'email', 'phone', 'messaging', 'hours', 'instagramUrl', 'xUrl', 'telegramUrl', 'whatsappUrl', 'currency'],
  homepage: ['heroTitle', 'heroText', 'announcement1', 'announcement2', 'announcement3', 'ageGateEnabled', 'ageGateText'],
  booking: ['autoConfirm', 'bookingLeadHours', 'bookingWindowDays', 'cancelCutoffHours', 'rescheduleLimit', 'slotMinutes', 'bufferMinutes', 'membersOnlyBooking', 'bookingPolicy', 'memberPaymentInstructions'],
  security: ['staffIdleMinutes', 'companionIdleMinutes', 'memberIdleMinutes'],
};
const IDLE_FIELDS = [
  ['staffIdleMinutes', 'CMS staff', 'Staff using this CMS'],
  ['companionIdleMinutes', 'Companion portal', 'Companions signed in to their portal on the website'],
  ['memberIdleMinutes', 'Member accounts', 'Clients signed in to their account on the website'],
];
const pickKeys = (s, keys) => Object.fromEntries(keys.map((k) => [k, s[k] ?? '']));

function SettingsForm({ initial, keys, manage, onSaved, children }) {
  const { form, set, setForm, errors, saving, submit } = useForm(pickKeys(initial, keys));
  const save = (e) => { e.preventDefault(); submit(async (f) => onSaved(await api.put('/settings', f)), 'Settings saved'); };
  return (
    <form onSubmit={save}>
      <fieldset disabled={!manage} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
        {children({ form, set, setForm, errors })}
        {manage && <div className="row" style={{ marginTop: 16 }}><button className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save'}</button></div>}
      </fieldset>
    </form>
  );
}

const flag = (form, setForm, key) => ({ checked: form[key] === '1', onChange: (v) => setForm({ ...form, [key]: v ? '1' : '0' }) });

function FeeModal({ fee, onClose, onSaved }) {
  const { meta } = useUi();
  const { form, set, setForm, errors, saving, submit } = useForm(fee?.id ? { ...fee, locationId: fee.locationId || '' } : { name: '', description: '', feeType: 'fixed', amount: '', locationId: '', isActive: true });
  const save = () => submit(async (f) => onSaved(await (fee?.id ? api.put(`/settings/fees/${fee.id}`, { ...f, locationId: f.locationId || null }) : api.post('/settings/fees', { ...f, locationId: f.locationId || null }))), 'Fee saved');
  return (
    <Modal title={fee?.id ? 'Edit fee' : 'New fee'} onClose={onClose} footer={<><button className="btn btn-ghost" onClick={onClose}>Cancel</button><button className="btn btn-primary" onClick={save} disabled={saving}>Save</button></>}>
      <div className="form-grid">
        <Field label="Name" error={errors.name} required className="span-2"><input value={form.name} onChange={set('name')} placeholder="Booking fee" /></Field>
        <Field label="Type"><select value={form.feeType} onChange={set('feeType')}><option value="fixed">Fixed amount</option><option value="percent">Percent of the rate</option></select></Field>
        <Field label={form.feeType === 'percent' ? 'Percent' : 'Amount'} error={errors.amount} required><input type="number" min={0} value={form.amount} onChange={set('amount')} /></Field>
        <Field label="Applies to" className="span-2" hint="Fees for a city also apply to its areas only if you pick the area itself"><select value={form.locationId} onChange={set('locationId')}><option value="">Every booking</option>{meta.locations.map((l) => <option key={l.id} value={l.id}>Bookings in {l.parentId ? `${l.parentName} — ${l.name}` : l.name}</option>)}</select></Field>
        <Field label="Description" className="span-2" hint="Shown to clients next to the fee"><input value={form.description || ''} onChange={set('description')} /></Field>
        <div className="span-2"><Toggle checked={form.isActive} onChange={(v) => setForm({ ...form, isActive: v })} label="Active" /></div>
      </div>
    </Modal>
  );
}

function Fees({ fees, manage, onChange }) {
  const { confirm } = useUi();
  const [modal, setModal] = useState(null);
  const [run] = useAction();
  return (
    <div className="card">
      <div className="card-head"><div><h2>Fees shown before confirmation</h2><span className="muted">Added to the rate on the booking page and in the confirmation. Existing bookings keep the fees they were quoted.</span></div>
        {manage && <button className="btn btn-sm btn-primary" onClick={() => setModal({})}>+ New fee</button>}</div>
      <table className="table">
        <tbody>{fees.map((f) => (
          <tr key={f.id}>
            <td><strong>{f.name}</strong><span className="sub">{f.description}</span></td>
            <td>{f.feeType === 'percent' ? `${f.amount}% of the rate` : money(f.amount)}</td>
            <td>{f.locationName ? `Only ${f.locationName}` : 'Every booking'}</td>
            <td>{manage ? <Toggle checked={f.isActive} onChange={(v) => run(() => api.patch(`/settings/fees/${f.id}`, { isActive: v })).then((r) => r && onChange(r))} /> : <Pill>{f.isActive ? 'Active' : 'Inactive'}</Pill>}</td>
            {manage && <td className="actions nowrap"><button className="btn btn-sm btn-ghost" onClick={() => setModal(f)}>Edit</button> <button className="btn btn-sm btn-danger-ghost" onClick={async () => { if (await confirm({ title: `Delete ${f.name}?`, danger: true, confirmLabel: 'Delete' }) && await run(() => api.del(`/settings/fees/${f.id}`), 'Deleted')) onChange(fees.filter((x) => x.id !== f.id)); }}>Delete</button></td>}
          </tr>
        ))}</tbody>
      </table>
      {!fees.length && <div className="card-body muted">No fees — clients only see the rate.</div>}
      {modal && <FeeModal fee={modal} onClose={() => setModal(null)} onSaved={(r) => { setModal(null); onChange(Array.isArray(r) ? r : r.fees); }} />}
    </div>
  );
}

function EmailBox({ email, manage }) {
  const { user } = useAuth();
  const [to, setTo] = useState(user.email);
  const [run, busy] = useAction();
  return (
    <div className="card card-pad stack">
      <h2>Email</h2>
      {email.configured ? <p>Emails are sent from <strong>{email.sender}</strong> through Gmail.</p> : <div className="banner-error">Email isn’t set up. Add GMAIL_USER and GMAIL_APP_PASSWORD to the API environment — until then emails are skipped (and logged).</div>}
      {manage && email.configured && <div className="row"><input value={to} onChange={(e) => setTo(e.target.value)} aria-label="Send test to" style={{ flex: 1 }} /><button className="btn btn-ghost" disabled={busy} onClick={() => run(() => api.post('/settings/email/test', { to }), `Test email sent to ${to}`)}>Send test</button></div>}
    </div>
  );
}

export default function Settings() {
  const { can } = useAuth();
  const { loadMeta } = useUi();
  const manage = can('settings', 'manage');
  const [q, setQ] = useQueryState({ tab: 'general' });
  const { data, loading, error, reload, setData } = useLoad(() => api.get('/settings'), []);
  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  const saved = (r) => { setData(r); loadMeta(); };
  const s = data.settings;
  return (
    <>
      <PageHead title="Site settings" subtitle="Brand and contact details, homepage text, website theme, booking rules, fees and sign-in security." />
      <Tabs tabs={[['general', 'Brand & contact'], ['homepage', 'Homepage & notices'], ['theme', 'Website theme'], ['booking', 'Booking rules'], ['fees', 'Fees'], ['security', 'Security'], ['email', 'Email']]} value={q.tab} onChange={(tab) => setQ({ tab })} />
      {q.tab === 'general' && (
        <SettingsForm key="general" initial={s} keys={GROUPS.general} manage={manage} onSaved={saved}>
          {({ form, set, errors }) => (
            <div className="card card-pad form-grid">
              <Field label="Site name" error={errors.siteName} required><input value={form.siteName} onChange={set('siteName')} /></Field>
              <Field label="Currency" error={errors.currency}><select value={form.currency} onChange={set('currency')}>{['PHP', 'USD', 'EUR', 'GBP', 'SGD', 'HKD', 'AUD', 'THB'].map((c) => <option key={c}>{c}</option>)}</select></Field>
              <Field label="Logo text" error={errors.logoText} required><input value={form.logoText} onChange={set('logoText')} /></Field>
              <Field label="Logo subtext" error={errors.logoSubtext}><input value={form.logoSubtext} onChange={set('logoSubtext')} /></Field>
              <Field label="Tagline" error={errors.tagline} className="span-2"><input value={form.tagline} onChange={set('tagline')} /></Field>
              <Field label="About (footer)" error={errors.about} className="span-2"><textarea rows={2} value={form.about} onChange={set('about')} /></Field>
              <Field label="Concierge email" error={errors.email} hint="Receives copies of booking requests and contact messages"><input value={form.email} onChange={set('email')} /></Field>
              <Field label="Phone" error={errors.phone}><input value={form.phone} onChange={set('phone')} /></Field>
              <Field label="Messaging" error={errors.messaging} hint="e.g. Telegram @aurelia · WhatsApp +63…"><input value={form.messaging} onChange={set('messaging')} /></Field>
              <Field label="Hours" error={errors.hours}><input value={form.hours} onChange={set('hours')} /></Field>
              <Field label="Instagram" error={errors.instagramUrl}><input value={form.instagramUrl} onChange={set('instagramUrl')} placeholder="https://" /></Field>
              <Field label="X (Twitter)" error={errors.xUrl}><input value={form.xUrl} onChange={set('xUrl')} placeholder="https://" /></Field>
              <Field label="Telegram" error={errors.telegramUrl}><input value={form.telegramUrl} onChange={set('telegramUrl')} placeholder="https://t.me/…" /></Field>
              <Field label="WhatsApp" error={errors.whatsappUrl}><input value={form.whatsappUrl} onChange={set('whatsappUrl')} placeholder="https://wa.me/…" /></Field>
            </div>
          )}
        </SettingsForm>
      )}
      {q.tab === 'homepage' && (
        <SettingsForm key="homepage" initial={s} keys={GROUPS.homepage} manage={manage} onSaved={saved}>
          {({ form, set, setForm, errors }) => (
            <div className="grid-2" style={{ alignItems: 'start' }}>
              <div className="card card-pad stack">
                <h2>Homepage</h2>
                <Field label="Hero title" error={errors.heroTitle}><input value={form.heroTitle} onChange={set('heroTitle')} /></Field>
                <Field label="Hero text" error={errors.heroText}><textarea rows={3} value={form.heroText} onChange={set('heroText')} /></Field>
                <div className="section-title">Announcement bar</div>
                <p className="muted">Rotates at the top of every page. Wrap words in **double stars** to make them bold.</p>
                {[1, 2, 3].map((n) => <Field key={n} label={`Message ${n}`} error={errors[`announcement${n}`]}><input value={form[`announcement${n}`]} onChange={set(`announcement${n}`)} /></Field>)}
              </div>
              <div className="card card-pad stack">
                <h2>Adults-only notice</h2>
                <Toggle {...flag(form, setForm, 'ageGateEnabled')} label="Ask visitors to confirm they are 18+" hint="Shown once per browser before the site opens" />
                <Field label="Notice text" error={errors.ageGateText}><textarea rows={5} value={form.ageGateText} onChange={set('ageGateText')} /></Field>
              </div>
            </div>
          )}
        </SettingsForm>
      )}
      {q.tab === 'theme' && (
        <div className="grid-3">
          {data.themes.map((t) => (
            <button key={t.id} type="button" className="card card-pad stack" disabled={!manage} style={{ textAlign: 'left', cursor: manage ? 'pointer' : 'default', borderColor: s.theme === t.id ? 'var(--primary)' : undefined, boxShadow: s.theme === t.id ? '0 0 0 2px var(--primary-soft)' : undefined }}
              onClick={async () => { if (s.theme !== t.id) saved(await api.put('/settings', { theme: t.id })); }}>
              <div style={{ height: 90, borderRadius: 10, background: `linear-gradient(135deg, ${t.vars['--hero-a']}, ${t.vars['--bg']})`, border: '1px solid var(--line)', padding: 12, display: 'flex', gap: 8, alignItems: 'flex-end' }}>
                <span style={{ background: t.vars['--primary'], color: t.vars['--on-primary'], padding: '6px 12px', borderRadius: 999, fontWeight: 700, fontSize: 12 }}>Book</span>
                <span style={{ background: t.vars['--surface'], color: t.vars['--text'], padding: '6px 12px', borderRadius: 8, fontSize: 12, border: `1px solid ${t.vars['--line']}` }}>Profile</span>
              </div>
              <strong>{t.name} {s.theme === t.id && <Pill tone="green">In use</Pill>}</strong>
              <span className="muted">{t.description}</span>
            </button>
          ))}
        </div>
      )}
      {q.tab === 'booking' && (
        <SettingsForm key="booking" initial={s} keys={GROUPS.booking} manage={manage} onSaved={saved}>
          {({ form, set, setForm, errors }) => (
            <div className="grid-2" style={{ alignItems: 'start' }}>
              <div className="card card-pad stack">
                <h2>Booking rules</h2>
                <Toggle {...flag(form, setForm, 'autoConfirm')} label="Confirm online requests automatically" hint="Off = requests wait for the concierge" />
                <Toggle {...flag(form, setForm, 'membersOnlyBooking')} label="Only signed-in members can book" hint="Guests can still send inquiries" />
                <div className="form-grid">
                  <Field label="Earliest booking (hours from now)" error={errors.bookingLeadHours}><input type="number" value={form.bookingLeadHours} onChange={set('bookingLeadHours')} /></Field>
                  <Field label="Bookable up to (days ahead)" error={errors.bookingWindowDays}><input type="number" value={form.bookingWindowDays} onChange={set('bookingWindowDays')} /></Field>
                  <Field label="Online changes close (hours before)" error={errors.cancelCutoffHours}><input type="number" value={form.cancelCutoffHours} onChange={set('cancelCutoffHours')} /></Field>
                  <Field label="Online reschedules per booking" error={errors.rescheduleLimit}><input type="number" value={form.rescheduleLimit} onChange={set('rescheduleLimit')} /></Field>
                  <Field label="Start times every" error={errors.slotMinutes}><select value={form.slotMinutes} onChange={set('slotMinutes')}><option value="15">15 minutes</option><option value="30">30 minutes</option><option value="60">hour</option></select></Field>
                  <Field label="Free time between bookings (min)" error={errors.bufferMinutes}><input type="number" value={form.bufferMinutes} onChange={set('bufferMinutes')} /></Field>
                </div>
              </div>
              <div className="card card-pad stack">
                <Field label="Booking policy" error={errors.bookingPolicy} hint="Shown after booking and in emails"><textarea rows={5} value={form.bookingPolicy} onChange={set('bookingPolicy')} /></Field>
                <Field label="Membership payment instructions" error={errors.memberPaymentInstructions} hint="Shown when a member requests a tier"><textarea rows={5} value={form.memberPaymentInstructions} onChange={set('memberPaymentInstructions')} /></Field>
              </div>
            </div>
          )}
        </SettingsForm>
      )}
      {q.tab === 'security' && (
        <SettingsForm key="security" initial={s} keys={GROUPS.security} manage={manage} onSaved={saved}>
          {({ form, set, errors }) => (
            <div className="card card-pad stack">
              <div>
                <h2>Sign out after inactivity</h2>
                <p className="muted" style={{ margin: '4px 0 0' }}>Signs people out when they haven’t used the site for this many minutes, even with “Keep me signed in” ticked. A warning appears a minute before, with the option to stay signed in. Enter 0 to turn it off.</p>
              </div>
              <div className="form-grid cols-3">
                {IDLE_FIELDS.map(([key, label, hint]) => (
                  <Field key={key} label={`${label} (minutes)`} error={errors[key]} hint={hint}>
                    <input type="number" min={0} max={1440} value={form[key]} onChange={set(key)} />
                  </Field>
                ))}
              </div>
            </div>
          )}
        </SettingsForm>
      )}
      {q.tab === 'fees' && <Fees fees={data.fees} manage={manage} onChange={(fees) => setData({ ...data, fees })} />}
      {q.tab === 'email' && <EmailBox email={data.email} manage={manage} />}
    </>
  );
}
