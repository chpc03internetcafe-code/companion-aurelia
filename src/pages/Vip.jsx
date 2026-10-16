import { Link } from 'react-router-dom';
import { useSite } from '../context/SiteContext';
import { breadcrumbLd, useSeo } from '../utils/seo';
import { money } from '../utils/format';
import { FaqList, PageHero, SectionHead } from '../components/Common';
import { IconCheck, IconCrown, IconLock, IconShield, IconSparkle } from '../components/Icons';

const period = (days) => (days % 365 === 0 ? `${days / 365 === 1 ? 'year' : `${days / 365} years`}` : days % 30 === 0 ? `${days / 30 === 1 ? 'month' : `${days / 30} months`}` : `${days} days`);

export default function Vip() {
  const { tiers, member, faqs, site } = useSite();
  const vipFaqs = faqs.filter((f) => /member/i.test(f.groupName));
  useSeo({ title: 'VIP membership', description: 'Members-only collections, private galleries, exclusive guides and priority bookings.', jsonLd: breadcrumbLd([['Home', '/'], ['VIP', '/vip']]) });
  const popular = tiers.length > 1 ? tiers[Math.floor(tiers.length / 2)].id : null;
  return (
    <>
      <PageHero kicker={<><IconCrown size={14} /> VIP membership</>} title={`The private side of ${site.logoText}`} text="Unlock VIP-only profiles, private photo and video galleries, curated collections and members-only guides." crumbs={[['Home', '/'], ['VIP']]}>
        <div className="row" style={{ marginTop: 22 }}>
          {member ? <Link to="/account/membership" className="btn btn-primary btn-lg">{member.vipActive ? 'Manage my membership' : 'Choose a tier'}</Link>
            : <><Link to="/account?mode=register" className="btn btn-primary btn-lg">Create a free account</Link><Link to="/account" className="btn btn-ghost btn-lg">Sign in</Link></>}
        </div>
      </PageHero>
      <section className="section">
        <div className="container">
          <div className="grid-3" style={{ marginBottom: 50 }}>
            <div className="panel"><IconLock size={26} style={{ color: 'var(--primary)' }} /><h3 style={{ marginTop: 10 }}>Private galleries</h3><p className="muted">Extra photos and videos on many profiles, visible only to members.</p></div>
            <div className="panel"><IconSparkle size={26} style={{ color: 'var(--primary)' }} /><h3 style={{ marginTop: 10 }}>VIP collections</h3><p className="muted">Curated selections and VIP-only companions you won’t find in the public directory.</p></div>
            <div className="panel"><IconShield size={26} style={{ color: 'var(--primary)' }} /><h3 style={{ marginTop: 10 }}>Priority concierge</h3><p className="muted">Faster replies, saved favourites on every device and your full booking history.</p></div>
          </div>
          <SectionHead kicker="Tiers" title="Choose your membership" center text="Higher tiers include everything in the tiers below." />
          <div className="grid-3">
            {tiers.map((t) => (
              <div key={t.id} className={`tier-card ${t.id === popular ? 'featured' : ''}`}>
                {t.id === popular && <span className="badge badge-gold" style={{ position: 'absolute', top: 16, right: 16 }}>Most popular</span>}
                <div className="row"><span className="tier-dot" style={{ background: t.color || 'var(--primary)' }} /><h3 style={{ margin: 0 }}>{t.name}</h3></div>
                <div><span className="price">{money(t.price)}</span> <span className="muted">/ {period(t.durationDays)}</span></div>
                {t.description && <p className="muted" style={{ margin: 0 }}>{t.description}</p>}
                <ul>{t.perks.map((x) => <li key={x}><IconCheck size={16} />{x}</li>)}</ul>
                <Link to={member ? `/account/membership?tier=${t.id}` : '/account?mode=register&next=/account/membership'} className={`btn ${t.id === popular ? 'btn-primary' : 'btn-ghost'} btn-block`} style={{ marginTop: 'auto' }}>
                  {member?.tier?.id === t.id && member.vipActive ? 'Renew' : `Choose ${t.name}`}
                </Link>
              </div>
            ))}
          </div>
          <p className="muted center" style={{ marginTop: 22, fontSize: '0.88rem' }}>Pay by GCash, Maya or bank transfer and enter the payment reference — we activate your membership after checking it. Members must be 18 or over.</p>
        </div>
      </section>
      {vipFaqs.length > 0 && <section className="section section-alt"><div className="narrow"><SectionHead title="Membership questions" center /><FaqList faqs={vipFaqs} /></div></section>}
    </>
  );
}
