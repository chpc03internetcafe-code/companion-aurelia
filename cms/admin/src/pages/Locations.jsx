import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useUi } from '../lib/ui';
import { day } from '../lib/format';
import { Empty, ErrorBox, Field, Loading, Modal, PageHead, Pill, SeoFields, Tabs, Toggle, useAction, useForm, useLoad, useQueryState } from '../components/kit';
import { cleanSections, SectionsEditor, SectionsPreview } from '../components/SectionsEditor';

function LocationList({ manage }) {
  const { loadMeta } = useUi();
  const navigate = useNavigate();
  const { data, loading, error, reload, setData } = useLoad(() => api.get('/locations'), []);
  const [run] = useAction();
  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  const patch = async (l, body) => { const r = await run(() => api.patch(`/locations/${l.id}`, body)); if (r) { setData(r); loadMeta(); } };
  return (
    <div className="card">
      {data.length ? (
        <table className="table">
          <thead><tr><th>Location</th><th>Profiles</th><th className="hide-sm">SEO</th><th>Popular</th><th>Published</th></tr></thead>
          <tbody>{data.map((l) => (
            <tr key={l.id} className={`clickable ${l.parentId ? 'tree-child' : ''}`} onClick={() => navigate(`/locations/${l.id}`)}>
              <td><strong>{l.name}</strong><span className="sub">/locations/{l.slug}{l.region && !l.parentId ? ` · ${l.region}` : ''}</span></td>
              <td>{l.baseCount} based{l.areaCount ? ` · ${l.areaCount} serving` : ''}</td>
              <td className="hide-sm">{l.metaDescription ? <Pill tone="green">Described</Pill> : <Pill tone="amber">No description</Pill>}</td>
              <td onClick={(e) => e.stopPropagation()}>{!l.parentId && (manage ? <Toggle checked={l.isPopular} onChange={(v) => patch(l, { isPopular: v })} /> : l.isPopular ? '★' : '')}</td>
              <td onClick={(e) => e.stopPropagation()}>{manage ? <Toggle checked={l.isPublished} onChange={(v) => patch(l, { isPublished: v })} /> : <Pill>{l.isPublished ? 'Published' : 'Hidden'}</Pill>}</td>
            </tr>
          ))}</tbody>
        </table>
      ) : <Empty icon="⌖" title="No locations yet" text="Add the cities you cover, then their service areas." />}
    </div>
  );
}

function CategoryModal({ c, onClose, onSaved }) {
  const { form, set, setForm, errors, saving, submit } = useForm(c?.id ? c : { name: '', slug: '', description: '', intro: '', seoTitle: '', metaDescription: '', isActive: true });
  const save = () => submit(async (f) => onSaved(await (c?.id ? api.put(`/locations/categories/${c.id}`, f) : api.post('/locations/categories', f))), 'Category saved');
  return (
    <Modal title={c?.id ? `Edit ${c.name}` : 'New category'} size="wide" onClose={onClose} footer={<><button className="btn btn-ghost" onClick={onClose}>Cancel</button><button className="btn btn-primary" onClick={save} disabled={saving}>Save</button></>}>
      <div className="grid-2" style={{ alignItems: 'start' }}>
        <div className="stack">
          <Field label="Name" error={errors.name} required><input value={form.name} onChange={set('name')} /></Field>
          <Field label="URL" error={errors.slug} hint="The category page lives at /<slug>"><input value={form.slug || ''} onChange={set('slug')} /></Field>
          <Field label="Short description" error={errors.description} hint="Shown on cards"><input value={form.description || ''} onChange={set('description')} /></Field>
          <Field label="Page intro" error={errors.intro}><textarea rows={4} value={form.intro || ''} onChange={set('intro')} /></Field>
          <Toggle checked={form.isActive} onChange={(v) => setForm({ ...form, isActive: v })} label="Shown on the website" />
        </div>
        <SeoFields form={form} set={set} errors={errors} fallbackTitle={`${form.name || 'Category'} companions`} fallbackDescription={form.description} path={`/${form.slug || '…'}`} />
      </div>
    </Modal>
  );
}

function Categories({ manage }) {
  const { loadMeta, confirm } = useUi();
  const { data, loading, error, reload, setData } = useLoad(() => api.get('/locations/categories'), []);
  const [modal, setModal] = useState(null);
  const [run] = useAction();
  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  const move = (i, d) => {
    const order = data.map((c) => c.id);
    [order[i], order[i + d]] = [order[i + d], order[i]];
    run(() => api.put('/locations/categories', { order })).then((r) => r && (setData(r), loadMeta()));
  };
  return (
    <>
      {manage && <div className="row" style={{ marginBottom: 12 }}><button className="btn btn-primary" onClick={() => setModal({})}>+ New category</button></div>}
      <div className="card">
        <table className="table">
          <thead><tr><th>Category</th><th>Profiles</th><th>SEO</th><th>Status</th>{manage && <th />}</tr></thead>
          <tbody>{data.map((c, i) => (
            <tr key={c.id}>
              <td><strong>{c.name}</strong><span className="sub">/{c.slug} · {c.description}</span></td>
              <td>{c.profileCount}</td>
              <td>{c.metaDescription ? <Pill tone="green">Described</Pill> : <Pill tone="amber">No description</Pill>}</td>
              <td><Pill>{c.isActive ? 'Visible' : 'Hidden'}</Pill></td>
              {manage && <td className="actions nowrap">
                <button className="icon-btn" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Move up">↑</button>
                <button className="icon-btn" disabled={i === data.length - 1} onClick={() => move(i, 1)} aria-label="Move down">↓</button>
                <button className="btn btn-sm btn-ghost" onClick={() => setModal(c)}>Edit</button>
                {!c.profileCount && <button className="btn btn-sm btn-danger-ghost" onClick={async () => { if (await confirm({ title: `Delete ${c.name}?`, danger: true, confirmLabel: 'Delete' }) && await run(() => api.del(`/locations/categories/${c.id}`), 'Deleted')) { reload(true); loadMeta(); } }}>Delete</button>}
              </td>}
            </tr>
          ))}</tbody>
        </table>
      </div>
      {modal && <CategoryModal c={modal} onClose={() => setModal(null)} onSaved={(r) => { setModal(null); setData(Array.isArray(r) ? r : r.categories); loadMeta(); }} />}
    </>
  );
}

export default function Locations() {
  const { can } = useAuth();
  const manage = can('locations', 'manage');
  const [q, setQ] = useQueryState({ tab: 'locations' });
  return (
    <>
      <PageHead title="Locations & categories" subtitle="Cities and service areas (each with its own landing page), and the profile categories."
        actions={manage && q.tab === 'locations' && <Link to="/locations/new" className="btn btn-primary">+ New location</Link>} />
      <Tabs tabs={[['locations', 'Locations'], ['categories', 'Categories']]} value={q.tab} onChange={(tab) => setQ({ tab })} />
      {q.tab === 'categories' ? <Categories manage={manage} /> : <LocationList manage={manage} />}
    </>
  );
}

export function LocationEditor() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { can } = useAuth();
  const { meta, loadMeta, confirm } = useUi();
  const manage = can('locations', 'manage');
  const fileRef = useRef(null);
  const existing = useLoad(() => (id ? api.get(`/locations/${id}`) : Promise.resolve(null)), [id]);
  const { form, setForm, set, errors, saving, submit } = useForm({ name: '', slug: '', parentId: '', region: '', intro: '', sections: [], imageAlt: '', seoTitle: '', metaDescription: '', isPopular: false, isPublished: true });
  const [run, busy] = useAction();
  useEffect(() => { if (existing.data) setForm({ ...existing.data, parentId: existing.data.parentId || '' }); }, [existing.data]); // eslint-disable-line react-hooks/exhaustive-deps
  if (id && existing.loading) return <Loading />;
  if (existing.error) return <ErrorBox error={existing.error} />;
  const cities = meta.locations.filter((l) => !l.parentId && String(l.id) !== String(id));
  const save = async (e) => {
    e.preventDefault();
    const r = await submit(() => (id ? api.put(`/locations/${id}`, { ...form, parentId: form.parentId || null, sections: cleanSections(form.sections) }) : api.post('/locations', { ...form, parentId: form.parentId || null, sections: cleanSections(form.sections) })), 'Location saved');
    if (r) { loadMeta(); setForm({ ...r, parentId: r.parentId || '' }); if (!id) navigate(`/locations/${r.id}`, { replace: true }); }
  };
  const upload = async (file) => { if (!file) return; const r = await run(() => api.upload(`/locations/${id}/image`, 'image', file), 'Image uploaded'); if (r) setForm((f) => ({ ...f, imageUrl: r.imageUrl, imageAlt: r.imageAlt })); };
  const parent = meta.locations.find((l) => String(l.id) === String(form.parentId));
  return (
    <form onSubmit={save}>
      <fieldset disabled={!manage} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
        <PageHead back={['Locations', '/locations']} title={id ? form.name : 'New location'} subtitle={form.slug ? `/locations/${form.slug} · updated ${day(form.updatedAt)}` : 'Cities first, then areas inside them'}
          actions={manage && <>{id && <button type="button" className="btn btn-danger-ghost" disabled={busy} onClick={async () => { if (await confirm({ title: `Delete ${form.name}?`, message: 'Only possible when no profiles, bookings or areas use it. Otherwise unpublish it.', danger: true, confirmLabel: 'Delete' }) && await run(() => api.del(`/locations/${id}`), 'Deleted')) { loadMeta(); navigate('/locations'); } }}>Delete</button>}
            <button className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save location'}</button></>} />
        <div className="grid-2" style={{ alignItems: 'start' }}>
          <div className="stack">
            <div className="card card-pad form-grid">
              <Field label="Name" error={errors.name} required><input value={form.name} onChange={set('name')} /></Field>
              <Field label="Inside city" error={errors.parentId} hint="Leave empty for a city"><select value={form.parentId} onChange={set('parentId')}><option value="">— This is a city —</option>{cities.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
              <Field label="URL slug" error={errors.slug} hint="Changing it adds a redirect from the old URL"><input value={form.slug || ''} onChange={set('slug')} /></Field>
              <Field label="Region" hint="Groups cities on the Locations page"><input value={form.region || ''} onChange={set('region')} /></Field>
              <Field label="Intro" className="span-2" hint="Shown at the top of the landing page"><textarea rows={3} value={form.intro || ''} onChange={set('intro')} /></Field>
              <div className="row span-2"><Toggle checked={form.isPublished} onChange={(v) => setForm({ ...form, isPublished: v })} label="Published" />{!form.parentId && <Toggle checked={form.isPopular} onChange={(v) => setForm({ ...form, isPopular: v })} label="Popular (homepage)" />}</div>
            </div>
            <div className="card card-pad stack">
              <div className="section-title" style={{ marginTop: 0 }}>Image</div>
              {form.imageUrl && <img src={form.imageUrl} alt="" style={{ width: '100%', maxHeight: 200, objectFit: 'cover', borderRadius: 10 }} />}
              {id ? <div className="row">
                <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => upload(e.target.files[0])} />
                <button type="button" className="btn btn-sm btn-soft" onClick={() => fileRef.current.click()}>{form.imageUrl ? 'Replace' : 'Upload image'}</button>
                {form.imageUrl && <button type="button" className="btn btn-sm btn-danger-ghost" onClick={() => run(() => api.del(`/locations/${id}/image`), 'Removed').then((r) => r && setForm((f) => ({ ...f, imageUrl: null })))}>Remove</button>}
              </div> : <p className="muted">Save first to add an image.</p>}
              <Field label="Alt text"><input value={form.imageAlt || ''} onChange={set('imageAlt')} /></Field>
            </div>
            <div className="section-title">Landing page content</div>
            {errors.sections && <div className="banner-error">{errors.sections}</div>}
            <SectionsEditor sections={form.sections} onChange={(sections) => setForm({ ...form, sections })} editable={manage} />
            <div className="card card-pad"><div className="section-title" style={{ marginTop: 0 }}>Search engines</div>
              <SeoFields form={form} set={set} errors={errors} fallbackTitle={`Companions in ${form.name || '…'}${parent ? `, ${parent.name}` : ''}`} fallbackDescription={form.intro} path={`/locations/${form.slug || '…'}`} /></div>
          </div>
          <div className="card card-pad" style={{ position: 'sticky', top: 74 }}>
            <div className="section-title" style={{ marginTop: 0 }}>Preview</div>
            <SectionsPreview title={`Companions in ${form.name || '…'}`} kicker={form.region} intro={form.intro} sections={form.sections} />
            <p className="muted" style={{ marginTop: 16 }}>The directory of companions in this {form.parentId ? 'area' : 'city'} appears between the intro and this content.</p>
          </div>
        </div>
      </fieldset>
    </form>
  );
}
