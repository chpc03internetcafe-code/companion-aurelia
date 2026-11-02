import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useSite } from '../context/SiteContext';
import { api, qs } from '../utils/api';
import { faqLd, useSeo } from '../utils/seo';
import { day } from '../utils/format';
import ProfileCard from '../components/ProfileCard';
import { CardsSkeleton, FaqList, SectionHead } from '../components/Common';
import { ChatButton, ContactLinks } from '../components/Header';
import { IconArrow, IconCalendar, IconCheck, IconChat, IconPin, IconSearch, IconShield } from '../components/Icons';

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
      <label><span>Where</span>
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
      <label><span>Who</span>
        <select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>
          <option value="">All categories</option>
          {categories.map((c) => <option key={c.id} value={c.slug}>{c.name}</option>)}
        </select>
      </label>
      <label><span>When</span>
        <select value={f.available} onChange={(e) => setF({ ...f, available: e.target.value })}>
          <option value="">Any day</option>
          <option value="today">Available today</option>
        </select>
      </label>
      <button className="btn btn-primary btn-lg"><IconSearch size={18} />Search</button>
    </form>
  );
}

// The homepage gallery: everyone, one category, or who's free today; 12 at a time with a link to the full gallery.
function Gallery({ initial, total }) {
  const { categories } = useSite();
  const [tab, setTab] = useState('');
  const [lists, setLists] = useState({});
  useEffect(() => {
    if (!tab || lists[tab]) return;
    const filters = tab === 'today' ? { available: 'today' } : { category: tab };
    api('GET', `/site/profiles${qs({ ...filters, pageSize: 12 })}`)
      .then((r) => setLists((l) => ({ ...l, [tab]: r })))
      .catch(() => setLists((l) => ({ ...l, [tab]: { items: [], total: 0 } })));
  }, [tab, lists]);
  const current = tab ? lists[tab] : initial && { items: initial, total };
  const tabs = [['', 'All'], ...categories.map((c) => [c.slug, c.name]), ['today', 'Available today']];
  const more = tab === 'today' ? '/companions?available=today' : tab ? `/${tab}` : '/companions';

  return (
    <>
      <div className="gallery-tabs" role="tablist" aria-label="Show">
        {tabs.map(([key, label]) => (
          <button key={key || 'all'} type="button" role="tab" aria-selected={tab === key} className={`chip ${tab === key ? 'on' : ''}`} onClick={() => setTab(key)}>
            {key === 'today' && <i className="live-dot" aria-hidden="true" />}{label}
          </button>
        ))}
      </div>
      {!current ? <CardsSkeleton count={8} className="grid-cards gallery" />
        : current.items.length ? <div className="grid-cards gallery">{current.items.map((p) => <ProfileCard key={p.id} p={p} />)}</div>
        : <div className="empty"><strong>No one here right now</strong>Try another category, or ask the concierge.</div>}
      {current?.total > 0 && (
        <p className="center" style={{ marginTop: 32 }}>
          <Link to={more} className="btn btn-ghost btn-lg">View all {current.total} <IconArrow size={18} /></Link>
        </p>
      )}
    </>
  );
}

export default function Home() {
  const { site, stats, faqs, cities, areasOf } = useSite();
  const [data, setData] = useState(null);
  useEffect(() => { api('GET', '/site/home').then(setData).catch(() => setData({ gallery: [], featured: [], recent: [], posts: [] })); }, []);
  const homeFaqs = faqs.filter((f) => f.showOnHome);
  const popular = cities.filter((c) => c.isPopular);
  const areaCities = (popular.length ? popular : cities).slice(0, 3);
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
  // decorative photo wall behind the hero
  const wall = [...(data?.featured || []), ...(data?.gallery || [])].filter((p, i, all) => p.photoUrl && all.findIndex((x) => x.id === p.id) === i).slice(0, 6);

  return (
    <>
      <section className="hero">
        <div className="hero-wall" aria-hidden="true">
          {wall.map((p) => <img key={p.id} src={p.photoUrl} alt="" decoding="async" />)}
        </div>
        <div className="container hero-inner">
          <span className="hero-chip"><i className="live-dot" aria-hidden="true" />{data?.availableTodayCount ? `${data.availableTodayCount} available today` : 'Verified · Discreet · On your schedule'}</span>
          <h1>{site.heroTitle}</h1>
          <p className="lead">{site.heroText}</p>
          <div className="row hero-ctas">
            <Link to="/companions" className="btn btn-primary btn-lg">View gallery <IconArrow size={18} /></Link>
            <ChatButton className="btn btn-glass btn-lg">Chat with the concierge</ChatButton>
          </div>
          <SearchPanel />
          <ul className="hero-trust">
            <li><IconShield size={18} /><span><b>{stats.verified}</b> verified profiles</span></li>
            <li><IconCalendar size={18} /><span>Live availability</span></li>
            <li><IconCheck size={18} /><span>Rates published up front</span></li>
            <li><IconPin size={18} /><span><b>{cities.length}</b> {cities.length === 1 ? 'city' : 'cities'}</span></li>
          </ul>
        </div>
      </section>

      <section className="section">
        <div className="container">
          <SectionHead kicker="Gallery" title="Our companions" text="Every profile is ID-verified (18+). Tap a photo for rates, availability and booking." />
          <Gallery initial={data?.gallery} total={data?.galleryTotal} />
        </div>
      </section>

      {areaCities.length > 0 && (
        <section className="section section-alt">
          <div className="container">
            <SectionHead kicker="Outcall" title="Where we meet" text="Hotels, residences and venues across the city — choose an area to see who covers it."
              action={<Link to="/locations" className="btn btn-ghost">All locations <IconArrow size={16} /></Link>} />
            <div className="area-groups">
              {areaCities.map((c) => {
                const areas = areasOf(c.id);
                return (
                  <div key={c.id} className="area-group">
                    {areaCities.length > 1 && <h3><Link to={`/locations/${c.slug}`}>{c.name}</Link></h3>}
                    <div className="area-tiles">
                      {(areas.length ? areas : [c]).map((a) => (
                        <Link key={a.id} to={`/locations/${a.slug}`} className="area-tile">
                          <span className="area-icon"><IconPin size={20} /></span>
                          <span><strong>{a.name}</strong><small>{a.profileCount} {a.profileCount === 1 ? 'companion' : 'companions'}</small></span>
                          <IconArrow size={16} className="area-go" />
                        </Link>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </section>
      )}

      <section className="section">
        <div className="container">
          <SectionHead kicker="How it works" title="Booked in three steps" center />
          <div className="grid-3 how">
            <div className="panel"><h3>Choose</h3><p className="muted">Browse the gallery by area, category and availability. Every profile shows its rates and session lengths.</p></div>
            <div className="panel"><h3>Request</h3><p className="muted">Pick a session and an open time. Fees are shown before you confirm, and you get a reference number straight away.</p></div>
            <div className="panel"><h3>Relax</h3><p className="muted">The concierge confirms by email. Track your booking, message us, cancel or reschedule online before the cut-off.</p></div>
          </div>
        </div>
      </section>

      <section className="section" style={{ paddingTop: 0 }}>
        <div className="container">
          <div className="cta-band">
            <div>
              <span className="kicker"><IconChat size={14} /> Concierge</span>
              <h2>Not sure who to book?</h2>
              <p className="lead" style={{ margin: 0 }}>Tell us what you have in mind. We’ll suggest companions, check availability and answer any question — discreetly.</p>
            </div>
            <div className="cta-actions">
              <ChatButton className="btn btn-primary btn-lg" />
              <ContactLinks className="contact-links contact-pills" labels />
            </div>
          </div>
        </div>
      </section>

      {data?.posts?.length > 0 && (
        <section className="section section-alt">
          <div className="container">
            <SectionHead kicker="Guides" title="Guides & announcements" action={<Link to="/guides" className="btn btn-ghost">All articles <IconArrow size={16} /></Link>} />
            <div className="grid-3">
              {data.posts.map((p) => (
                <Link key={p.slug} to={`/guides/${p.slug}`} className="post-card">
                  <div className="post-cover">{p.coverUrl ? <img src={p.coverUrl} alt={p.coverAlt || ''} loading="lazy" decoding="async" /> : p.kind}</div>
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
    </>
  );
}
