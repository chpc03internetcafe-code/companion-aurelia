import { useState } from 'react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useUi } from '../lib/ui';
import { money } from '../lib/format';
import { Empty, ErrorBox, Field, Loading, Modal, PageHead, Pill, SearchBox, Tabs, Toggle, useAction, useForm, useLoad, useQueryState } from '../components/kit';

function TierModal({ t, onClose, onSaved }) {
  const { form, set, setForm, errors, saving, submit } = useForm(t?.id ? { ...t, perksText: t.perks.join('\n') } : { name: '', slug: '', rank: 1, description: '', price: '', durationDays: 30, perksText: '', color: '#d4af6a', isPublic: true, isActive: true });
  const save = () => submit(async (f) => onSaved(await (t?.id ? api.put(`/vip/tiers/${t.id}`, { ...f, perks: f.perksText.split('\n').map((x) => x.trim()).filter(Boolean) }) : api.post('/vip/tiers', { ...f, perks: f.perksText.split('\n').map((x) => x.trim()).filter(Boolean) }))), 'Tier saved');
  return (
    <Modal title={t?.id ? `Edit ${t.name}` : 'New tier'} onClose={onClose} footer={<><button className="btn btn-ghost" onClick={onClose}>Cancel</button><button className="btn btn-primary" onClick={save} disabled={saving}>Save</button></>}>
      <div className="form-grid">
        <Field label="Name" error={errors.name} required><input value={form.name} onChange={set('name')} /></Field>
        <Field label="Access level" error={errors.rank} required hint="1 = entry. Higher levels see everything open to lower ones."><input type="number" min={1} max={20} value={form.rank} onChange={set('rank')} /></Field>
        <Field label="Price" error={errors.price} required><input type="number" min={0} value={form.price} onChange={set('price')} /></Field>
        <Field label="Duration (days)" error={errors.durationDays} required><input type="number" min={1} value={form.durationDays} onChange={set('durationDays')} /></Field>
        <Field label="Description" className="span-2"><input value={form.description || ''} onChange={set('description')} /></Field>
        <Field label="Perks" className="span-2" hint="One per line — shown on the VIP page" error={errors.perks}><textarea rows={5} value={form.perksText} onChange={set('perksText')} /></Field>
        <Field label="Colour" error={errors.color}><input type="color" value={form.color || '#d4af6a'} onChange={set('color')} /></Field>
        <Field label="URL slug" error={errors.slug}><input value={form.slug || ''} onChange={set('slug')} /></Field>
        <div className="span-2 stack">
          <Toggle checked={form.isPublic} onChange={(v) => setForm({ ...form, isPublic: v })} label="Listed on the VIP page" hint="Unlisted tiers can still be granted by staff" />
          <Toggle checked={form.isActive} onChange={(v) => setForm({ ...form, isActive: v })} label="Active" hint="Inactive tiers give no access" />
        </div>
      </div>
    </Modal>
  );
}

function Tiers({ manage }) {
  const { loadMeta, confirm } = useUi();
  const { data, loading, error, reload, setData } = useLoad(() => api.get('/vip/tiers'), []);
  const [modal, setModal] = useState(null);
  const [run] = useAction();
  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  return (
    <>
      {manage && <div className="row" style={{ marginBottom: 12 }}><button className="btn btn-primary" onClick={() => setModal({})}>+ New tier</button></div>}
      <div className="grid-3">
        {data.map((t) => (
          <div key={t.id} className="card card-pad stack">
            <div className="row"><span style={{ width: 14, height: 14, borderRadius: 7, background: t.color || 'var(--primary)', display: 'inline-block' }} /><h2>{t.name}</h2><span className="spacer" /><Pill>{t.isActive ? 'Active' : 'Inactive'}</Pill></div>
            <div><strong style={{ fontSize: 22 }}>{money(t.price, true)}</strong> <span className="muted">/ {t.durationDays} days · level {t.rank}{t.isPublic ? '' : ' · unlisted'}</span></div>
            {t.description && <p className="muted">{t.description}</p>}
            <ul style={{ margin: 0, paddingLeft: 18 }}>{t.perks.map((x) => <li key={x}>{x}</li>)}</ul>
            <div className="muted">{t.activeMembers} active member(s) · {t.vipProfiles} VIP profile(s)</div>
            {manage && <div className="row">
              <button className="btn btn-sm btn-ghost" onClick={() => setModal(t)}>Edit</button>
              {!t.activeMembers && <button className="btn btn-sm btn-danger-ghost" onClick={async () => { if (await confirm({ title: `Delete ${t.name}?`, danger: true, confirmLabel: 'Delete' }) && await run(() => api.del(`/vip/tiers/${t.id}`), 'Deleted')) { reload(true); loadMeta(); } }}>Delete</button>}
            </div>}
          </div>
        ))}
      </div>
      {!data.length && <Empty icon="◆" title="No tiers yet" />}
      {modal && <TierModal t={modal} onClose={() => setModal(null)} onSaved={(r) => { setModal(null); setData(Array.isArray(r) ? r : r.tiers); loadMeta(); }} />}
    </>
  );
}

function CollectionModal({ c, onClose, onSaved }) {
  const { meta } = useUi();
  const profiles = useLoad(() => api.get('/profiles/options'), []);
  const detail = useLoad(() => (c?.id ? api.get(`/vip/collections/${c.id}`) : Promise.resolve(null)), [c?.id]);
  const { form, set, setForm, errors, saving, submit } = useForm(c?.id ? { ...c, minTierId: c.minTierId || '' } : { title: '', slug: '', description: '', minTierId: '', isPublished: true });
  const [ids, setIds] = useState(null);
  const [search, setSearch] = useState('');
  const chosen = ids ?? detail.data?.profiles.map((p) => p.id) ?? [];
  const byId = new Map((profiles.data || []).map((p) => [p.id, p]));
  const save = () => submit(async (f) => {
    const saved = await (c?.id ? api.put(`/vip/collections/${c.id}`, { ...f, minTierId: f.minTierId || null }) : api.post('/vip/collections', { ...f, minTierId: f.minTierId || null }));
    await api.put(`/vip/collections/${saved.id}/profiles`, { profileIds: chosen });
    onSaved();
  }, 'Collection saved');
  const move = (i, d) => { const next = [...chosen]; [next[i], next[i + d]] = [next[i + d], next[i]]; setIds(next); };
  const toggle = (id) => setIds(chosen.includes(id) ? chosen.filter((x) => x !== id) : [...chosen, id]);
  return (
    <Modal title={c?.id ? `Edit ${c.title}` : 'New collection'} size="wide" onClose={onClose} footer={<><button className="btn btn-ghost" onClick={onClose}>Cancel</button><button className="btn btn-primary" onClick={save} disabled={saving}>Save</button></>}>
      <div className="grid-2" style={{ alignItems: 'start' }}>
        <div className="stack">
          <Field label="Title" error={errors.title} required><input value={form.title} onChange={set('title')} /></Field>
          <Field label="Description"><textarea rows={3} value={form.description || ''} onChange={set('description')} /></Field>
          <Field label="Who can open it"><select value={form.minTierId} onChange={set('minTierId')}><option value="">Any active membership</option>{meta.tiers.map((t) => <option key={t.id} value={t.id}>{t.name} and up</option>)}</select></Field>
          <Field label="URL slug" error={errors.slug}><input value={form.slug || ''} onChange={set('slug')} /></Field>
          <Toggle checked={form.isPublished} onChange={(v) => setForm({ ...form, isPublished: v })} label="Visible to members" />
          <div className="section-title">In this collection ({chosen.length})</div>
          <div className="order-list">
            {chosen.map((id, i) => { const p = byId.get(id); return p ? (
              <div key={id}><strong style={{ flex: 1 }}>{p.displayName}</strong><span className="muted">{p.categoryName}</span>
                <button type="button" className="icon-btn" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Move up">↑</button>
                <button type="button" className="icon-btn" disabled={i === chosen.length - 1} onClick={() => move(i, 1)} aria-label="Move down">↓</button>
                <button type="button" className="icon-btn" onClick={() => toggle(id)} aria-label="Remove">✕</button></div>
            ) : null; })}
            {!chosen.length && <p className="muted">Tick profiles on the right.</p>}
          </div>
        </div>
        <div className="stack">
          <SearchBox value={search} onChange={setSearch} placeholder="Find a profile…" />
          <div className="picker-list">
            {(profiles.data || []).filter((p) => !search || p.displayName.toLowerCase().includes(search.toLowerCase())).map((p) => (
              <label key={p.id}><input type="checkbox" checked={chosen.includes(p.id)} onChange={() => toggle(p.id)} /> <strong>{p.displayName}</strong> <span className="muted">{p.categoryName}{p.locationName ? ` · ${p.locationName}` : ''}{p.status !== 'Published' ? ` · ${p.status}` : ''}</span></label>
            ))}
          </div>
        </div>
      </div>
    </Modal>
  );
}

function Collections({ manage }) {
  const { confirm } = useUi();
  const { data, loading, error, reload } = useLoad(() => api.get('/vip/collections'), []);
  const [modal, setModal] = useState(null);
  const [run] = useAction();
  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  return (
    <>
      {manage && <div className="row" style={{ marginBottom: 12 }}><button className="btn btn-primary" onClick={() => setModal({})}>+ New collection</button></div>}
      <div className="card">
        {data.length ? (
          <table className="table">
            <thead><tr><th>Collection</th><th>Access</th><th>Profiles</th><th>Status</th>{manage && <th />}</tr></thead>
            <tbody>{data.map((c) => (
              <tr key={c.id}>
                <td><strong>{c.title}</strong><span className="sub">{c.description}</span></td>
                <td>{c.tierName ? `${c.tierName} and up` : 'Any active member'}</td>
                <td>{c.profileCount}</td>
                <td><Pill>{c.isPublished ? 'Visible' : 'Hidden'}</Pill></td>
                {manage && <td className="actions nowrap"><button className="btn btn-sm btn-ghost" onClick={() => setModal(c)}>Edit</button> <button className="btn btn-sm btn-danger-ghost" onClick={async () => { if (await confirm({ title: `Delete ${c.title}?`, danger: true, confirmLabel: 'Delete' }) && await run(() => api.del(`/vip/collections/${c.id}`), 'Deleted')) reload(true); }}>Delete</button></td>}
              </tr>
            ))}</tbody>
          </table>
        ) : <Empty icon="◆" title="No collections yet" text="Curate profiles for members — e.g. “New this month” or “Gold Selection”." />}
      </div>
      {modal && <CollectionModal c={modal} onClose={() => setModal(null)} onSaved={() => { setModal(null); reload(true); }} />}
    </>
  );
}

export default function Vip() {
  const { can } = useAuth();
  const manage = can('vip', 'manage');
  const [q, setQ] = useQueryState({ tab: 'tiers' });
  return (
    <>
      <PageHead title="VIP tiers & collections" subtitle="Membership tiers decide who sees VIP profiles, private galleries, collections and members-only articles." />
      <Tabs tabs={[['tiers', 'Tiers'], ['collections', 'Collections']]} value={q.tab} onChange={(tab) => setQ({ tab })} />
      {q.tab === 'collections' ? <Collections manage={manage} /> : <Tiers manage={manage} />}
    </>
  );
}
