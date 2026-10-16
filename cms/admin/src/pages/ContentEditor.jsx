// Content page editor (About, Terms, Privacy…): sections with a live preview, plus SEO title and description.
import { useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useUi } from '../lib/ui';
import { ErrorBox, Field, Loading, PageHead, SeoFields, Toggle, useAction, useForm, useLoad } from '../components/kit';
import { cleanSections, NEW_SECTION, SectionsEditor, SectionsPreview } from '../components/SectionsEditor';

export default function ContentEditor() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { can } = useAuth();
  const { confirm } = useUi();
  const manage = can('content', 'manage');
  const existing = useLoad(() => (id ? api.get(`/content/pages/${id}`) : Promise.resolve(null)), [id]);
  const { form, setForm, set, errors, saving, submit } = useForm({ title: '', slug: '', kicker: '', intro: '', sections: [structuredClone(NEW_SECTION.text)], seoTitle: '', metaDescription: '', showInFooter: true, isPublished: false });
  const [run, busy] = useAction();
  useEffect(() => { if (existing.data) setForm(existing.data); }, [existing.data]); // eslint-disable-line react-hooks/exhaustive-deps
  if (id && existing.loading) return <Loading />;
  if (existing.error) return <ErrorBox error={existing.error} />;

  const save = async (e) => {
    e.preventDefault();
    const r = await submit(() => (id ? api.put(`/content/pages/${id}`, { ...form, sections: cleanSections(form.sections) }) : api.post('/content/pages', { ...form, sections: cleanSections(form.sections) })), 'Page saved');
    if (r && !id) navigate(`/content/pages/${r.id}`, { replace: true });
  };
  const del = async () => {
    if (await confirm({ title: `Delete “${form.title}”?`, danger: true, confirmLabel: 'Delete page' }) && await run(() => api.del(`/content/pages/${id}`), 'Page deleted')) navigate('/content');
  };

  return (
    <form onSubmit={save}>
      <fieldset disabled={!manage} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
        <PageHead back={['Content', '/content']} title={id ? form.title : 'New page'} subtitle={form.slug ? `/pages/${form.slug}` : undefined}
          actions={manage && <>{id && <button type="button" className="btn btn-danger-ghost" onClick={del} disabled={busy}>Delete</button>}<button className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save page'}</button></>} />
        <div className="grid-2" style={{ alignItems: 'start' }}>
          <div className="stack">
            <div className="card card-pad form-grid">
              <Field label="Title" error={errors.title} required><input value={form.title} onChange={set('title')} /></Field>
              <Field label="URL slug" error={errors.slug} hint="Blank = from the title. Changing it adds a redirect from the old URL."><input value={form.slug || ''} onChange={set('slug')} /></Field>
              <Field label="Kicker" hint="Small label above the title"><input value={form.kicker || ''} onChange={set('kicker')} /></Field>
              <div className="row" style={{ alignSelf: 'end' }}>
                <Toggle checked={form.isPublished} onChange={(v) => setForm({ ...form, isPublished: v })} label="Published" />
                <Toggle checked={form.showInFooter} onChange={(v) => setForm({ ...form, showInFooter: v })} label="Footer link" />
              </div>
              <Field label="Intro" className="span-2"><textarea rows={2} value={form.intro || ''} onChange={set('intro')} /></Field>
            </div>
            {errors.sections && <div className="banner-error">{errors.sections}</div>}
            <SectionsEditor sections={form.sections} onChange={(sections) => setForm({ ...form, sections })} editable={manage} />
            <div className="card card-pad"><div className="section-title" style={{ marginTop: 0 }}>Search engines</div>
              <SeoFields form={form} set={set} errors={errors} fallbackTitle={form.title} fallbackDescription={form.intro} path={`/pages/${form.slug || '…'}`} /></div>
          </div>
          <div className="card card-pad" style={{ position: 'sticky', top: 74 }}>
            <div className="section-title" style={{ marginTop: 0 }}>Preview</div>
            <SectionsPreview title={form.title || 'Untitled page'} kicker={form.kicker} intro={form.intro} sections={form.sections} />
          </div>
        </div>
      </fieldset>
    </form>
  );
}
