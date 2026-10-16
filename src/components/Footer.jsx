import { Link } from 'react-router-dom';
import { useSite } from '../context/SiteContext';
import { Logo } from './Header';
import { IconChat, IconInstagram, IconMail, IconPhone, IconSend } from './Icons';

export default function Footer() {
  const { site, categories, cities, pages } = useSite();
  const year = new Date().getFullYear();
  return (
    <footer className="footer">
      <div className="container">
        <div className="footer-grid">
          <div>
            <Logo />
            <p style={{ marginTop: 16, maxWidth: 360 }}>{site.about}</p>
            <div className="social">
              {site.instagramUrl && <a className="icon-btn" href={site.instagramUrl} target="_blank" rel="noreferrer noopener" aria-label="Instagram"><IconInstagram size={18} /></a>}
              {site.telegramUrl && <a className="icon-btn" href={site.telegramUrl} target="_blank" rel="noreferrer noopener" aria-label="Telegram"><IconSend size={18} /></a>}
              {site.whatsappUrl && <a className="icon-btn" href={site.whatsappUrl} target="_blank" rel="noreferrer noopener" aria-label="WhatsApp"><IconChat size={18} /></a>}
              {site.email && <a className="icon-btn" href={`mailto:${site.email}`} aria-label="Email"><IconMail size={18} /></a>}
              {site.phone && <a className="icon-btn" href={`tel:${site.phone.replace(/[^\d+]/g, '')}`} aria-label="Call"><IconPhone size={18} /></a>}
            </div>
            {site.hours && <p className="muted" style={{ marginTop: 14, fontSize: '0.84rem' }}>{site.hours}</p>}
          </div>
          <div>
            <h4>Companions</h4>
            <ul>
              <li><Link to="/companions">All companions</Link></li>
              {categories.map((c) => <li key={c.id}><Link to={`/${c.slug}`}>{c.name}</Link></li>)}
              <li><Link to="/companions?available=today">Available today</Link></li>
              <li><Link to="/companions?verified=1">Verified profiles</Link></li>
            </ul>
          </div>
          <div>
            <h4>Locations</h4>
            <ul>
              {cities.slice(0, 7).map((l) => <li key={l.id}><Link to={`/locations/${l.slug}`}>{l.name}</Link></li>)}
              <li><Link to="/locations">All locations</Link></li>
            </ul>
          </div>
          <div>
            <h4>Clients</h4>
            <ul>
              <li><Link to="/booking-status">Check or change a booking</Link></li>
              <li><Link to="/vip">VIP membership</Link></li>
              <li><Link to="/account">Member sign-in</Link></li>
              <li><Link to="/companion">Companion portal</Link></li>
              <li><Link to="/guides">Guides & news</Link></li>
              <li><Link to="/faq">FAQ</Link></li>
              <li><Link to="/contact">Contact</Link></li>
              {pages.filter((p) => p.showInFooter).map((p) => <li key={p.slug}><Link to={`/pages/${p.slug}`}>{p.title}</Link></li>)}
            </ul>
          </div>
        </div>
        <div className="footer-bottom">
          <span className="row"><span className="adult-badge" title="Adults only">18+</span>© {year} {site.siteName}. Adults only. All companions listed are verified to be 18 or over.</span>
          <span>Rates are for time and companionship only.</span>
        </div>
      </div>
    </footer>
  );
}
