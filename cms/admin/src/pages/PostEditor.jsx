// Guide / announcement / member-news editor: audience (public or members of a tier), location, cover image, sections, SEO.
import { useEffect, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useUi } from '../lib/ui';
import { ErrorBox, Field, Loading, PageHead, SeoFields, Toggle, useAction, useForm, useLoad } from '../components/kit';
import { cleanSections, NEW_SECTION, SectionsEditor, SectionsPreview } from '../components/SectionsEditor';

export default function PostEditor() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { can } = useAuth();
  const { confirm, meta } = useUi();
  const manage = can('content', 'manage');
  const fileRef = useRef(null);
  const existing = useLoad(() => (id ? api.get(`/content/posts/${id}`) : Promise.resolve(null)), [id]);
  const { form, setForm, set, errors, saving, submit } = useForm({ title: '', slug: '', kind: 'Guide', excerpt: '', sections: [structuredClone(NEW_SECTION.text)], audience: 'Public', minTierId: '', locationId: '',
    coverAlt: '', isPinned: false, isPublished: false, seoTitle: '', metaDescription: '' });
  const [run, busy] = useAction();
  useEffect(() => { if (existing.data) setForm({ ...existing.data, minTierId: existing.data.minTierId || '', locationId: existing.data.locationId || '' }); }, [existing.data]); // eslint-disable-line react-hooks/exhaustive-deps
  if (id && existing.loading) return <Loading />;
  if (existing.error) return <ErrorBox error={existing.error} />;

  const body = () => ({ ...form, sections: cleanSections(form.sections), minTierId: form.audience === 'Members' ? form.minTierId || null : null, locationId: form.locationId || null });
  const save = async (e) => {
    e.preventDefault();
    const r = await submit(() => (id ? api.put(`/content/posts/${id}`, body()) : api.post('/content/posts', body())), 'Article saved');
    if (r) { setForm({ ...r, minTierId: r.minTierId || '', locationId: r.locationId || '' }); if (!id) navigate(`/content/posts/${r.id}`, { replace: true }); }
  };
  const uploadCover = async (file) => {
    if (!file) return;
    const r = await run(() => api.upload(`/content/posts/${id}/cover`, 'image', file), 'Cover uploaded');
    if (r) setForm((f) => ({ ...f, coverUrl: r.coverUrl, coverAlt: r.coverAlt }));
  };
  const del = async () => {
    if (await confirm({ title: `Delete “${form.title}”?`, danger: true, confirmLabel: 'Delete article' }) && await run(() => api.del(`/content/posts/${id}`), 'Article deleted')) navigate('/content?tab=posts');
  };

  return (
    <form onSubmit={save}>
      <fieldset disabled={!manage} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
        <PageHead back={['Guides & news', '/content?tab=posts']} title={id ? form.title : 'New article'} subtitle={form.slug ? `/guides/${form.slug}` : undefined}
          actions={manage && <>{id && <button type="button" className="btn btn-danger-ghost" onClick={del} disabled={busy}>Delete</button>}<button className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save article'}</button></>} />
        <div className="grid-2" style={{ alignItems: 'start' }}>
          <div className="stack">
            <div className="card card-pad form-grid">
              <Field label="Title" error={errors.title} required className="span-2"><input value={form.title} onChange={set('title')} /></Field>
              <Field label="Type"><select value={form.kind} onChange={set('kind')}><option>Guide</option><option>Announcement</option><option>News</option></select></Field>
              <Field label="URL slug" error={errors.slug} hint="Blank = from the title"><input value={form.slug || ''} onChange={set('slug')} /></Field>
              <Field label="Audience" hint="Members-only articles show a lock to everyone else"><select value={form.audience} onChange={set('audience')}><option value="Public">Public</option><option value="Members">Members only</option></select></Field>
              {form.audience === 'Members'
                ? <Field label="Minimum tier"><select value={form.minTierId} onChange={set('minTierId')}><option value="">Any active membership</option>{meta.tiers.map((t) => <option key={t.id} value={t.id}>{t.name}+</option>)}</select></Field>
                : <Field label="Location (optional)" hint="Shown on that location’s page"><select value={form.locationId} onChange={set('locationId')}><option value="">—</option>{meta.locations.filter((l) => !l.parentId).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></Field>}
              <Field label="Excerpt" className="span-2" hint="Shown on cards and as the default meta description"><textarea rows={2} value={form.excerpt || ''} onChange={set('excerpt')} /></Field>
              <div className="row span-2">
                <Toggle checked={form.isPublished} onChange={(v) => setForm({ ...form, isPublished: v })} label="Published" />
                <Toggle checked={form.isPinned} onChange={(v) => setForm({ ...form, isPinned: v })} label="Pinned to top" />
              </div>
            </div>
            <div className="card card-pad stack">
              <div className="section-title" style={{ marginTop: 0 }}>Cover image</div>
              {form.coverUrl && <img src={form.coverUrl} alt="" style={{ width: '100%', borderRadius: 10, maxHeight: 220, objectFit: 'cover' }} />}
              {id ? (
                <div className="row">
                  <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => uploadCover(e.target.files[0])} />
                  <button type="button" className="btn btn-sm btn-soft" onClick={() => fileRef.current.click()} disabled={busy}>{form.coverUrl ? 'Replace image' : 'Upload image'}</button>
                  {form.coverUrl && <button type="button" className="btn btn-sm btn-danger-ghost" onClick={() => run(() => api.del(`/content/posts/${id}/cover`), 'Image removed').then((r) => r && setForm((f) => ({ ...f, coverUrl: null })))}>Remove</button>}
                </div>
              ) : <p className="muted">Save the article first to add a cover image.</p>}
              <Field label="Alt text" hint="Describe the image for screen readers and search engines"><input value={form.coverAlt || ''} onChange={set('coverAlt')} /></Field>
            </div>
            {errors.sections && <div className="banner-error">{errors.sections}</div>}
            <SectionsEditor sections={form.sections} onChange={(sections) => setForm({ ...form, sections })} editable={manage} />
            <div className="card card-pad"><div className="section-title" style={{ marginTop: 0 }}>Search engines</div>
              {form.audience === 'Members' && <div className="banner-info" style={{ marginBottom: 10 }}>Members-only articles are kept out of search engines.</div>}
              <SeoFields form={form} set={set} errors={errors} fallbackTitle={form.title} fallbackDescription={form.excerpt} path={`/guides/${form.slug || '…'}`} /></div>
          </div>
          <div className="card card-pad" style={{ position: 'sticky', top: 74 }}>
            <div className="section-title" style={{ marginTop: 0 }}>Preview</div>
            {form.coverUrl && <img src={form.coverUrl} alt="" style={{ width: '100%', borderRadius: 10, marginBottom: 12 }} />}
            <SectionsPreview title={form.title || 'Untitled'} kicker={form.kind} intro={form.excerpt} sections={form.sections} />
          </div>
        </div>
      </fieldset>
    </form>
  );
}
