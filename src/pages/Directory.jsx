// Directory with filters kept in the URL (?location=makati&available=today…), so every view can be shared.
// Also used by category pages (/female) and location pages (with a fixed category or location).
import { useEffect, useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { useSite } from '../context/SiteContext';
import { api, qs } from '../utils/api';
import { breadcrumbLd, useSeo } from '../utils/seo';
import { duration, money, todayIso, addDays } from '../utils/format';
import ProfileCard from '../components/ProfileCard';
import { CardsSkeleton, Empty, Field, PageHero, useDebounced } from '../components/Common';
import { IconClose, IconFilter } from '../components/Icons';
import NotFound from './NotFound';

const KEYS = ['q', 'location', 'category', 'budgetMin', 'budgetMax', 'duration', 'available', 'verified', 'featured', 'sort', 'page'];

function FilterPanel({ f, set, fixed, open, onClose }) {
  const { categories, cities, areasOf, durations, sorts } = useSite();
  const [q, setQ] = useState(f.q || '');
  const [budget, setBudget] = useState({ min: f.budgetMin || '', max: f.budgetMax || '' });
  useEffect(() => { setQ(f.q || ''); setBudget({ min: f.budgetMin || '', max: f.budgetMax || '' }); }, [f.q, f.budgetMin, f.budgetMax]);
  // search as you type, once typing pauses (one request instead of one per keystroke)
  const typed = useDebounced(q.trim(), 400);
  useEffect(() => { if (typed !== (f.q || '')) set({ q: typed }); }, [typed]); // eslint-disable-line react-hooks/exhaustive-deps
  const dateValue = f.available && f.available !== 'today' ? f.available : '';
  return (
    <aside className={`filters ${open ? 'open' : ''}`} aria-label="Filters">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <strong style={{ fontFamily: 'var(--serif)', fontSize: '1.4rem' }}>Filters</strong>
        <button className="icon-btn filter-open" onClick={onClose} aria-label="Close filters"><IconClose size={18} /></button>
      </div>
      <form onSubmit={(e) => { e.preventDefault(); set({ q: q.trim() }); }}>
        <Field label="Search"><input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, language, area…" /></Field>
      </form>
      {!fixed.location && (
        <div>
          <h2>Location & service area</h2>
          <select className="input" value={f.location || ''} onChange={(e) => set({ location: e.target.value })} aria-label="Location">
            <option value="">Anywhere</option>
            {cities.map((c) => (
              <optgroup key={c.id} label={c.name}>
                <option value={c.slug}>All of {c.name}</option>
                {areasOf(c.id).map((a) => <option key={a.id} value={a.slug}>{a.name}</option>)}
              </optgroup>
            ))}
          </select>
        </div>
      )}
      {!fixed.category && (
        <div>
          <h2>Category</h2>
          <div className="chip-row">
            <button type="button" className={`chip ${!f.category ? 'on' : ''}`} onClick={() => set({ category: '' })}>All</button>
            {categories.map((c) => <button type="button" key={c.id} className={`chip ${f.category === c.slug ? 'on' : ''}`} onClick={() => set({ category: c.slug })}>{c.name}</button>)}
          </div>
        </div>
      )}
      <div>
        <h2>Availability</h2>
        <div className="chip-row" style={{ marginBottom: 8 }}>
          <button type="button" className={`chip ${!f.available ? 'on' : ''}`} onClick={() => set({ available: '' })}>Any day</button>
          <button type="button" className={`chip ${f.available === 'today' ? 'on' : ''}`} onClick={() => set({ available: 'today' })}>Today</button>
          <button type="button" className={`chip ${f.available === addDays(todayIso(), 1) ? 'on' : ''}`} onClick={() => set({ available: addDays(todayIso(), 1) })}>Tomorrow</button>
        </div>
        <input className="input" type="date" min={todayIso()} value={dateValue} onChange={(e) => set({ available: e.target.value })} aria-label="Available on date" />
      </div>
      <div>
        <h2>Budget per session</h2>
        <form className="range-row" onSubmit={(e) => { e.preventDefault(); set({ budgetMin: budget.min, budgetMax: budget.max }); }}>
          <input inputMode="numeric" placeholder="Min" value={budget.min} onChange={(e) => setBudget({ ...budget, min: e.target.value.replace(/\D/g, '') })} onBlur={() => set({ budgetMin: budget.min, budgetMax: budget.max })} aria-label="Minimum budget" />
          <span className="muted">–</span>
          <input inputMode="numeric" placeholder="Max" value={budget.max} onChange={(e) => setBudget({ ...budget, max: e.target.value.replace(/\D/g, '') })} onBlur={() => set({ budgetMin: budget.min, budgetMax: budget.max })} aria-label="Maximum budget" />
        </form>
        <div className="chip-row" style={{ marginTop: 8 }}>
          {[[0, 5000], [5000, 12000], [12000, 0]].map(([a, b]) => (
            <button type="button" key={`${a}-${b}`} className={`chip ${String(f.budgetMin || '') === String(a || '') && String(f.budgetMax || '') === String(b || '') ? 'on' : ''}`}
              onClick={() => set({ budgetMin: a || '', budgetMax: b || '' })}>{b ? (a ? `${money(a)}–${money(b)}` : `Under ${money(b)}`) : `${money(a)}+`}</button>
          ))}
        </div>
      </div>
      {durations.length > 0 && (
        <div>
          <h2>Session length</h2>
          <div className="chip-row">
            <button type="button" className={`chip ${!f.duration ? 'on' : ''}`} onClick={() => set({ duration: '' })}>Any</button>
            {durations.map((d) => <button type="button" key={d} className={`chip ${String(f.duration) === String(d) ? 'on' : ''}`} onClick={() => set({ duration: String(d) })}>{duration(d)}</button>)}
          </div>
        </div>
      )}
      <div>
        <h2>Profile</h2>
        <div className="stack">
          <label className="check"><input type="checkbox" checked={f.verified === '1'} onChange={(e) => set({ verified: e.target.checked ? '1' : '' })} /> Verified only</label>
          <label className="check"><input type="checkbox" checked={f.featured === '1'} onChange={(e) => set({ featured: e.target.checked ? '1' : '' })} /> Featured only</label>
        </div>
      </div>
      <div>
        <h2>Sort by</h2>
        <select className="input" value={f.sort || 'featured'} onChange={(e) => set({ sort: e.target.value === 'featured' ? '' : e.target.value })} aria-label="Sort by">
          {Object.entries(sorts).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>
      <button type="button" className="btn btn-ghost btn-block" onClick={() => set(Object.fromEntries(KEYS.map((k) => [k, ''])))}>Clear all filters</button>
      <button type="button" className="btn btn-primary btn-block filter-open" onClick={onClose}>Show results</button>
    </aside>
  );
}

export function DirectoryResults({ fixed = {}, heading }) {
  const { categories, locations, sorts } = useSite();
  const [params, setParams] = useSearchParams();
  const f = useMemo(() => Object.fromEntries(KEYS.map((k) => [k, params.get(k) || ''])), [params]);
  const [state, setState] = useState({ loading: true, data: null, error: '' });
  const [open, setOpen] = useState(false);

  const set = (patch) => {
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      for (const [k, v] of Object.entries({ ...patch, ...('page' in patch ? {} : { page: '' }) })) {
        if (v === '' || v == null) next.delete(k); else next.set(k, String(v));
      }
      return next;
    }, { replace: false });
  };
  const query = { ...f, ...fixed, pageSize: 24 };
  const key = JSON.stringify(query);
  useEffect(() => {
    let cancelled = false;
    setState((s) => ({ ...s, loading: true }));
    api('GET', `/site/profiles${qs(query)}`)
      .then((data) => !cancelled && setState({ loading: false, data, error: '' }))
      .catch((e) => !cancelled && setState({ loading: false, data: null, error: e.message }));
    return () => { cancelled = true; };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [open]);

  const labels = {
    q: (v) => `“${v}”`, location: (v) => locations.find((l) => l.slug === v)?.name || v, category: (v) => categories.find((c) => c.slug === v)?.name || v,
    budgetMin: (v) => `From ${money(v)}`, budgetMax: (v) => `Up to ${money(v)}`, duration: (v) => duration(Number(v)), available: (v) => (v === 'today' ? 'Available today' : `Available ${v}`),
    verified: () => 'Verified', featured: () => 'Featured', sort: (v) => sorts[v] || v,
  };
  const active = KEYS.filter((k) => k !== 'page' && f[k] && !fixed[k]);
  const d = state.data;
  const pages = d ? Math.max(1, Math.ceil(d.total / d.pageSize)) : 1;

  return (
    <div className="container directory">
      <FilterPanel f={f} set={set} fixed={fixed} open={open} onClose={() => setOpen(false)} />
      {open && <div className="drawer-backdrop" style={{ zIndex: 65 }} onClick={() => setOpen(false)} />}
      <div>
        {heading}
        <div className="results-bar">
          <div><strong>{d ? d.total : '…'}</strong> <span className="muted">{d?.total === 1 ? 'companion' : 'companions'}</span></div>
          <button className="btn btn-ghost btn-sm filter-open" onClick={() => setOpen(true)}><IconFilter size={16} />Filters{active.length ? ` (${active.length})` : ''}</button>
        </div>
        {active.length > 0 && (
          <div className="active-filters">
            {active.map((k) => <button key={k} className="chip on" onClick={() => set({ [k]: '' })} aria-label={`Remove filter ${labels[k](f[k])}`}>{labels[k](f[k])} <IconClose size={12} /></button>)}
          </div>
        )}
        {state.error && <div className="notice error">{state.error}</div>}
        {state.loading && !d ? <CardsSkeleton count={8} /> : d?.items.length ? (
          <div className="grid-cards" style={{ opacity: state.loading ? 0.5 : 1, transition: 'opacity 0.2s' }}>{d.items.map((p) => <ProfileCard key={p.id} p={p} />)}</div>
        ) : !state.loading && <Empty title="No companions match" text="Try another date, a wider budget or a nearby area." action={<button className="btn btn-primary" onClick={() => set(Object.fromEntries(KEYS.map((k) => [k, ''])))}>Clear filters</button>} />}
        {d && pages > 1 && (
          <nav className="pager" aria-label="Pages">
            <button className="btn btn-ghost btn-sm" disabled={d.page <= 1} onClick={() => { set({ page: d.page - 1 }); window.scrollTo(0, 0); }}>‹ Previous</button>
            <span className="muted">Page {d.page} of {pages}</span>
            <button className="btn btn-ghost btn-sm" disabled={d.page >= pages} onClick={() => { set({ page: d.page + 1 }); window.scrollTo(0, 0); }}>Next ›</button>
          </nav>
        )}
      </div>
    </div>
  );
}

export default function Directory() {
  const { stats } = useSite();
  useSeo({ title: 'All companions', description: `Browse ${stats.profiles} verified companions by city, category, budget and availability. Published rates and live availability on every profile.`,
    jsonLd: breadcrumbLd([['Home', '/'], ['Companions', '/companions']]) });
  return (
    <>
      <PageHero compact crumbs={[['Home', '/'], ['Companions']]} kicker="Directory" title="All companions" text="Every profile is ID-verified, shows published rates and is kept up to date by our team." />
      <DirectoryResults />
    </>
  );
}

export function CategoryPage() {
  const { category: slug } = useParams();
  const { getCategory } = useSite();
  const cat = getCategory(slug);
  const [info, setInfo] = useState(null);
  useEffect(() => { if (cat) api('GET', `/site/categories/${slug}`).then(setInfo).catch(() => {}); }, [slug, cat]);
  useSeo(cat ? { title: info?.seoTitle || `${cat.name} companions`, exactTitle: undefined, description: info?.metaDescription || cat.description,
    jsonLd: breadcrumbLd([['Home', '/'], ['Companions', '/companions'], [cat.name, `/${cat.slug}`]]) } : { noindex: true, title: 'Page not found' });
  if (!cat) return <NotFound />;
  return (
    <>
      <PageHero compact crumbs={[['Home', '/'], ['Companions', '/companions'], [cat.name]]} kicker={`${cat.profileCount} profiles`} title={`${cat.name} companions`} text={info?.intro || cat.description} />
      <DirectoryResults key={slug} fixed={{ category: slug }} />
    </>
  );
}
