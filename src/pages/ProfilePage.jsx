import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useSite } from '../context/SiteContext';
import { api } from '../utils/api';
import { breadcrumbLd, useSeo } from '../utils/seo';
import { day, duration, money, time12, timeAgo, todayIso, weekday, WEEKDAYS } from '../utils/format';
import ProfileCard, { FavoriteButton, ShareButton } from '../components/ProfileCard';
import { Crumbs, PageSkeleton, Photo, SectionHead } from '../components/Common';
import { IconBack, IconCalendar, IconCheck, IconChevron, IconClock, IconCrown, IconGlobe, IconLock, IconPin, IconPlay, IconShield } from '../components/Icons';
import NotFound from './NotFound';

const embed = (url) => {
  const yt = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]{6,})/);
  if (yt) return `https://www.youtube-nocookie.com/embed/${yt[1]}`;
  const vm = url.match(/vimeo\.com\/(?:video\/)?(\d+)/);
  if (vm) return `https://player.vimeo.com/video/${vm[1]}`;
  return null;
};

function Gallery({ p }) {
  const [i, setI] = useState(0);
  const items = p.media;
  const locked = p.lockedMedia.photos + p.lockedMedia.videos;
  const cur = items[i];
  const go = (d) => setI((n) => (n + d + items.length) % items.length);
  useEffect(() => {
    const on = (e) => { if (e.key === 'ArrowRight') go(1); if (e.key === 'ArrowLeft') go(-1); };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div>
      <div className="gallery-main">
        {!cur ? <Photo name={p.name} /> : cur.kind === 'video'
          ? (embed(cur.url)
            ? <iframe src={embed(cur.url)} title={cur.alt || `${p.name} video`} allow="encrypted-media; picture-in-picture" allowFullScreen />
            : <video src={cur.url} poster={cur.posterUrl || undefined} controls playsInline preload="metadata" aria-label={cur.alt || `${p.name} video`} />)
          : <Photo src={cur.url} alt={cur.alt || `${p.name}`} name={p.name} priority={i === 0} />}
        {items.length > 1 && <>
          <button className="icon-btn gallery-nav prev" onClick={() => go(-1)} aria-label="Previous photo"><IconBack size={18} /></button>
          <button className="icon-btn gallery-nav next" onClick={() => go(1)} aria-label="Next photo"><IconChevron size={18} /></button>
        </>}
        {items.length > 0 && <span className="badge gallery-count">{i + 1} / {items.length}</span>}
        {cur?.vipOnly && <span className="badge badge-vip" style={{ position: 'absolute', top: 12, left: 12 }}><IconCrown size={12} />Members only</span>}
      </div>
      {(items.length > 1 || locked > 0) && (
        <div className="thumbs" role="list">
          {items.map((m, k) => (
            <button key={m.id} className={k === i ? 'on' : ''} onClick={() => setI(k)} aria-label={`${m.kind === 'video' ? 'Video' : 'Photo'} ${k + 1}`} role="listitem">
              {m.kind === 'video' ? <><Photo src={m.posterUrl} name="▶" /><span className="vid"><IconPlay size={22} /></span></> : <img src={m.url} alt="" loading="lazy" decoding="async" />}
            </button>
          ))}
          {locked > 0 && <Link to="/vip" className="thumbs-locked" style={{ flex: 'none', width: 76, aspectRatio: '4 / 5', borderRadius: 12, border: '1px dashed var(--primary)', display: 'grid', placeItems: 'center', textAlign: 'center', fontSize: '0.72rem', fontWeight: 800, color: 'var(--primary)', padding: 4 }}>
            <span><IconLock size={18} /><br />+{locked} VIP</span>
          </Link>}
        </div>
      )}
    </div>
  );
}

function Week({ schedule, timeOff }) {
  const today = todayIso();
  const tw = weekday(today);
  return (
    <>
      <div className="week">
        {[1, 2, 3, 4, 5, 6, 0].map((d) => {
          const blocks = schedule.filter((s) => s.weekday === d);
          return (
            <div key={d} className={`${blocks.length ? '' : 'off'} ${d === tw ? 'today' : ''}`}>
              <b>{WEEKDAYS[d]}</b>
              {blocks.length ? blocks.map((b) => <span key={b.start} style={{ display: 'block' }}>{time12(b.start).replace(':00', '')}–{time12(b.end).replace(':00', '')}</span>) : 'Off'}
            </div>
          );
        })}
      </div>
      {timeOff.length > 0 && <p className="muted" style={{ marginTop: 10, fontSize: '0.88rem' }}>Not available: {timeOff.map((t) => (t.startDate === t.endDate ? day(t.startDate) : `${day(t.startDate)} – ${day(t.endDate)}`)).join(' · ')}</p>}
    </>
  );
}

export default function ProfilePage() {
  const { slug } = useParams();
  const { member, site } = useSite();
  const navigate = useNavigate();
  const [state, setState] = useState({ loading: true });
  useEffect(() => {
    setState({ loading: true });
    api('GET', `/site/profiles/${slug}`)
      .then((p) => setState({ p }))
      .catch((e) => {
        if (e.status === 410 && e.data.redirect) return navigate(e.data.redirect, { replace: true });
        setState({ error: e.status, info: e.data });
      });
  }, [slug, member?.tierRank, navigate]);
  const p = state.p;
  const cityName = p?.location ? (p.location.parent ? `${p.location.name}, ${p.location.parent}` : p.location.name) : '';
  useSeo(p ? {
    title: p.seoTitle || `${p.name}, ${p.age} — ${p.category.name} companion${cityName ? ` in ${cityName}` : ''}`,
    exactTitle: p.seoTitle ? `${p.seoTitle}${site.seoTitleSuffix || ''}` : undefined,
    description: p.metaDescription || `${p.tagline}. Verified ${p.category.name.toLowerCase()} companion${cityName ? ` in ${cityName}` : ''} with published rates and live availability.`,
    image: p.photoUrl, type: 'profile',
    jsonLd: [
      { '@type': 'ProfilePage', dateModified: p.updatedAt, mainEntity: { '@type': 'Person', name: p.name, description: p.tagline, image: p.photoUrl ? new URL(p.photoUrl, window.location.origin).href : undefined, knowsLanguage: p.languages || undefined } },
      breadcrumbLd([['Home', '/'], [p.category.name, `/${p.category.slug}`], [p.name, `/companions/${p.slug}`]]),
    ],
  } : { title: state.info?.name || 'Profile', noindex: true });

  if (state.loading) return <PageSkeleton media />;
  if (state.error === 404) return <NotFound />;
  if (state.error === 410) {
    return (
      <section className="section"><div className="narrow center">
        <span className="kicker">No longer available</span>
        <h1>{state.info.name} is no longer listed</h1>
        <p className="lead" style={{ margin: '0 auto 30px' }}>This profile has been retired. Here are some similar companions you may like.</p>
        <div className="grid-cards" style={{ textAlign: 'left' }}>{(state.info.similar || []).map((x) => <ProfileCard key={x.id} p={x} />)}</div>
        <p style={{ marginTop: 30 }}><Link to="/companions" className="btn btn-primary">Browse all companions</Link></p>
      </div></section>
    );
  }
  if (state.error === 403) {
    return (
      <section className="section"><div className="narrow center">
        <IconCrown size={42} style={{ color: 'var(--primary)' }} />
        <h1>{state.info.name} is a VIP profile</h1>
        <p className="lead" style={{ margin: '0 auto 24px' }}>This profile is visible to {state.info.vipTierName || 'VIP'} members{member ? ' — upgrade your membership to view it.' : '. Sign in or join to view it.'}</p>
        <div className="row" style={{ justifyContent: 'center' }}>
          <Link to={member ? '/account/membership' : '/vip'} className="btn btn-primary btn-lg">{member ? 'Upgrade membership' : 'See VIP membership'}</Link>
          {!member && <Link to="/account" className="btn btn-ghost btn-lg">Sign in</Link>}
        </div>
      </div></section>
    );
  }
  if (state.error) return <section className="section"><div className="narrow"><div className="notice error">This profile couldn’t be loaded. Please try again.</div></div></section>;

  const facts = [
    ['Age', p.age], ['Category', p.category.name], ['Based in', cityName], ['Languages', p.languages], ['Nationality', p.nationality], ['Height', p.heightCm ? `${p.heightCm} cm` : null],
    ...p.attributes.filter((a) => a.label.toLowerCase() !== 'height').map((a) => [a.label, a.value]),
  ].filter(([, v]) => v);
  const away = p.awayUntil && p.awayUntil >= todayIso();
  const canBook = p.bookingEnabled && p.rates.length > 0 && p.schedule.length > 0;

  return (
    <>
      <div className="container" style={{ paddingTop: 22 }}>
        <Crumbs items={[['Home', '/'], [p.category.name, `/${p.category.slug}`], ...(p.location ? [[p.location.name, `/locations/${p.location.slug}`]] : []), [p.name]]} />
      </div>
      <div className="container profile-top">
        <Gallery p={p} />
        <div className="sticky-cta">
          <div className="profile-head">
            <div className="row" style={{ marginBottom: 10 }}>
              {p.vip && <span className="vip-chip"><IconCrown size={13} />{p.vipTierName} profile</span>}
              {p.verified && <span className="vip-chip" style={{ color: 'var(--ok)', borderColor: 'rgba(76,195,138,.4)', background: 'rgba(76,195,138,.08)' }}><IconShield size={13} />Verified</span>}
              {p.featured && <span className="vip-chip">Featured</span>}
              <span className="spacer" />
              <FavoriteButton profile={p} />
              <ShareButton title={`${p.name} — ${site.siteName}`} text={p.tagline} path={`/companions/${p.slug}`} />
            </div>
            <h1>{p.name} <small>{p.age}</small></h1>
            {p.tagline && <p className="profile-tagline">{p.tagline}</p>}
            <div className="meta-line">
              {cityName && <span><IconPin size={16} />{cityName}</span>}
              {p.languages && <span><IconGlobe size={16} />{p.languages}</span>}
              <span className={`avail ${p.availableToday ? '' : 'off'}`}>{p.availableToday ? 'Available today' : 'Not available today'}</span>
            </div>
            <p className="muted" style={{ fontSize: '0.84rem', marginTop: -6 }}>
              <IconClock size={14} style={{ verticalAlign: '-2px' }} /> Last updated {timeAgo(p.updatedAt)}{p.verifiedAt ? ` · verified ${day(p.verifiedAt)}` : ''}
            </p>
          </div>
          {away && <div className="notice" style={{ margin: '14px 0' }}>{p.awayNote || 'Away'} — back after {day(p.awayUntil)}.</div>}
          <div className="cta-box" style={{ marginTop: 16 }}>
            <h3 style={{ marginBottom: 12 }}>Rates</h3>
            {p.rates.length ? (
              <div className="rate-list">
                {p.rates.map((r) => (
                  <button key={r.id} className="rate" onClick={() => navigate(`/book/${p.slug}?rate=${r.id}`)} disabled={!canBook} aria-label={`Book ${r.label}, ${duration(r.durationMinutes)}, ${money(r.price)}`}>
                    <span><strong>{r.label}</strong><small>{duration(r.durationMinutes)}{r.notes ? ` · ${r.notes}` : ''}</small></span>
                    <span className="price">{money(r.price)}</span>
                  </button>
                ))}
              </div>
            ) : <p className="muted">Rates on request — send an inquiry.</p>}
            <p className="muted" style={{ fontSize: '0.8rem', margin: '10px 0 14px' }}>Applicable fees are shown before you confirm. Rates are for time and companionship only.</p>
            <div className="row">
              {canBook && <Link to={`/book/${p.slug}`} className="btn btn-primary btn-lg" style={{ flex: 1 }}><IconCalendar size={18} />Request a booking</Link>}
              <Link to={`/book/${p.slug}?kind=inquiry`} className="btn btn-ghost btn-lg" style={{ flex: canBook ? 'none' : 1 }}>Send an inquiry</Link>
            </div>
          </div>
          {(p.lockedMedia.photos > 0 || p.lockedMedia.videos > 0) && (
            <div className="locked-box" style={{ marginTop: 16 }}>
              <IconLock size={26} style={{ color: 'var(--primary)', flex: 'none' }} />
              <div style={{ flex: 1 }}><strong>Private gallery</strong><div className="muted" style={{ fontSize: '0.88rem' }}>{p.lockedMedia.photos} photo(s){p.lockedMedia.videos ? ` and ${p.lockedMedia.videos} video(s)` : ''} for VIP members.</div></div>
              <Link to={member ? '/account/membership' : '/vip'} className="btn btn-soft btn-sm">{member ? 'Upgrade' : 'Join VIP'}</Link>
            </div>
          )}
        </div>
      </div>

      <section className="section section-alt" style={{ paddingTop: 50 }}>
        <div className="container grid-2" style={{ alignItems: 'start' }}>
          <div>
            <h2>About {p.name}</h2>
            {(p.bio || '').split(/\n{2,}/).map((para, k) => <p key={k} className="prose" style={{ whiteSpace: 'pre-line' }}>{para}</p>)}
            {p.areas.length > 0 && (
              <>
                <h3 style={{ marginTop: 28 }}>Service areas</h3>
                <div className="chip-row">{p.areas.map((a) => <Link key={a.id} to={`/locations/${a.slug}`} className="chip">{a.parentName ? `${a.name}, ${a.parentName}` : a.name}</Link>)}</div>
              </>
            )}
          </div>
          <div className="stack">
            <dl className="facts">{facts.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
            <div className="panel">
              <h3><IconCalendar size={20} style={{ verticalAlign: '-3px', color: 'var(--primary)' }} /> Weekly availability</h3>
              {p.schedule.length ? <Week schedule={p.schedule} timeOff={p.timeOff} /> : <p className="muted">Availability on request.</p>}
              {canBook && <Link to={`/book/${p.slug}`} className="btn btn-soft btn-sm" style={{ marginTop: 14 }}>See open times →</Link>}
            </div>
            <p className="muted row" style={{ fontSize: '0.86rem' }}><IconCheck size={16} style={{ color: 'var(--primary)' }} />Adult (18+) — government ID checked by our team before publishing.</p>
          </div>
        </div>
      </section>

      {p.similar?.length > 0 && (
        <section className="section">
          <div className="container">
            <SectionHead kicker="You may also like" title="Similar companions" action={<Link to={`/${p.category.slug}`} className="btn btn-ghost">More {p.category.name.toLowerCase()} companions</Link>} />
            <div className="grid-cards four">{p.similar.map((x) => <ProfileCard key={x.id} p={x} />)}</div>
          </div>
        </section>
      )}
    </>
  );
}
