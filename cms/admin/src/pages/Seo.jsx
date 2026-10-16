import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useUi } from '../lib/ui';
import { dateTime } from '../lib/format';
import { Counter, Empty, ErrorBox, Field, Loading, Modal, PageHead, Pill, SearchBox, Tabs, Toggle, useAction, useForm, useLoad, useQueryState } from '../components/kit';

function RedirectModal({ r, onClose, onSaved }) {
  const { form, set, setForm, errors, saving, submit } = useForm(r?.id ? r : { fromPath: '', toPath: '', statusCode: 301, note: '', isActive: true });
  const save = () => submit(async (f) => onSaved(await (r?.id ? api.put(`/seo/redirects/${r.id}`, { ...f, statusCode: Number(f.statusCode) }) : api.post('/seo/redirects', { ...f, statusCode: Number(f.statusCode) }))), 'Redirect saved');
  return (
    <Modal title={r?.id ? 'Edit redirect' : 'New redirect'} onClose={onClose} footer={<><button className="btn btn-ghost" onClick={onClose}>Cancel</button><button className="btn btn-primary" onClick={save} disabled={saving}>Save</button></>}>
      <div className="stack">
        <Field label="From (old path)" error={errors.fromPath} required hint="e.g. /old-makati-page"><input value={form.fromPath} onChange={set('fromPath')} placeholder="/old-page" /></Field>
        <Field label="To" error={errors.toPath} required hint="A path on this site (/locations/makati) or a full https:// link"><input value={form.toPath} onChange={set('toPath')} placeholder="/locations/makati" /></Field>
        <Field label="Type"><select value={form.statusCode} onChange={set('statusCode')}><option value={301}>Permanent (301) — the page moved for good</option><option value={302}>Temporary (302)</option></select></Field>
        <Field label="Note"><input value={form.note || ''} onChange={set('note')} /></Field>
        <Toggle checked={form.isActive} onChange={(v) => setForm({ ...form, isActive: v })} label="Active" />
      </div>
    </Modal>
  );
}

function Redirects({ manage }) {
  const { confirm } = useUi();
  const { data, loading, error, reload, setData } = useLoad(() => api.get('/seo/redirects'), []);
  const [modal, setModal] = useState(null);
  const [search, setSearch] = useState('');
  const [run] = useAction();
  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  const rows = data.filter((r) => !search || `${r.fromPath} ${r.toPath} ${r.note || ''}`.toLowerCase().includes(search.toLowerCase()));
  return (
    <div className="card">
      <div className="filters">
        <SearchBox value={search} onChange={setSearch} placeholder="Find a path…" />
        <span className="spacer" />
        {manage && <button className="btn btn-sm btn-primary" onClick={() => setModal({})}>+ New redirect</button>}
      </div>
      {rows.length ? (
        <table className="table">
          <thead><tr><th>From</th><th>To</th><th>Type</th><th>Visits</th><th>Active</th>{manage && <th />}</tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.id}>
              <td className="mono">{r.fromPath}{r.note && <span className="sub">{r.note}</span>}</td>
              <td className="mono">{r.toPath}</td>
              <td>{r.statusCode}</td>
              <td>{r.hits}{r.lastHitAt && <span className="sub">last {dateTime(r.lastHitAt)}</span>}</td>
              <td>{manage ? <Toggle checked={r.isActive} onChange={(v) => run(() => api.patch(`/seo/redirects/${r.id}`, { isActive: v })).then((x) => x && setData(x))} /> : <Pill>{r.isActive ? 'Active' : 'Inactive'}</Pill>}</td>
              {manage && <td className="actions nowrap"><button className="btn btn-sm btn-ghost" onClick={() => setModal(r)}>Edit</button> <button className="btn btn-sm btn-danger-ghost" onClick={async () => { if (await confirm({ title: `Delete the redirect from ${r.fromPath}?`, danger: true, confirmLabel: 'Delete' }) && await run(() => api.del(`/seo/redirects/${r.id}`), 'Deleted')) reload(true); }}>Delete</button></td>}
            </tr>
          ))}</tbody>
        </table>
      ) : <Empty icon="⤳" title="No redirects" text="Redirects are added automatically when you change a URL or retire a profile; add your own for old site links." />}
      {modal && <RedirectModal r={modal} onClose={() => setModal(null)} onSaved={(x) => { setModal(null); setData(Array.isArray(x) ? x : x.redirects); }} />}
    </div>
  );
}

function Settings({ manage }) {
  const { data, loading, error, reload } = useLoad(() => api.get('/seo/settings'), []);
  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  return <SettingsForm initial={data} manage={manage} />;
}

function SettingsForm({ initial, manage }) {
  const { form, set, setForm, errors, saving, submit } = useForm(initial);
  const { meta } = useUi();
  const site = meta.websiteUrl || 'http://localhost:5173';
  return (
    <div className="grid-2" style={{ alignItems: 'start' }}>
      <form className="card card-pad stack" onSubmit={(e) => { e.preventDefault(); submit((f) => api.put('/seo/settings', f), 'SEO settings saved'); }}>
        <fieldset disabled={!manage} style={{ border: 0, padding: 0, margin: 0 }} className="stack">
          <Field label="Title suffix" error={errors.seoTitleSuffix} hint="Added after every page title, e.g. “ · Aurelia Companions”"><input value={form.seoTitleSuffix || ''} onChange={set('seoTitleSuffix')} /></Field>
          <Field label={<>Default meta description <Counter value={form.seoDefaultDescription} min={70} max={170} /></>} error={errors.seoDefaultDescription} hint="Used by pages without their own description"><textarea rows={3} value={form.seoDefaultDescription || ''} onChange={set('seoDefaultDescription')} maxLength={170} /></Field>
          <Field label="Default share image" error={errors.seoOgImage} hint="Link to an image used when pages are shared (1200×630 recommended)"><input value={form.seoOgImage || ''} onChange={set('seoOgImage')} placeholder="https://…" /></Field>
          <Toggle checked={form.structuredData === '1'} onChange={(v) => setForm({ ...form, structuredData: v ? '1' : '0' })} label="Structured data (JSON-LD)" hint="Organisation, breadcrumbs, FAQs, articles and profile pages" />
          <Toggle checked={form.searchIndexing === '1'} onChange={(v) => setForm({ ...form, searchIndexing: v ? '1' : '0' })} label="Allow search engines to index the site" hint="Turn off on a staging copy" />
          {manage && <div><button className="btn btn-primary" disabled={saving}>Save</button></div>}
        </fieldset>
      </form>
      <div className="card card-pad stack">
        <div className="section-title" style={{ marginTop: 0 }}>For search engines</div>
        <p><a href={`${site}/sitemap.xml`} target="_blank" rel="noreferrer">{site}/sitemap.xml ↗</a><br /><span className="muted">Lists published pages, locations, categories, public profiles and articles. VIP profiles and members-only articles are left out.</span></p>
        <p><a href={`${site}/robots.txt`} target="_blank" rel="noreferrer">{site}/robots.txt ↗</a><br /><span className="muted">Keeps account and booking pages out of search results and points to the sitemap.</span></p>
        <p className="muted">Each profile, location, category, page and article has its own title, description and URL fields. Changing a URL automatically adds a 301 redirect from the old one.</p>
      </div>
    </div>
  );
}

function Health() {
  const { data, loading, error, reload } = useLoad(() => api.get('/seo/health'), []);
  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  const groups = [
    ['Profiles missing a title or description', data.profiles, (r) => `/profiles/${r.id}?tab=visibility`, (r) => [r.noTitle && 'title', r.noDescription && 'description']],
    ['Locations missing a title, description or intro', data.locations, (r) => `/locations/${r.id}`, (r) => [r.noTitle && 'title', r.noDescription && 'description', r.noIntro && 'intro']],
    ['Categories missing a title or description', data.categories, () => '/locations?tab=categories', (r) => [r.noTitle && 'title', r.noDescription && 'description']],
    ['Articles missing a description or image alt text', data.posts, (r) => `/content/posts/${r.id}`, (r) => [r.noDescription && 'description', r.noAlt && 'alt text']],
    ['Pages missing a description', data.pages, (r) => `/content/pages/${r.id}`, () => ['description']],
    ['Profile photos without alt text', data.photos, (r) => `/profiles/${r.id}?tab=media`, (r) => [`${r.missing} photo(s)`]],
    ['Retired profiles without a redirect', data.retired, (r) => `/profiles/${r.id}`, (r) => [`/companions/${r.slug}`]],
  ];
  const total = groups.reduce((s, [, rows]) => s + rows.length, 0);
  return (
    <div className="stack">
      <div className="banner-info">{total ? `${total} item(s) could be improved. Fixing them helps search engines show better results.` : 'Everything published has a title, description and alt text. 🎉'}</div>
      {groups.filter(([, rows]) => rows.length).map(([title, rows, link, what]) => (
        <div key={title} className="card card-pad health-group">
          <h3>{title} <Pill tone="amber">{rows.length}</Pill></h3>
          <div className="chips">{rows.map((r) => <Link key={r.id} to={link(r)} className="chip">{r.name} <span className="muted">· {what(r).filter(Boolean).join(', ')}</span></Link>)}</div>
        </div>
      ))}
    </div>
  );
}

export default function Seo() {
  const { can } = useAuth();
  const manage = can('seo', 'manage');
  const [q, setQ] = useQueryState({ tab: 'health' });
  return (
    <>
      <PageHead title="SEO & redirects" subtitle="Search settings, a checklist of missing titles and descriptions, and redirects for old or retired URLs." />
      <Tabs tabs={[['health', 'Health check'], ['redirects', 'Redirects'], ['settings', 'Settings']]} value={q.tab} onChange={(tab) => setQ({ tab })} />
      {q.tab === 'redirects' && <Redirects manage={manage} />}
      {q.tab === 'settings' && <Settings manage={manage} />}
      {q.tab === 'health' && <Health />}
    </>
  );
}
