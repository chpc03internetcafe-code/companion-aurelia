// Content: pages, posts (guides, announcements, member news) and FAQs.
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useUi } from '../lib/ui';
import { day } from '../lib/format';
import { Empty, ErrorBox, Field, Loading, Modal, PageHead, Pill, Tabs, Toggle, useAction, useForm, useLoad, usePaged, useQueryState } from '../components/kit';

function Pages({ manage }) {
  const { data, loading, error, reload } = useLoad(() => api.get('/content/pages'), []);
  const [run] = useAction();
  const navigate = useNavigate();
  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  const toggle = (p, k) => run(() => api.patch(`/content/pages/${p.id}`, { [k]: !p[k] })).then((r) => r && reload(true));
  return (
    <div className="card">
      {data.length ? (
        <table className="table">
          <thead><tr><th>Page</th><th className="hide-sm">Sections</th><th>SEO</th><th>Updated</th><th>Status</th></tr></thead>
          <tbody>{data.map((p) => (
            <tr key={p.id} className="clickable" onClick={() => navigate(`/content/pages/${p.id}`)}>
              <td><strong>{p.title}</strong><span className="sub">/pages/{p.slug}{p.showInFooter ? ' · in footer' : ''}</span></td>
              <td className="hide-sm">{p.sectionCount}</td>
              <td>{p.metaDescription ? <Pill tone="green">Described</Pill> : <Pill tone="amber">No description</Pill>}</td>
              <td className="nowrap">{day(p.updatedAt)}</td>
              <td onClick={(e) => e.stopPropagation()}>{manage ? <Toggle checked={p.isPublished} onChange={() => toggle(p, 'isPublished')} label={p.isPublished ? 'Published' : 'Draft'} /> : <Pill>{p.isPublished ? 'Published' : 'Draft'}</Pill>}</td>
            </tr>
          ))}</tbody>
        </table>
      ) : <Empty title="No pages yet" />}
    </div>
  );
}

function Posts({ manage }) {
  const { data, loading, error, reload, setData } = useLoad(() => api.get('/content/posts'), []);
  const [run] = useAction();
  const navigate = useNavigate();
  const { items, pager } = usePaged(data || []);
  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  const patch = (p, body) => run(() => api.patch(`/content/posts/${p.id}`, body)).then((r) => r && setData(r));
  return (
    <div className="card">
      {data.length ? (
        <table className="table">
          <thead><tr><th>Title</th><th>Type</th><th>Audience</th><th className="hide-sm">Published</th><th>Status</th></tr></thead>
          <tbody>{items.map((p) => (
            <tr key={p.id} className="clickable" onClick={() => navigate(`/content/posts/${p.id}`)}>
              <td><strong>{p.isPinned ? '📌 ' : ''}{p.title}</strong><span className="sub">/guides/{p.slug}{p.locationName ? ` · ${p.locationName}` : ''}</span></td>
              <td><Pill>{p.kind}</Pill></td>
              <td><Pill>{p.audience}</Pill>{p.tierName && <span className="sub">{p.tierName}+</span>}</td>
              <td className="hide-sm nowrap">{p.publishedAt ? day(p.publishedAt) : '—'}</td>
              <td onClick={(e) => e.stopPropagation()}>{manage ? <Toggle checked={p.isPublished} onChange={() => patch(p, { isPublished: !p.isPublished })} label={p.isPublished ? 'Published' : 'Draft'} /> : <Pill>{p.isPublished ? 'Published' : 'Draft'}</Pill>}</td>
            </tr>
          ))}</tbody>
        </table>
      ) : <Empty title="No articles yet" text="Write city guides, booking tips, announcements and member-only news." />}
      {pager}
    </div>
  );
}

function FaqModal({ faq, groups, onClose, onSaved }) {
  const { form, set, setForm, errors, saving, submit } = useForm(faq?.id ? faq : { groupName: groups[0] || 'Booking', question: '', answer: '', showOnHome: false, isPublished: true });
  const save = () => submit(async (f) => onSaved(await (faq?.id ? api.put(`/content/faqs/${faq.id}`, f) : api.post('/content/faqs', f))), 'FAQ saved');
  return (
    <Modal title={faq?.id ? 'Edit FAQ' : 'New FAQ'} onClose={onClose} footer={<><button className="btn btn-ghost" onClick={onClose}>Cancel</button><button className="btn btn-primary" onClick={save} disabled={saving}>Save</button></>}>
      <div className="stack">
        <Field label="Group" error={errors.groupName} required hint="e.g. Booking, Membership, Privacy"><input value={form.groupName} onChange={set('groupName')} list="faq-groups" /><datalist id="faq-groups">{groups.map((g) => <option key={g} value={g} />)}</datalist></Field>
        <Field label="Question" error={errors.question} required><input value={form.question} onChange={set('question')} /></Field>
        <Field label="Answer" error={errors.answer} required><textarea rows={5} value={form.answer} onChange={set('answer')} /></Field>
        <div className="row"><Toggle checked={form.isPublished} onChange={(v) => setForm({ ...form, isPublished: v })} label="Published" /><Toggle checked={form.showOnHome} onChange={(v) => setForm({ ...form, showOnHome: v })} label="Show on homepage" /></div>
      </div>
    </Modal>
  );
}

function Faqs({ manage }) {
  const { data, loading, error, reload, setData } = useLoad(() => api.get('/content/faqs'), []);
  const [modal, setModal] = useState(null);
  const [run] = useAction();
  const { confirm } = useUi();
  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  const groups = [...new Set(data.map((f) => f.groupName))];
  const move = (i, d) => {
    const order = data.map((f) => f.id);
    [order[i], order[i + d]] = [order[i + d], order[i]];
    run(() => api.put('/content/faqs', { order })).then((r) => r && setData(r));
  };
  return (
    <>
      {manage && <div className="row" style={{ marginBottom: 12 }}><button className="btn btn-primary" onClick={() => setModal({})}>+ New FAQ</button></div>}
      <div className="card">
        <table className="table">
          <thead><tr><th>Question</th><th>Group</th><th>Home</th><th>Status</th>{manage && <th />}</tr></thead>
          <tbody>{data.map((f, i) => (
            <tr key={f.id}>
              <td><strong>{f.question}</strong><span className="sub" style={{ maxWidth: 520, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' }}>{f.answer}</span></td>
              <td>{f.groupName}</td>
              <td>{f.showOnHome ? '✓' : ''}</td>
              <td><Pill>{f.isPublished ? 'Published' : 'Hidden'}</Pill></td>
              {manage && <td className="actions nowrap">
                <button className="icon-btn" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Move up">↑</button>
                <button className="icon-btn" disabled={i === data.length - 1} onClick={() => move(i, 1)} aria-label="Move down">↓</button>
                <button className="btn btn-sm btn-ghost" onClick={() => setModal(f)}>Edit</button>
                <button className="btn btn-sm btn-danger-ghost" onClick={async () => { if (await confirm({ title: 'Delete this FAQ?', danger: true, confirmLabel: 'Delete' }) && await run(() => api.del(`/content/faqs/${f.id}`), 'FAQ deleted')) reload(true); }}>Delete</button>
              </td>}
            </tr>
          ))}</tbody>
        </table>
      </div>
      {modal && <FaqModal faq={modal} groups={groups} onClose={() => setModal(null)} onSaved={(r) => { setModal(null); setData(Array.isArray(r) ? r : r.faqs); }} />}
    </>
  );
}

export default function Content() {
  const { can } = useAuth();
  const manage = can('content', 'manage');
  const [q, setQ] = useQueryState({ tab: 'pages' });
  return (
    <>
      <PageHead title="Content & FAQs" subtitle="Website pages, guides and announcements (public or members-only), and the FAQ."
        actions={manage && (q.tab === 'pages' ? <Link className="btn btn-primary" to="/content/pages/new">+ New page</Link> : q.tab === 'posts' ? <Link className="btn btn-primary" to="/content/posts/new">+ New article</Link> : null)} />
      <Tabs tabs={[['pages', 'Pages'], ['posts', 'Guides & news'], ['faqs', 'FAQs']]} value={q.tab} onChange={(tab) => setQ({ tab })} />
      {q.tab === 'pages' && <Pages manage={manage} />}
      {q.tab === 'posts' && <Posts manage={manage} />}
      {q.tab === 'faqs' && <Faqs manage={manage} />}
    </>
  );
}
