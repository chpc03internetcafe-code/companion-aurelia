import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../utils/api';
import { breadcrumbLd, useSeo } from '../utils/seo';
import { day } from '../utils/format';
import { PageHero, PageSkeleton, Sections } from '../components/Common';
import NotFound from './NotFound';

export default function ContentPage() {
  const { slug } = useParams();
  const [state, setState] = useState({ loading: true });
  useEffect(() => {
    setState({ loading: true });
    api('GET', `/site/pages/${slug}`).then((p) => setState({ p })).catch((e) => setState({ error: e.status || 500 }));
  }, [slug]);
  const p = state.p;
  useSeo(p ? { title: p.seoTitle || p.title, description: p.metaDescription || p.intro, jsonLd: breadcrumbLd([['Home', '/'], [p.title, `/pages/${p.slug}`]]) } : { title: 'Page', noindex: true });
  if (state.loading) return <PageSkeleton />;
  if (state.error === 404) return <NotFound />;
  if (state.error) return <div className="narrow section"><div className="notice error">This page couldn’t be loaded.</div></div>;
  return (
    <>
      <PageHero compact crumbs={[['Home', '/'], [p.title]]} kicker={p.kicker} title={p.title} text={p.intro} />
      <section className="section" style={{ paddingTop: 30 }}>
        <div className="narrow">
          <Sections sections={p.sections} />
          <p className="muted" style={{ marginTop: 40, fontSize: '0.84rem' }}>Last updated {day(p.updatedAt)}</p>
        </div>
      </section>
    </>
  );
}
