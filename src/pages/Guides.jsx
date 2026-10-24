// Guides, announcements and news.
import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useSite } from '../context/SiteContext';
import { api, qs } from '../utils/api';
import { breadcrumbLd, useSeo } from '../utils/seo';
import { day } from '../utils/format';
import { Empty, PageHero, PageSkeleton, PostsSkeleton, Sections } from '../components/Common';
import NotFound from './NotFound';

const KINDS = [['', 'All'], ['Guide', 'Guides'], ['Announcement', 'Announcements'], ['News', 'News']];

export function PostCard({ p }) {
  return (
    <Link to={`/guides/${p.slug}`} className="post-card">
      <div className="post-cover">{p.coverUrl ? <img src={p.coverUrl} alt={p.coverAlt || ''} loading="lazy" decoding="async" /> : p.kind}</div>
      <div className="post-card-body">
        <span className="kicker" style={{ margin: 0 }}>{p.kind} · {day(p.publishedAt)}{p.locationName ? ` · ${p.locationName}` : ''}</span>
        <h3>{p.title}</h3>
        <p>{p.excerpt}</p>
      </div>
    </Link>
  );
}

export default function Guides() {
  const [params, setParams] = useSearchParams();
  const kind = params.get('kind') || '';
  // 12 articles at a time; "Load more" appends the next page.
  const [list, setList] = useState(null);
  const [more, setMore] = useState(false);
  const load = (page) => {
    setMore(page > 1);
    return api('GET', `/site/posts${qs({ kind, page, pageSize: 12 })}`)
      .then((r) => setList((prev) => ({ ...r, items: page > 1 && prev ? [...prev.items, ...r.items] : r.items })))
      .catch(() => setList((prev) => prev || { items: [], total: 0, page: 1, pageSize: 12 }))
      .finally(() => setMore(false));
  };
  useEffect(() => { setList(null); load(1); }, [kind]); // eslint-disable-line react-hooks/exhaustive-deps
  const posts = list?.items;
  useSeo({ title: 'Guides & announcements', description: 'City guides, booking tips, etiquette and announcements.', jsonLd: breadcrumbLd([['Home', '/'], ['Guides', '/guides']]) });
  return (
    <>
      <PageHero compact crumbs={[['Home', '/'], ['Guides']]} kicker="Journal" title="Guides & announcements" text="City guides, booking tips and news from the concierge." />
      <section className="section" style={{ paddingTop: 30 }}>
        <div className="container">
          <div className="chip-row" style={{ marginBottom: 24 }}>
            {KINDS.map(([k, label]) => <button key={k} className={`chip ${kind === k ? 'on' : ''}`} onClick={() => setParams(k ? { kind: k } : {})}>{label}</button>)}
          </div>
          <h2 className="sr-only">Articles</h2>
          {!posts ? <PostsSkeleton /> : posts.length ? <div className="grid-3">{posts.map((p) => <PostCard key={p.slug} p={p} />)}</div> : <Empty title="Nothing here yet" text="Check back soon." />}
          {list && posts.length < list.total && (
            <p className="center" style={{ marginTop: 30 }}>
              <button className="btn btn-ghost" disabled={more} onClick={() => load(list.page + 1)}>{more ? 'Loading…' : `Load more (${list.total - posts.length} more)`}</button>
            </p>
          )}
        </div>
      </section>
    </>
  );
}

export function GuidePage() {
  const { slug } = useParams();
  const { site } = useSite();
  const [state, setState] = useState({ loading: true });
  useEffect(() => {
    setState({ loading: true });
    api('GET', `/site/posts/${slug}`).then((p) => setState({ p })).catch((e) => setState({ error: e.status || 500 }));
  }, [slug]);
  const p = state.p;
  useSeo(p ? {
    title: p.seoTitle || p.title, description: p.metaDescription || p.excerpt, image: p.coverUrl, type: 'article',
    jsonLd: [
      { '@type': 'Article', headline: p.title, description: p.excerpt || undefined, datePublished: p.publishedAt, dateModified: p.updatedAt, image: p.coverUrl ? new URL(p.coverUrl, window.location.origin).href : undefined, publisher: { '@type': 'Organization', name: site.siteName } },
      breadcrumbLd([['Home', '/'], ['Guides', '/guides'], [p.title, `/guides/${p.slug}`]]),
    ],
  } : { title: 'Article', noindex: true });
  if (state.loading) return <PageSkeleton />;
  if (state.error === 404) return <NotFound />;
  if (state.error) return <div className="narrow section"><div className="notice error">This article couldn’t be loaded.</div></div>;
  return (
    <>
      <PageHero compact crumbs={[['Home', '/'], ['Guides', '/guides'], [p.title]]} kicker={`${p.kind} · ${day(p.publishedAt)}`} title={p.title} text={p.excerpt}>
        {p.locationName && <p style={{ marginTop: 12 }}><Link to={`/locations/${p.locationSlug}`} className="chip">{p.locationName}</Link></p>}
      </PageHero>
      <section className="section" style={{ paddingTop: 36 }}>
        <div className="narrow">
          {p.coverUrl && <img src={p.coverUrl} alt={p.coverAlt || ''} decoding="async" fetchpriority="high" style={{ borderRadius: 22, marginBottom: 30, width: '100%' }} />}
          <Sections sections={p.sections} />
          <p style={{ marginTop: 36 }}><Link to="/guides" className="btn btn-ghost">← All articles</Link></p>
        </div>
      </section>
    </>
  );
}
