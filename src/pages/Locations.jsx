import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useSite } from '../context/SiteContext';
import { api } from '../utils/api';
import { breadcrumbLd, useSeo } from '../utils/seo';
import { day } from '../utils/format';
import { PageHero, PageSkeleton, Sections, SectionHead } from '../components/Common';
import { DirectoryResults } from './Directory';
import NotFound from './NotFound';

export default function Locations() {
  const { cities, areasOf } = useSite();
  useSeo({ title: 'Locations', description: `Verified companions in ${cities.map((c) => c.name).join(', ')}. Browse by city and service area.`, jsonLd: breadcrumbLd([['Home', '/'], ['Locations', '/locations']]) });
  const regions = [...new Set(cities.map((c) => c.region || 'Other'))];
  return (
    <>
      <PageHero compact crumbs={[['Home', '/'], ['Locations']]} kicker="Where we are" title="Locations" text="Choose a city to see companions based there or serving the area, plus local guides and tips." />
      <section className="section" style={{ paddingTop: 36 }}>
        <div className="container stack" style={{ gap: 40 }}>
          {regions.map((r) => (
            <div key={r}>
              <h2 style={{ fontSize: '1.8rem' }}>{r}</h2>
              <div className="grid-3">
                {cities.filter((c) => (c.region || 'Other') === r).map((c) => (
                  <div key={c.id} className="panel">
                    <Link to={`/locations/${c.slug}`}><h3 style={{ marginBottom: 4 }}>{c.name}</h3></Link>
                    <p className="muted" style={{ marginBottom: 12 }}>{c.profileCount} companions</p>
                    <div className="chip-row">{areasOf(c.id).map((a) => <Link key={a.id} to={`/locations/${a.slug}`} className="chip">{a.name}</Link>)}</div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}

export function LocationPage() {
  const { slug } = useParams();
  const [state, setState] = useState({ loading: true });
  useEffect(() => {
    setState({ loading: true });
    api('GET', `/site/locations/${slug}`).then((l) => setState({ l })).catch((e) => setState({ error: e.status || 500 }));
  }, [slug]);
  const l = state.l;
  const crumbs = l ? [['Home', '/'], ['Locations', '/locations'], ...(l.parentSlug ? [[l.parentName, `/locations/${l.parentSlug}`]] : []), [l.name, `/locations/${l.slug}`]] : [];
  useSeo(l ? {
    title: l.seoTitle || `Companions in ${l.name}${l.parentName ? `, ${l.parentName}` : ''}`,
    description: l.metaDescription || l.intro, image: l.imageUrl,
    jsonLd: [breadcrumbLd(crumbs), { '@type': 'CollectionPage', name: `Companions in ${l.name}`, description: l.intro || undefined, dateModified: l.updatedAt }],
  } : { title: 'Location', noindex: !!state.error });
  if (state.loading) return <PageSkeleton />;
  if (state.error === 404) return <NotFound />;
  if (state.error) return <div className="narrow section"><div className="notice error">This page couldn’t be loaded.</div></div>;

  return (
    <>
      <PageHero crumbs={crumbs.map(([a, b], i) => (i === crumbs.length - 1 ? [a] : [a, b]))} kicker={l.region || 'Location'} title={`Companions in ${l.name}`} text={l.intro}>
        {l.areas.length > 0 && <div className="chip-row" style={{ marginTop: 18 }}>{l.areas.map((a) => <Link key={a.id} to={`/locations/${a.slug}`} className="chip">{a.name}</Link>)}</div>}
      </PageHero>
      <DirectoryResults key={slug} fixed={{ location: slug }} />
      {(l.sections.length > 0 || l.posts.length > 0) && (
        <section className="section section-alt">
          <div className="container grid-2" style={{ alignItems: 'start', gridTemplateColumns: l.posts.length ? '1.4fr 1fr' : '1fr' }}>
            {l.sections.length > 0 && <div><Sections sections={l.sections} /></div>}
            {l.posts.length > 0 && (
              <div>
                <SectionHead kicker="Local guides" title={`${l.name} guides`} />
                <div className="stack">
                  {l.posts.map((p) => (
                    <Link key={p.slug} to={`/guides/${p.slug}`} className="post-card"><div className="post-card-body"><span className="kicker" style={{ margin: 0 }}>{p.kind} · {day(p.publishedAt)}</span><h3>{p.title}</h3><p>{p.excerpt}</p></div></Link>
                  ))}
                </div>
              </div>
            )}
          </div>
        </section>
      )}
    </>
  );
}
