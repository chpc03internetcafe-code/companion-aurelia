import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useSite } from '../context/SiteContext';
import { breadcrumbLd, faqLd, useSeo } from '../utils/seo';
import { Empty, FaqList, PageHero } from '../components/Common';

export default function FAQ() {
  const { faqs } = useSite();
  const [q, setQ] = useState('');
  const shown = useMemo(() => faqs.filter((f) => !q || `${f.question} ${f.answer}`.toLowerCase().includes(q.toLowerCase())), [faqs, q]);
  const groups = [...new Set(shown.map((f) => f.groupName))];
  useSeo({ title: 'Frequently asked questions', description: 'Answers about booking, verification and privacy.', jsonLd: [faqLd(faqs), breadcrumbLd([['Home', '/'], ['FAQ', '/faq']])] });
  return (
    <>
      <PageHero compact crumbs={[['Home', '/'], ['FAQ']]} kicker="Help" title="Frequently asked questions">
        <input className="input" type="search" style={{ maxWidth: 460, marginTop: 18 }} placeholder="Search questions…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search questions" />
      </PageHero>
      <section className="section" style={{ paddingTop: 30 }}>
        <div className="narrow">
          {groups.length ? groups.map((g) => (
            <div key={g} style={{ marginBottom: 34 }}>
              <h2 style={{ fontSize: '1.7rem' }}>{g}</h2>
              <FaqList faqs={shown.filter((f) => f.groupName === g)} />
            </div>
          )) : <Empty title="No matching questions" text="Try other words, or ask us directly." action={<Link to="/contact" className="btn btn-primary">Contact us</Link>} />}
        </div>
      </section>
    </>
  );
}
