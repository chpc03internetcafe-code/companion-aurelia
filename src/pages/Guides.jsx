// Guides, announcements and member news. Members-only articles show a lock for everyone else.
import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useSite } from '../context/SiteContext';
import { api, qs } from '../utils/api';
import { breadcrumbLd, useSeo } from '../utils/seo';
import { day } from '../utils/format';
import { Empty, Loading, PageHero, Sections } from '../components/Common';
import { IconCrown, IconLock } from '../components/Icons';
import NotFound from './NotFound';

const KINDS = [['', 'All'], ['Guide', 'Guides'], ['Announcement', 'Announcements'], ['News', 'Member news']];

export function PostCard({ p }) {
  return (
    <Link to={`/guides/${p.slug}`} className="post-card">
      <div className="post-cover">{p.coverUrl ? <img src={p.coverUrl} alt={p.coverAlt || ''} loading="lazy" /> : p.kind}</div>
      <div className="post-card-body">
        <span className="kicker" style={{ margin: 0 }}>{p.kind} · {day(p.publishedAt)}{p.locationName ? ` · ${p.locationName}` : ''}</span>
        <h3>{p.title}</h3>
        <p>{p.excerpt}</p>
        {p.audience === 'Members' && <span className="vip-chip" style={{ alignSelf: 'flex-start', marginTop: 'auto' }}>{p.locked ? <IconLock size={12} /> : <IconCrown size={12} />}{p.tierName ? `${p.tierName} members` : 'Members only'}</span>}
      </div>
    </Link>
  );
}

export default function Guides() {
  const [params, setParams] = useSearchParams();
  const kind = params.get('kind') || '';
  const { member } = useSite();
  const [posts, setPosts] = useState(null);
  useEffect(() => { setPosts(null); api('GET', `/site/posts${qs({ kind })}`).then(setPosts).catch(() => setPosts([])); }, [kind, member?.tierRank]);
  useSeo({ title: 'Guides & announcements', description: 'City guides, booking tips, etiquette and announcements.', jsonLd: breadcrumbLd([['Home', '/'], ['Guides', '/guides']]) });
  return (
    <>
      <PageHero compact crumbs={[['Home', '/'], ['Guides']]} kicker="Journal" title="Guides & announcements" text="City guides, booking tips and news — plus exclusive articles for members." />
      <section className="section" style={{ paddingTop: 30 }}>
        <div className="container">
          <div className="chip-row" style={{ marginBottom: 24 }}>
            {KINDS.map(([k, label]) => <button key={k} className={`chip ${kind === k ? 'on' : ''}`} onClick={() => setParams(k ? { kind: k } : {})}>{label}</button>)}
          </div>
          {!posts ? <Loading /> : posts.length ? <div className="grid-3">{posts.map((p) => <PostCard key={p.slug} p={p} />)}</div> : <Empty title="Nothing here yet" text="Check back soon." />}
        </div>
      </section>
    </>
  );
}

export function GuidePage() {
  const { slug } = useParams();
  const { member, site } = useSite();
  const [state, setState] = useState({ loading: true });
  useEffect(() => {
    setState({ loading: true });
    api('GET', `/site/posts/${slug}`).then((p) => setState({ p })).catch((e) => setState({ error: e.status || 500 }));
  }, [slug, member?.tierRank]);
  const p = state.p;
  useSeo(p ? {
    title: p.seoTitle || p.title, description: p.metaDescription || p.excerpt, image: p.coverUrl, type: 'article', noindex: p.audience === 'Members',
    jsonLd: p.audience === 'Public' ? [
      { '@type': 'Article', headline: p.title, description: p.excerpt || undefined, datePublished: p.publishedAt, dateModified: p.updatedAt, image: p.coverUrl ? new URL(p.coverUrl, window.location.origin).href : undefined, publisher: { '@type': 'Organization', name: site.siteName } },
      breadcrumbLd([['Home', '/'], ['Guides', '/guides'], [p.title, `/guides/${p.slug}`]]),
    ] : null,
  } : { title: 'Article', noindex: true });
  if (state.loading) return <Loading />;
  if (state.error === 404) return <NotFound />;
  if (state.error) return <div className="narrow section"><div className="notice error">This article couldn’t be loaded.</div></div>;
  return (
    <>
      <PageHero compact crumbs={[['Home', '/'], ['Guides', '/guides'], [p.title]]} kicker={`${p.kind} · ${day(p.publishedAt)}`} title={p.title} text={p.excerpt}>
        {p.locationName && <p style={{ marginTop: 12 }}><Link to={`/locations/${p.locationSlug}`} className="chip">{p.locationName}</Link></p>}
      </PageHero>
      <section className="section" style={{ paddingTop: 36 }}>
        <div className="narrow">
          {p.coverUrl && <img src={p.coverUrl} alt={p.coverAlt || ''} style={{ borderRadius: 22, marginBottom: 30, width: '100%' }} />}
          {p.locked ? (
            <div className="locked-box" style={{ padding: 26 }}>
              <IconLock size={32} style={{ color: 'var(--primary)', flex: 'none' }} />
              <div style={{ flex: 1 }}><strong style={{ fontFamily: 'var(--serif)', fontSize: '1.4rem' }}>For {p.tierName || 'VIP'} members</strong><p className="muted" style={{ margin: 0 }}>{member ? 'Upgrade your membership to read this article.' : 'Sign in with an active membership to read this article.'}</p></div>
              <Link to={member ? '/account/membership' : '/vip'} className="btn btn-primary">{member ? 'Upgrade' : 'Join VIP'}</Link>
            </div>
          ) : <Sections sections={p.sections} />}
          <p style={{ marginTop: 36 }}><Link to="/guides" className="btn btn-ghost">← All articles</Link></p>
        </div>
      </section>
    </>
  );
}
