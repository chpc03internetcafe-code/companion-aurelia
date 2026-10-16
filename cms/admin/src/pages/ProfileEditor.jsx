// Profile editor: details & verification, media (photos, videos, alt text, VIP-only), rates, weekly availability,
// time off, visibility & SEO, and retiring a profile (with an optional redirect).
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useUi } from '../lib/ui';
import { dateTime, day, duration, money, WEEKDAYS } from '../lib/format';
import { ErrorBox, Field, KeyVals, Loading, Modal, PageHead, Pill, SeoFields, Tabs, Toggle, useAction, useForm, useLoad, useQueryState } from '../components/kit';
import PortalAccess from '../components/PortalAccess';

const EMPTY = {
  displayName: '', slug: '', categoryId: '', baseLocationId: '', areaIds: [], age: '', tagline: '', bio: '', languages: '', nationality: '', heightCm: '',
  attributes: [], status: 'Draft', isFeatured: false, isVerified: false, ageVerified: false, verificationNotes: '', vipTierId: '', bookingEnabled: true,
  awayUntil: '', awayNote: '', seoTitle: '', metaDescription: '', staffNotes: '',
};
const toForm = (p) => Object.fromEntries(Object.keys(EMPTY).map((k) => [k, p[k] ?? EMPTY[k]]));

function Details({ form, set, setForm, errors, manage }) {
  const { meta } = useUi();
  const cities = meta.locations.filter((l) => !l.parentId);
  const toggleArea = (id) => setForm({ ...form, areaIds: form.areaIds.includes(id) ? form.areaIds.filter((x) => x !== id) : [...form.areaIds, id] });
  const attrs = form.attributes;
  return (
    <div className="grid-2" style={{ alignItems: 'start' }}>
      <div className="card card-pad form-grid">
        <Field label="Display name" error={errors.displayName} required><input value={form.displayName} onChange={set('displayName')} /></Field>
        <Field label="Age" error={errors.age} required hint="Adults only — 18 or over"><input type="number" min={18} max={99} value={form.age} onChange={set('age')} /></Field>
        <Field label="Category" error={errors.categoryId} required><select value={form.categoryId} onChange={set('categoryId')}><option value="">Choose…</option>{meta.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
        <Field label="Based in" error={errors.baseLocationId}><select value={form.baseLocationId} onChange={set('baseLocationId')}><option value="">—</option>{meta.locations.map((l) => <option key={l.id} value={l.id}>{l.parentId ? `${l.parentName} — ${l.name}` : l.name}</option>)}</select></Field>
        <Field label="Tagline" error={errors.tagline} className="span-2" hint="One line shown on cards and at the top of the profile"><input value={form.tagline || ''} onChange={set('tagline')} maxLength={160} /></Field>
        <Field label="Biography" error={errors.bio} className="span-2"><textarea rows={7} value={form.bio || ''} onChange={set('bio')} /></Field>
        <Field label="Languages" error={errors.languages} hint="Comma separated"><input value={form.languages || ''} onChange={set('languages')} /></Field>
        <Field label="Nationality" error={errors.nationality}><input value={form.nationality || ''} onChange={set('nationality')} /></Field>
        <Field label="Height (cm)" error={errors.heightCm}><input type="number" value={form.heightCm || ''} onChange={set('heightCm')} /></Field>
      </div>
      <div className="stack">
        <div className="card card-pad">
          <div className="section-title" style={{ marginTop: 0 }}>Service areas</div>
          <p className="muted">The profile also appears in these cities and areas.</p>
          <div className="stack">
            {cities.map((c) => (
              <div key={c.id}>
                <label className="check"><input type="checkbox" checked={form.areaIds.includes(c.id)} onChange={() => toggleArea(c.id)} disabled={!manage} /> <strong>{c.name}</strong></label>
                <div className="row" style={{ paddingLeft: 24, gap: 14 }}>
                  {meta.locations.filter((a) => a.parentId === c.id).map((a) => <label key={a.id} className="check"><input type="checkbox" checked={form.areaIds.includes(a.id)} onChange={() => toggleArea(a.id)} disabled={!manage} /> {a.name}</label>)}
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="card card-pad">
          <div className="section-title" style={{ marginTop: 0 }}>Facts</div>
          <p className="muted">Shown as a list on the profile (e.g. Hair, Style, Interests).</p>
          {errors.attributes && <div className="banner-error">{errors.attributes}</div>}
          <div className="stack">
            {attrs.map((a, i) => (
              <div key={i} className="row" style={{ flexWrap: 'nowrap' }}>
                <input value={a.label} onChange={(e) => setForm({ ...form, attributes: attrs.map((x, k) => (k === i ? { ...x, label: e.target.value } : x)) })} placeholder="Label" style={{ width: 140 }} aria-label="Label" />
                <input value={a.value} onChange={(e) => setForm({ ...form, attributes: attrs.map((x, k) => (k === i ? { ...x, value: e.target.value } : x)) })} placeholder="Value" style={{ flex: 1 }} aria-label="Value" />
                <button type="button" className="icon-btn" onClick={() => setForm({ ...form, attributes: attrs.filter((_, k) => k !== i) })} aria-label="Remove">✕</button>
              </div>
            ))}
            {manage && <div><button type="button" className="btn btn-sm btn-soft" onClick={() => setForm({ ...form, attributes: [...attrs, { label: '', value: '' }] })}>+ Fact</button></div>}
          </div>
        </div>
      </div>
    </div>
  );
}

function Visibility({ form, set, setForm, errors, profile }) {
  const { meta } = useUi();
  return (
    <div className="grid-2" style={{ alignItems: 'start' }}>
      <div className="stack">
        <div className="card card-pad stack">
          <div className="section-title" style={{ marginTop: 0 }}>Verification</div>
          <Toggle checked={form.ageVerified} onChange={(v) => setForm({ ...form, ageVerified: v })} label="Government ID checked — 18 or over" hint="Required before the profile can be published" />
          {errors.ageVerified && <div className="banner-error">{errors.ageVerified}</div>}
          <Toggle checked={form.isVerified} onChange={(v) => setForm({ ...form, isVerified: v })} label="Verified badge" hint="Photos and identity confirmed in person" />
          {profile && <KeyVals rows={[['ID checked', profile.ageVerifiedAt ? dateTime(profile.ageVerifiedAt) : null], ['Verified', profile.verifiedAt ? dateTime(profile.verifiedAt) : null]]} />}
          <Field label="Verification notes (staff only)" hint="Never shown on the website. Don’t store ID numbers here."><textarea rows={3} value={form.verificationNotes || ''} onChange={set('verificationNotes')} /></Field>
        </div>
        <div className="card card-pad stack">
          <div className="section-title" style={{ marginTop: 0 }}>Visibility</div>
          <Field label="Status" error={errors.status}><select value={form.status} onChange={set('status')}><option>Draft</option><option>Published</option><option>Hidden</option></select></Field>
          <Toggle checked={form.isFeatured} onChange={(v) => setForm({ ...form, isFeatured: v })} label="Featured" hint="Shown first in the directory and on the homepage" />
          <Field label="VIP profile" hint="Only members of this tier or higher see the profile. Kept out of search engines."><select value={form.vipTierId || ''} onChange={set('vipTierId')}><option value="">Public — everyone</option>{meta.tiers.map((t) => <option key={t.id} value={t.id}>{t.name} members and up</option>)}</select></Field>
          <Toggle checked={form.bookingEnabled} onChange={(v) => setForm({ ...form, bookingEnabled: v })} label="Online booking" hint="Off = clients can only send an inquiry" />
          <div className="form-grid">
            <Field label="Away until" error={errors.awayUntil} hint="Hides availability up to this date"><input type="date" value={form.awayUntil || ''} onChange={set('awayUntil')} /></Field>
            <Field label="Away note"><input value={form.awayNote || ''} onChange={set('awayNote')} placeholder="Travelling — back soon" /></Field>
          </div>
        </div>
      </div>
      <div className="stack">
        <div className="card card-pad"><div className="section-title" style={{ marginTop: 0 }}>Search engines</div>
          <Field label="URL slug" error={errors.slug} hint="Changing it adds a redirect from the old URL automatically."><input value={form.slug || ''} onChange={set('slug')} /></Field>
          <div style={{ marginTop: 12 }}><SeoFields form={form} set={set} errors={errors} fallbackTitle={`${form.displayName || 'Name'}, ${form.age || '…'} — companion`} fallbackDescription={form.tagline} path={`/companions/${form.slug || '…'}`} /></div>
        </div>
        <div className="card card-pad"><div className="section-title" style={{ marginTop: 0 }}>Staff notes</div>
          <textarea rows={5} value={form.staffNotes || ''} onChange={set('staffNotes')} aria-label="Staff notes" style={{ width: '100%' }} /></div>
      </div>
    </div>
  );
}

function Media({ p, onChange, manage }) {
  const fileRef = useRef(null);
  const [run, busy] = useAction();
  const [video, setVideo] = useState(null);
  const [vipUpload, setVipUpload] = useState(false);
  const upload = async (files) => {
    if (!files?.length) return;
    const fd = new FormData();
    for (const f of files) fd.append('photos', f);
    fd.append('vipOnly', vipUpload ? 'true' : 'false');
    const r = await run(() => api.post(`/profiles/${p.id}/media`, fd), `${files.length} photo(s) uploaded`);
    if (r) onChange(r);
    fileRef.current.value = '';
  };
  const patch = async (m, body, msg) => { const r = await run(() => api.patch(`/profiles/${p.id}/media/${m.id}`, body), msg); if (r) onChange(r); };
  const move = async (i, d) => {
    const order = p.media.map((m) => m.id);
    [order[i], order[i + d]] = [order[i + d], order[i]];
    const r = await run(() => api.put(`/profiles/${p.id}/media`, { order }));
    if (r) onChange(r);
  };
  return (
    <div className="stack">
      {manage && (
        <div className="card card-pad row">
          <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" multiple hidden onChange={(e) => upload(e.target.files)} />
          <button className="btn btn-primary" onClick={() => fileRef.current.click()} disabled={busy}>{busy ? 'Uploading…' : '+ Upload photos'}</button>
          <label className="check"><input type="checkbox" checked={vipUpload} onChange={(e) => setVipUpload(e.target.checked)} /> Upload as VIP-only (private gallery)</label>
          <span className="spacer" />
          <button className="btn btn-ghost" onClick={() => setVideo({ url: '', posterUrl: '', altText: '', vipOnly: false })}>+ Add video link</button>
          <span className="muted" style={{ width: '100%' }}>JPG, PNG or WEBP up to 4 MB. The main photo is used on cards and when sharing. Videos: YouTube, Vimeo or an https link to an .mp4 file.</span>
        </div>
      )}
      {p.media.length ? (
        <div className="media-grid">
          {p.media.map((m, i) => (
            <div key={m.id} className={`media-item ${m.isPrimary ? 'primary' : ''}`}>
              <div className="media-img">
                {m.kind === 'video' ? (m.posterUrl ? <img src={m.posterUrl} alt="" /> : <div style={{ display: 'grid', placeItems: 'center', height: '100%', color: '#fff', fontSize: 30 }}>▶</div>) : <img src={m.url} alt="" loading="lazy" />}
                <div className="media-tags">{m.isPrimary && <Pill tone="green">Main</Pill>}{m.vipOnly && <Pill tone="violet">VIP</Pill>}{m.kind === 'video' && <Pill tone="blue">Video</Pill>}</div>
              </div>
              <div className="media-body">
                <input defaultValue={m.altText || ''} placeholder="Alt text" aria-label="Alt text" disabled={!manage} onBlur={(e) => e.target.value !== (m.altText || '') && patch(m, { altText: e.target.value }, 'Alt text saved')} />
                {manage && (
                  <div className="media-actions">
                    <button className="icon-btn" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Move earlier">←</button>
                    <button className="icon-btn" disabled={i === p.media.length - 1} onClick={() => move(i, 1)} aria-label="Move later">→</button>
                    {m.kind === 'photo' && !m.isPrimary && <button className="btn btn-sm btn-ghost" onClick={() => patch(m, { isPrimary: true }, 'Main photo set')}>Main</button>}
                    <button className="btn btn-sm btn-ghost" onClick={() => patch(m, { vipOnly: !m.vipOnly }, m.vipOnly ? 'Now public' : 'Now VIP-only')}>{m.vipOnly ? 'Public' : 'VIP'}</button>
                    <button className="btn btn-sm btn-danger-ghost" onClick={async () => { const r = await run(() => api.del(`/profiles/${p.id}/media/${m.id}`), 'Removed'); if (r) onChange(r); }}>✕</button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      ) : <div className="card card-pad muted">No photos yet. Profiles without photos show initials on the website.</div>}
      {video && (
        <Modal title="Add a video" onClose={() => setVideo(null)} footer={<><button className="btn btn-ghost" onClick={() => setVideo(null)}>Cancel</button>
          <button className="btn btn-primary" disabled={busy} onClick={async () => { const r = await run(() => api.post(`/profiles/${p.id}/video`, video), 'Video added'); if (r) { onChange(r); setVideo(null); } }}>Add video</button></>}>
          <div className="stack">
            <Field label="Video link" required hint="YouTube, Vimeo, or https link to an .mp4 / .webm file"><input value={video.url} onChange={(e) => setVideo({ ...video, url: e.target.value })} autoFocus /></Field>
            <Field label="Poster image link (optional)"><input value={video.posterUrl} onChange={(e) => setVideo({ ...video, posterUrl: e.target.value })} /></Field>
            <Field label="Description (alt text)"><input value={video.altText} onChange={(e) => setVideo({ ...video, altText: e.target.value })} /></Field>
            <Toggle checked={video.vipOnly} onChange={(v) => setVideo({ ...video, vipOnly: v })} label="VIP-only" />
          </div>
        </Modal>
      )}
    </div>
  );
}

function Rates({ p, onChange, manage }) {
  const [rates, setRates] = useState(p.rates.map((r) => ({ ...r })));
  const [run, busy] = useAction();
  useEffect(() => setRates(p.rates.map((r) => ({ ...r }))), [p.rates]);
  const setR = (i, k, v) => setRates(rates.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  const save = async () => { const r = await run(() => api.put(`/profiles/${p.id}/rates`, { rates }), 'Rates saved'); if (r) onChange(r); };
  const prices = rates.filter((r) => r.isActive !== false && r.price !== '' && r.price != null).map((r) => Number(r.price));
  const PRESETS = [60, 120, 180, 240, 300, 480];
  return (
    <div className="card">
      <div className="card-body stack">
        <p className="muted" style={{ margin: 0 }}>Published rates per session length. Clients choose one when booking; fees from Site Settings are added and shown before they confirm. Bookings keep the rate they were made with.</p>
        <table className="table compact">
          <thead><tr><th>Label</th><th>Length</th><th>Price</th><th>Note</th><th>Active</th>{manage && <th />}</tr></thead>
          <tbody>{rates.map((r, i) => (
            <tr key={r.id || `n${i}`}>
              <td><input value={r.label} onChange={(e) => setR(i, 'label', e.target.value)} placeholder="Dinner date" disabled={!manage} /></td>
              <td><select value={r.durationMinutes} onChange={(e) => setR(i, 'durationMinutes', Number(e.target.value))} disabled={!manage}>
                {[...new Set([...PRESETS, 30, 90, 360, 600, 720, 1440, r.durationMinutes])].sort((a, b) => a - b).map((m) => <option key={m} value={m}>{duration(m)}</option>)}</select></td>
              <td><input type="number" min={0} value={r.price} onChange={(e) => setR(i, 'price', e.target.value)} style={{ width: 120 }} disabled={!manage} /></td>
              <td><input value={r.notes || ''} onChange={(e) => setR(i, 'notes', e.target.value)} placeholder="Optional" disabled={!manage} /></td>
              <td><input type="checkbox" checked={r.isActive !== false} onChange={(e) => setR(i, 'isActive', e.target.checked)} disabled={!manage} aria-label="Active" /></td>
              {manage && <td><button className="icon-btn" onClick={() => setRates(rates.filter((_, j) => j !== i))} aria-label="Remove">✕</button></td>}
            </tr>
          ))}</tbody>
        </table>
        {manage && <div className="row">
          <button className="btn btn-sm btn-soft" onClick={() => setRates([...rates, { label: '', durationMinutes: 120, price: '', notes: '', isActive: true }])}>+ Rate</button>
          <span className="spacer" />
          <button className="btn btn-primary" onClick={save} disabled={busy}>Save rates</button>
        </div>}
        {prices.length > 0 && <p className="muted" style={{ margin: 0 }}>The website shows “from {money(Math.min(...prices), true)}”.</p>}
      </div>
    </div>
  );
}

function Availability({ p, onChange, manage }) {
  const [blocks, setBlocks] = useState(p.schedule.map(({ weekday, start, end }) => ({ weekday, start, end })));
  const [off, setOff] = useState(p.timeOff.map(({ startDate, endDate, note }) => ({ startDate, endDate, note: note || '' })));
  const [run, busy] = useAction();
  useEffect(() => { setBlocks(p.schedule.map(({ weekday, start, end }) => ({ weekday, start, end }))); setOff(p.timeOff.map(({ startDate, endDate, note }) => ({ startDate, endDate, note: note || '' }))); }, [p.schedule, p.timeOff]);
  const saveWeek = async () => { const r = await run(() => api.put(`/profiles/${p.id}/schedule`, { blocks: blocks.map((b) => ({ ...b, end: b.end === '00:00' ? '24:00' : b.end })) }), 'Availability saved'); if (r) onChange(r); };
  const saveOff = async () => { const r = await run(() => api.put(`/profiles/${p.id}/time-off`, { items: off }), 'Time off saved'); if (r) onChange(r); };
  const copyToAll = (d) => {
    const src = blocks.filter((b) => b.weekday === d);
    setBlocks([...src, ...[0, 1, 2, 3, 4, 5, 6].filter((x) => x !== d).flatMap((x) => src.map((b) => ({ ...b, weekday: x })))]);
  };
  return (
    <div className="grid-2" style={{ alignItems: 'start' }}>
      <div className="card card-pad">
        <div className="section-title" style={{ marginTop: 0 }}>Weekly availability</div>
        <p className="muted">Clients can book sessions that fit inside these hours. Use 00:00 as the end time for “until midnight”.</p>
        <div className="week-editor">
          {[1, 2, 3, 4, 5, 6, 0].map((d) => {
            const day = blocks.map((b, i) => [b, i]).filter(([b]) => b.weekday === d);
            return (
              <div key={d} className="week-row">
                <strong>{WEEKDAYS[d]}</strong>
                <div className="week-blocks">
                  {day.map(([b, i]) => (
                    <span key={i} className="week-block">
                      <input type="time" value={b.start} onChange={(e) => setBlocks(blocks.map((x, k) => (k === i ? { ...x, start: e.target.value } : x)))} disabled={!manage} aria-label="From" />–
                      <input type="time" value={b.end === '24:00' ? '00:00' : b.end} onChange={(e) => setBlocks(blocks.map((x, k) => (k === i ? { ...x, end: e.target.value } : x)))} disabled={!manage} aria-label="To" />
                      {manage && <button className="icon-btn" onClick={() => setBlocks(blocks.filter((_, k) => k !== i))} aria-label="Remove">✕</button>}
                    </span>
                  ))}
                  {!day.length && <span className="muted">Not available</span>}
                  {manage && <button className="btn btn-sm btn-soft" onClick={() => setBlocks([...blocks, { weekday: d, start: '18:00', end: '24:00' }])}>+ Hours</button>}
                  {manage && day.length > 0 && <button className="link" onClick={() => copyToAll(d)}>Copy to every day</button>}
                </div>
              </div>
            );
          })}
        </div>
        {manage && <div className="row" style={{ marginTop: 12 }}><span className="spacer" /><button className="btn btn-primary" onClick={saveWeek} disabled={busy}>Save availability</button></div>}
      </div>
      <div className="card card-pad">
        <div className="section-title" style={{ marginTop: 0 }}>Time off</div>
        <p className="muted">Days the profile can’t be booked (travel, holidays).</p>
        <div className="stack">
          {off.map((t, i) => (
            <div key={i} className="row" style={{ flexWrap: 'nowrap' }}>
              <input type="date" value={t.startDate} onChange={(e) => setOff(off.map((x, k) => (k === i ? { ...x, startDate: e.target.value, endDate: x.endDate < e.target.value ? e.target.value : x.endDate } : x)))} disabled={!manage} aria-label="From" />
              <input type="date" value={t.endDate} min={t.startDate} onChange={(e) => setOff(off.map((x, k) => (k === i ? { ...x, endDate: e.target.value } : x)))} disabled={!manage} aria-label="To" />
              <input value={t.note} onChange={(e) => setOff(off.map((x, k) => (k === i ? { ...x, note: e.target.value } : x)))} placeholder="Note" disabled={!manage} style={{ flex: 1 }} aria-label="Note" />
              {manage && <button className="icon-btn" onClick={() => setOff(off.filter((_, k) => k !== i))} aria-label="Remove">✕</button>}
            </div>
          ))}
          {!off.length && <p className="muted">No time off planned.</p>}
        </div>
        {manage && <div className="row" style={{ marginTop: 12 }}>
          <button className="btn btn-sm btn-soft" onClick={() => { const t = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10); setOff([...off, { startDate: t, endDate: t, note: '' }]); }}>+ Time off</button>
          <span className="spacer" /><button className="btn btn-primary" onClick={saveOff} disabled={busy}>Save time off</button>
        </div>}
      </div>
    </div>
  );
}

function RetireModal({ p, onClose, onDone }) {
  const [to, setTo] = useState(p.baseLocationId ? '' : `/${p.categorySlug}`);
  const { meta } = useUi();
  const [run, busy] = useAction();
  const loc = meta.locations.find((l) => l.id === p.baseLocationId);
  return (
    <Modal title={`Retire ${p.displayName}?`} onClose={onClose} footer={<><button className="btn btn-ghost" onClick={onClose}>Cancel</button>
      <button className="btn btn-danger" disabled={busy} onClick={async () => { const r = await run(() => api.post(`/profiles/${p.id}/retire`, { redirectTo: to }), 'Profile retired'); if (r) onDone(r); }}>Retire profile</button></>}>
      <div className="stack">
        <p>The profile leaves the website, collections and the sitemap. Booking history is kept and you can restore it later.</p>
        {p.stats.openBookings > 0 && <div className="banner-error">{p.stats.openBookings} open booking(s) — cancel or reassign them first.</div>}
        <Field label="Send visitors of the old link to (optional)" hint="Without a redirect, the old link shows a “no longer available” page with similar profiles.">
          <input value={to} onChange={(e) => setTo(e.target.value)} placeholder="/locations/makati" />
        </Field>
        <div className="row">
          {loc && <button className="btn btn-sm btn-soft" onClick={() => setTo(`/locations/${loc.slug}`)}>{loc.name} page</button>}
          <button className="btn btn-sm btn-soft" onClick={() => setTo(`/${p.categorySlug}`)}>{p.categoryName} page</button>
          <button className="btn btn-sm btn-soft" onClick={() => setTo('')}>No redirect</button>
        </div>
      </div>
    </Modal>
  );
}

export default function ProfileEditor() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { can } = useAuth();
  const { confirm, meta } = useUi();
  const manage = can('profiles', 'manage');
  const [q, setQ] = useQueryState({ tab: 'details' });
  const existing = useLoad(() => (id ? api.get(`/profiles/${id}`) : Promise.resolve(null)), [id]);
  const [p, setP] = useState(null);
  const { form, setForm, set, errors, saving, submit } = useForm({ ...EMPTY, categoryId: meta.categories[0]?.id || '' });
  const [run, busy] = useAction();
  const [retiring, setRetiring] = useState(false);
  useEffect(() => { if (existing.data) { setP(existing.data); setForm(toForm(existing.data)); } }, [existing.data]); // eslint-disable-line react-hooks/exhaustive-deps
  if (id && existing.loading) return <Loading />;
  if (existing.error) return <ErrorBox error={existing.error} />;

  const body = (f) => ({ ...f, baseLocationId: f.baseLocationId || null, vipTierId: f.vipTierId || null, heightCm: f.heightCm || null, awayUntil: f.awayUntil || null,
    attributes: f.attributes.filter((a) => a.label.trim() && a.value.trim()) });
  const save = async () => {
    const r = await submit(() => (id ? api.put(`/profiles/${id}`, body(form)) : api.post('/profiles', body(form))), 'Profile saved');
    if (r) { setP(r); setForm(toForm(r)); if (!id) navigate(`/profiles/${r.id}?tab=media`, { replace: true }); }
  };
  const updated = (r) => { setP(r); };
  const retired = p?.status === 'Retired';
  const website = meta.websiteUrl || 'http://localhost:5173';
  const checklist = p ? [
    [p.ageVerified, 'ID checked (18+)'], [p.media.some((m) => m.kind === 'photo'), 'Photos'], [p.rates.some((r) => r.isActive), 'Rates'], [p.schedule.length > 0, 'Availability'], [!!p.metaDescription, 'Meta description'],
  ] : [];

  return (
    <div>
      <PageHead back={['Profiles', '/profiles']} title={id ? (p?.displayName || form.displayName) : 'New profile'}
        subtitle={p && <>{p.status === 'Published' && !retired ? <a href={`${website}/companions/${p.slug}`} target="_blank" rel="noreferrer">/companions/{p.slug} ↗</a> : `/companions/${p.slug}`} · updated {day(p.updatedAt)}{p.lastActiveAt ? ` · active ${dateTime(p.lastActiveAt)}` : ''}</>}
        actions={manage && <>
          {p && !retired && <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => run(() => api.patch(`/profiles/${p.id}`, { markActive: true }), 'Marked as recently active').then((r) => r && updated(r))}>Mark active now</button>}
          {p && !retired && <button type="button" className="btn btn-danger-ghost" onClick={() => setRetiring(true)}>Retire…</button>}
          {retired && <button type="button" className="btn btn-ghost" onClick={() => run(() => api.post(`/profiles/${p.id}/restore`), 'Restored as hidden').then((r) => r && (updated(r), setForm(toForm(r))))}>Restore</button>}
          {p && !p.stats.total && <button type="button" className="btn btn-danger-ghost" onClick={async () => { if (await confirm({ title: `Delete ${p.displayName} permanently?`, message: 'Photos are deleted too. This can’t be undone.', danger: true, confirmLabel: 'Delete' }) && await run(() => api.del(`/profiles/${p.id}`), 'Profile deleted')) navigate('/profiles'); }}>Delete</button>}
          {!retired && ['details', 'visibility'].includes(q.tab) && <button type="button" className="btn btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save profile'}</button>}
        </>}>
        {p && <div className="row" style={{ marginTop: 8 }}><Pill>{p.status}</Pill>{checklist.map(([ok, label]) => <Pill key={label} tone={ok ? 'green' : 'amber'}>{ok ? '✓' : '•'} {label}</Pill>)}{p.stats.openBookings > 0 && <Link to={`/bookings?profileId=${p.id}&status=Open`}><Pill tone="blue">{p.stats.openBookings} open bookings</Pill></Link>}{p.stats.favorites > 0 && <Pill tone="grey">♥ {p.stats.favorites}</Pill>}</div>}
      </PageHead>
      {retired && <div className="banner-info">This profile is retired and hidden from the website. Restore it to edit.</div>}
      <Tabs tabs={[['details', 'Details'], ['visibility', 'Verification, visibility & SEO'], id && ['media', 'Photos & videos', p?.media.length], id && ['rates', 'Rates', p?.rates.length], id && ['availability', 'Availability', p?.schedule.length], id && ['portal', 'Portal access']]} value={q.tab} onChange={(tab) => setQ({ tab })} />
      <fieldset disabled={!manage || retired} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
        {q.tab === 'details' && <Details form={form} set={set} setForm={setForm} errors={errors} manage={manage} />}
        {q.tab === 'visibility' && <Visibility form={form} set={set} setForm={setForm} errors={errors} profile={p} />}
        {q.tab === 'media' && p && <Media p={p} onChange={updated} manage={manage && !retired} />}
        {q.tab === 'rates' && p && <Rates p={p} onChange={updated} manage={manage && !retired} />}
        {q.tab === 'availability' && p && <Availability p={p} onChange={updated} manage={manage && !retired} />}
      </fieldset>
      {q.tab === 'portal' && p && <PortalAccess p={p} manage={manage} />}
      {Object.keys(errors).length > 0 && ['media', 'rates', 'availability'].includes(q.tab) && <div className="banner-error">Some details need fixing on the Details or Visibility tab.</div>}
      {retiring && <RetireModal p={p} onClose={() => setRetiring(false)} onDone={(r) => { setRetiring(false); updated(r); setForm(toForm(r)); }} />}
    </div>
  );
}
