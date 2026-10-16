import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useSite } from '../context/SiteContext';
import { api, qs } from '../utils/api';
import { faqLd, useSeo } from '../utils/seo';
import { day } from '../utils/format';
import ProfileCard from '../components/ProfileCard';
import { FaqList, Loading, Photo, SectionHead } from '../components/Common';
import { IconCalendar, IconCheck, IconCrown, IconShield } from '../components/Icons';

function SearchPanel() {
  const { categories, cities, areasOf } = useSite();
  const navigate = useNavigate();
  const [f, setF] = useState({ location: '', category: '', available: '' });
  const go = (e) => {
    e.preventDefault();
    const { category, ...rest } = f;
    navigate(`${category ? `/${category}` : '/companions'}${qs(rest)}`);
  };
  return (
    <form className="search-panel" onSubmit={go} role="search" aria-label="Find a companion">
      <label><span>City or area</span>
        <select value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })}>
          <option value="">Anywhere</option>
          {cities.map((c) => (
            <optgroup key={c.id} label={c.name}>
              <option value={c.slug}>All of {c.name}</option>
              {areasOf(c.id).map((a) => <option key={a.id} value={a.slug}>{a.name}</option>)}
            </optgroup>
          ))}
        </select>
      </label>
      <label><span>Category</span>
        <select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>
          <option value="">All categories</option>
          {categories.map((c) => <option key={c.id} value={c.slug}>{c.name}</option>)}
        </select>
      </label>
      <label><span>Availability</span>
        <select value={f.available} onChange={(e) => setF({ ...f, available: e.target.value })}>
          <option value="">Any day</option>
          <option value="today">Available today</option>
        </select>
      </label>
      <button className="btn btn-primary btn-lg">Search</button>
    </form>
  );
}

export default function Home() {
  const { site, stats, faqs, cities, categories, tiers, member } = useSite();
  const [data, setData] = useState(null);
  useEffect(() => { api('GET', '/site/home').then(setData).catch(() => setData({ featured: [], recent: [], posts: [] })); }, [member?.id]);
  const homeFaqs = faqs.filter((f) => f.showOnHome);
  const popular = cities.filter((c) => c.isPopular);
  useSeo({
    exactTitle: `${site.siteName} — ${site.tagline}`,
    description: site.seoDefaultDescription,
    jsonLd: [
      { '@type': 'Organization', name: site.siteName, url: window.location.origin, email: site.email || undefined },
      { '@type': 'WebSite', name: site.siteName, url: window.location.origin,
        potentialAction: { '@type': 'SearchAction', target: `${window.location.origin}/companions?q={search_term_string}`, 'query-input': 'required name=search_term_string' } },
      ...(homeFaqs.length ? [faqLd(homeFaqs)] : []),
    ],
  });
  const collage = (data?.featured || []).filter((p) => p.photoUrl).slice(0, 2);

  return (
    <>
      <section className="hero">
        <div className="container hero-grid">
          <div>
            <span className="kicker">Verified · Discreet · On your schedule</span>
            <h1>{site.heroTitle}</h1>
            <p className="lead">{site.heroText}</p>
            <SearchPanel />
            <div className="hero-trust">
              <span><IconShield size={18} />Every profile ID-verified (18+)</span>
              <span><IconCalendar size={18} />Live availability</span>
              <span><IconCheck size={18} />Rates published up front</span>
            </div>
          </div>
          <div className="hero-collage" aria-hidden={!collage.length}>
            {collage.map((p) => <Link key={p.id} to={`/companions/${p.slug}`}><Photo src={p.photoUrl} alt={p.photoAlt} name={p.name} /><span>{p.name}</span></Link>)}
          </div>
        </div>
      </section>

      <section className="section">
        <div className="container">
          <div className="stats-strip">
            <div><strong>{stats.profiles}</strong><span>published profiles</span></div>
            <div><strong>{stats.verified}</strong><span>in-person verified</span></div>
            <div><strong>{data?.availableTodayCount ?? '—'}</strong><span>available today</span></div>
            <div><strong>{cities.length}</strong><span>cities covered</span></div>
          </div>
        </div>
      </section>

      <section className="section" style={{ paddingTop: 10 }}>
        <div className="container">
          <SectionHead kicker="Featured" title="Featured companions" text="Hand-picked profiles, freshly verified by our team." action={<Link to="/companions?featured=1" className="btn btn-ghost">View all</Link>} />
          {!data ? <Loading /> : <div className="grid-cards four">{data.featured.slice(0, 8).map((p) => <ProfileCard key={p.id} p={p} />)}</div>}
        </div>
      </section>

      <section className="section section-alt">
        <div className="container">
          <SectionHead kicker="Browse" title="Find your type of company" center />
          <div className="grid-3">
            {categories.map((c) => (
              <Link key={c.id} to={`/${c.slug}`} className="loc-card" style={{ aspectRatio: '16 / 10' }}>
                <div><small>{c.profileCount} profiles</small><h3>{c.name}</h3><small>{c.description}</small></div>
              </Link>
            ))}
          </div>
        </div>
      </section>

      <section className="section">
        <div className="container">
          <SectionHead kicker="Just updated" title="Recently updated profiles" text="New photos, rates and availability — every profile shows when it was last updated." action={<Link to="/companions?sort=active" className="btn btn-ghost">Recently active</Link>} />
          {!data ? <Loading /> : <div className="grid-cards four">{data.recent.slice(0, 4).map((p) => <ProfileCard key={p.id} p={p} />)}</div>}
        </div>
      </section>

      {popular.length > 0 && (
        <section className="section section-alt">
          <div className="container">
            <SectionHead kicker="Locations" title="Popular locations" action={<Link to="/locations" className="btn btn-ghost">All locations</Link>} />
            <div className="grid-3">
              {popular.map((l) => (
                <Link key={l.id} to={`/locations/${l.slug}`} className="loc-card">
                  {l.imageUrl && <img src={l.imageUrl} alt={l.imageAlt || ''} loading="lazy" />}
                  <div><small>{l.region}</small><h3>{l.name}</h3><small>{l.profileCount} companions</small></div>
                </Link>
              ))}
            </div>
          </div>
        </section>
      )}

      <section className="section">
        <div className="container">
          <SectionHead kicker="How it works" title="Booking in three steps" center />
          <div className="grid-3 how">
            <div className="panel"><h3>Choose a companion</h3><p className="muted">Filter by city, category, budget and availability. Every profile shows published rates and session lengths.</p></div>
            <div className="panel"><h3>Send a request</h3><p className="muted">Pick a session and an open time. Fees are shown before you confirm, and you get a reference number instantly.</p></div>
            <div className="panel"><h3>Get confirmed</h3><p className="muted">Our concierge confirms by email. Track the status, cancel or reschedule online anytime before the cut-off.</p></div>
          </div>
        </div>
      </section>

      {tiers.length > 0 && (
        <section className="section" style={{ paddingTop: 0 }}>
          <div className="container">
            <div className="cta-band">
              <div>
                <span className="kicker"><IconCrown size={14} /> VIP membership</span>
                <h2>Private collections. Priority bookings.</h2>
                <p className="lead" style={{ margin: 0 }}>Members unlock VIP-only profiles, private galleries and exclusive guides — from {tiers[0] && new Intl.NumberFormat('en-PH', { style: 'currency', currency: site.currency || 'PHP', maximumFractionDigits: 0 }).format(tiers[0].price)}.</p>
              </div>
              <Link to="/vip" className="btn btn-primary btn-lg">Explore VIP</Link>
            </div>
          </div>
        </section>
      )}

      {data?.posts?.length > 0 && (
        <section className="section section-alt">
          <div className="container">
            <SectionHead kicker="Guides" title="Guides & announcements" action={<Link to="/guides" className="btn btn-ghost">All articles</Link>} />
            <div className="grid-3">
              {data.posts.map((p) => (
                <Link key={p.slug} to={`/guides/${p.slug}`} className="post-card">
                  <div className="post-cover">{p.coverUrl ? <img src={p.coverUrl} alt={p.coverAlt || ''} loading="lazy" /> : p.kind}</div>
                  <div className="post-card-body"><span className="kicker" style={{ margin: 0 }}>{p.kind} · {day(p.publishedAt)}</span><h3>{p.title}</h3><p>{p.excerpt}</p></div>
                </Link>
              ))}
            </div>
          </div>
        </section>
      )}

      {homeFaqs.length > 0 && (
        <section className="section">
          <div className="narrow">
            <SectionHead kicker="Questions" title="Frequently asked questions" center />
            <FaqList faqs={homeFaqs} />
            <p className="center" style={{ marginTop: 24 }}><Link to="/faq" className="btn btn-ghost">All questions</Link></p>
          </div>
        </section>
      )}

      <section className="section" style={{ paddingTop: 0 }}>
        <div className="container">
          <div className="cta-band">
            <div><h2 style={{ margin: 0 }}>Ready when you are.</h2><p className="lead" style={{ margin: '8px 0 0' }}>See who is available today, or send the concierge a question.</p></div>
            <div className="row"><Link to="/companions?available=today" className="btn btn-primary btn-lg">Available today</Link><Link to="/contact" className="btn btn-ghost btn-lg">Contact us</Link></div>
          </div>
        </div>
      </section>
    </>
  );
}
