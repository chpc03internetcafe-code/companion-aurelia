import { Link, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useUi } from '../lib/ui';
import { day, money } from '../lib/format';
import { Empty, ErrorBox, Loading, PageHead, Pager, Pill, SearchBox, Stats, Thumb, Toggle, useAction, useLoad, useQueryState } from '../components/kit';

export default function Profiles() {
  const { meta } = useUi();
  const { can } = useAuth();
  const manage = can('profiles', 'manage');
  const navigate = useNavigate();
  const [q, setQ] = useQueryState({ status: '', categoryId: '', locationId: '', flag: '', search: '', sort: '', page: 1, pageSize: 50 });
  const { data, loading, error, reload, setData } = useLoad(() => api.get('/profiles', q), [JSON.stringify(q)]);
  const stats = useLoad(() => api.get('/profiles/stats'), []);
  const [run] = useAction();
  const s = stats.data;
  const patch = async (p, body, msg) => {
    const r = await run(() => api.patch(`/profiles/${p.id}`, body), msg);
    if (r) setData((d) => ({ ...d, items: d.items.map((x) => (x.id === p.id ? { ...x, isFeatured: r.isFeatured, status: r.status, bookingEnabled: r.bookingEnabled } : x)) }));
  };
  return (
    <>
      <PageHead title="Profiles" subtitle="Companion profiles: photos, rates, availability, verification and visibility."
        actions={manage && <Link to="/profiles/new" className="btn btn-primary">+ New profile</Link>} />
      {s && <Stats items={[
        { label: 'Published', value: s.published, onClick: () => setQ({ status: 'Published', flag: '' }), active: q.status === 'Published' },
        { label: 'Drafts', value: s.drafts, onClick: () => setQ({ status: 'Draft', flag: '' }), active: q.status === 'Draft' },
        { label: 'Hidden', value: s.hidden, onClick: () => setQ({ status: 'Hidden', flag: '' }), active: q.status === 'Hidden' },
        { label: 'Verified', value: `${s.verified}/${s.published}`, sub: 'of published' },
        { label: 'Retired', value: s.retired, onClick: () => setQ({ status: 'Retired', flag: '' }), active: q.status === 'Retired' },
      ]} />}
      <div className="card">
        <div className="filters">
          <SearchBox value={q.search} onChange={(search) => setQ({ search })} placeholder="Name, slug, tagline…" />
          <select value={q.status} onChange={(e) => setQ({ status: e.target.value })} aria-label="Status"><option value="">Active profiles</option>{meta.profileStatuses.map((x) => <option key={x}>{x}</option>)}<option value="all">All, incl. retired</option></select>
          <select value={q.categoryId} onChange={(e) => setQ({ categoryId: e.target.value })} aria-label="Category"><option value="">All categories</option>{meta.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
          <select value={q.locationId} onChange={(e) => setQ({ locationId: e.target.value })} aria-label="Location"><option value="">All locations</option>{meta.locations.map((l) => <option key={l.id} value={l.id}>{l.parentId ? `— ${l.name}` : l.name}</option>)}</select>
          <select value={q.flag} onChange={(e) => setQ({ flag: e.target.value })} aria-label="Flag"><option value="">Any</option><option value="featured">Featured</option><option value="unverified">Not verified</option><option value="incomplete">Incomplete (no photo, rate, availability or description)</option></select>
          <select value={q.sort} onChange={(e) => setQ({ sort: e.target.value })} aria-label="Sort"><option value="">Website order</option><option value="name">Name</option><option value="updated">Recently updated</option><option value="newest">Newest</option></select>
        </div>
        <ErrorBox error={error} onRetry={reload} />
        {loading && !data ? <Loading /> : data?.items.length ? (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Profile</th><th>Location</th><th className="hide-sm">Rates</th><th className="hide-sm">Setup</th><th>Status</th><th>Featured</th></tr></thead>
              <tbody>{data.items.map((p) => (
                <tr key={p.id} className="clickable" onClick={() => navigate(`/profiles/${p.id}`)}>
                  <td><div className="row" style={{ flexWrap: 'nowrap' }}><Thumb src={p.photoUrl} name={p.displayName} />
                    <div><strong>{p.displayName}</strong>, {p.age} {p.isVerified && <Pill tone="green">Verified</Pill>}
                      <span className="sub">{p.categoryName} · updated {day(p.updatedAt)}{p.openBookings ? ` · ${p.openBookings} open booking(s)` : ''}</span></div></div></td>
                  <td>{p.locationName || <span className="muted">—</span>}</td>
                  <td className="hide-sm">{p.rateCount ? <>from {money(p.priceFrom, true)}<span className="sub">{p.rateCount} rate(s)</span></> : <Pill tone="amber">No rates</Pill>}</td>
                  <td className="hide-sm">
                    {!p.ageVerifiedAt && <Pill tone="red">ID not checked</Pill>} {!p.mediaCount && <Pill tone="amber">No photos</Pill>} {!p.scheduleBlocks && <Pill tone="amber">No availability</Pill>}
                    {p.ageVerifiedAt && p.mediaCount > 0 && p.scheduleBlocks > 0 && <span className="muted">{p.mediaCount} media · {p.bookingEnabled ? 'booking on' : 'booking paused'}</span>}
                  </td>
                  <td><Pill>{p.status}</Pill></td>
                  <td onClick={(e) => e.stopPropagation()}>{manage && p.status !== 'Retired' ? <Toggle checked={p.isFeatured} onChange={(v) => patch(p, { isFeatured: v }, v ? 'Featured on the homepage' : 'No longer featured')} /> : p.isFeatured ? '★' : ''}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        ) : <Empty icon="✦" title="No profiles" text="Nothing matches these filters." action={manage && <Link to="/profiles/new" className="btn btn-primary">Create a profile</Link>} />}
        {data && <Pager page={q.page} pageSize={q.pageSize} total={data.total} onChange={setQ} />}
      </div>
    </>
  );
}
