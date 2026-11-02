import { useEffect, useState } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { useSite } from '../context/SiteContext';
import { boldHtml } from '../utils/format';
import { openChat } from '../utils/chat';
import { useScheme } from '../utils/theme';
import { IconCalendar, IconChat, IconClock, IconClose, IconGrid, IconHeart, IconHome, IconMenu, IconMoon, IconPhone, IconSend, IconSun, IconWhatsapp } from './Icons';

// Rotating announcements, shown in the middle of the contact bar.
function Announcements({ items }) {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (items.length < 2) return undefined;
    const t = setInterval(() => setI((n) => (n + 1) % items.length), 5000);
    return () => clearInterval(t);
  }, [items.length]);
  if (!items.length) return null;
  return <span key={i} className="announce-msg" dangerouslySetInnerHTML={{ __html: boldHtml(items[i % items.length]) }} />;
}

/** Telegram / WhatsApp / phone links from Site Settings; nothing for the ones left empty. */
export function ContactLinks({ className = 'contact-links', labels }) {
  const { site } = useSite();
  const links = [
    site.telegramUrl && { href: site.telegramUrl, label: 'Telegram', icon: IconSend, external: true },
    site.whatsappUrl && { href: site.whatsappUrl, label: 'WhatsApp', icon: IconWhatsapp, external: true },
    site.phone && { href: `tel:${site.phone.replace(/[^\d+]/g, '')}`, label: site.phone, icon: IconPhone },
  ].filter(Boolean);
  if (!links.length) return null;
  return (
    <span className={className}>
      {links.map(({ href, label, icon: Icon, external }) => (
        <a key={href} href={href} {...(external ? { target: '_blank', rel: 'noreferrer noopener' } : {})} aria-label={labels ? undefined : label} title={label}>
          <Icon size={15} />{labels && <span>{label}</span>}
        </a>
      ))}
    </span>
  );
}

/** "Chat now": opens the live chat, or goes to the contact page when the chat is switched off.
 *  context: { profileId, name } when the chat is about a profile. */
export function ChatButton({ className = 'btn btn-primary btn-sm', children = 'Chat now', context = null }) {
  const { site } = useSite();
  if (site.liveChatEnabled !== '1') return <Link to="/contact" className={className}><IconChat size={16} />Contact us</Link>;
  return <button type="button" className={className} onClick={() => openChat(context)}><IconChat size={16} />{children}</button>;
}

/** Sun / moon button, when the CMS lets visitors switch between light and dark. */
function SchemeSwitch({ className = 'icon-link' }) {
  const { scheme, canSwitch, toggle } = useScheme();
  if (!canSwitch) return null;
  const next = scheme === 'light' ? 'dark' : 'light';
  return (
    <button type="button" className={className} onClick={toggle} aria-label={`Switch to ${next} mode`} title={`Switch to ${next} mode`}>
      {scheme === 'light' ? <IconMoon size={18} /> : <IconSun size={18} />}
    </button>
  );
}

export function Logo({ light }) {
  const { site } = useSite();
  return (
    <Link to="/" className={`logo ${light ? 'logo-light' : ''}`} aria-label={`${site.siteName} home`}>
      <span className="logo-mark" aria-hidden="true">{(site.logoText || 'A')[0]}</span>
      <span><strong>{site.logoText}</strong><small>{site.logoSubtext}</small></span>
    </Link>
  );
}

// Phones: an app-style bar at the bottom of the screen with the things visitors use most.
function MobileBar() {
  const { site, favorites } = useSite();
  const chat = site.liveChatEnabled === '1';
  return (
    <nav className="mobile-bar" aria-label="Quick links">
      <NavLink to="/" end><IconHome size={21} /><span>Home</span></NavLink>
      <NavLink to="/companions"><IconGrid size={21} /><span>Gallery</span></NavLink>
      <NavLink to="/favorites" className="mb-fav"><IconHeart size={21} /><span>Saved</span>{favorites.length > 0 && <b>{favorites.length}</b>}</NavLink>
      <NavLink to="/booking-status"><IconCalendar size={21} /><span>Booking</span></NavLink>
      {chat
        ? <button type="button" onClick={openChat}><IconChat size={21} /><span>Chat</span></button>
        : <NavLink to="/contact"><IconChat size={21} /><span>Contact</span></NavLink>}
    </nav>
  );
}

export default function Header() {
  const { site, categories, favorites } = useSite();
  const [open, setOpen] = useState(false);
  const { pathname } = useLocation();
  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [open]);
  const nav = [
    ['/', 'Home', true],
    ['/companions', 'Gallery'],
    ['/locations', 'Locations'],
    ['/guides', 'Guides'],
    ['/faq', 'FAQ'],
    ['/contact', 'Contact'],
  ];

  return (
    <>
      <div className="topbar">
        <div className="container topbar-inner">
          {site.hours && <span className="topbar-hours"><IconClock size={14} />{site.hours}</span>}
          <span className="topbar-announce"><Announcements items={[site.announcement1, site.announcement2, site.announcement3].filter(Boolean)} /></span>
          <ContactLinks className="contact-links topbar-contact" labels />
        </div>
      </div>
      <header className="header">
        <div className="container header-inner">
          <Logo />
          <nav className="nav" aria-label="Main">
            {nav.map(([to, label, end]) => <NavLink key={to} to={to} end={end}>{label}</NavLink>)}
          </nav>
          <div className="header-actions">
            <SchemeSwitch />
            <Link to="/favorites" className="icon-link" aria-label={`Favourites (${favorites.length})`} title="Favourites">
              <IconHeart size={18} />{favorites.length > 0 && <span className="count">{favorites.length}</span>}
            </Link>
            <Link to="/booking-status" className="icon-link hide-sm" aria-label="Check my booking" title="Check my booking"><IconCalendar size={18} /></Link>
            <ChatButton className="btn btn-primary btn-sm header-book" />
            <button className="menu-toggle" onClick={() => setOpen(true)} aria-label="Open menu"><IconMenu size={26} /></button>
          </div>
        </div>
      </header>
      <MobileBar />
      {open && (
        <div className="drawer-backdrop" onClick={() => setOpen(false)}>
          <aside className="drawer" onClick={(e) => e.stopPropagation()} aria-label="Menu">
            <div className="drawer-head">
              <Logo />
              <button onClick={() => setOpen(false)} aria-label="Close menu"><IconClose size={26} /></button>
            </div>
            <nav>
              {nav.map(([to, label, end]) => <NavLink key={to} to={to} end={end}>{label}</NavLink>)}
              <NavLink to="/booking-status">Check my booking</NavLink>
            </nav>
            {categories.length > 0 && (
              <div>
                <p className="drawer-label">Browse</p>
                <div className="chip-row">
                  <Link to="/companions?available=today" className="chip">Available today</Link>
                  {categories.map((c) => <Link key={c.id} to={`/${c.slug}`} className="chip">{c.name}</Link>)}
                </div>
              </div>
            )}
            <div className="drawer-foot">
              <ChatButton className="btn btn-primary btn-block" />
              <ContactLinks className="contact-links drawer-contact" labels />
              {site.hours && <p className="muted" style={{ margin: 0, fontSize: '0.84rem' }}>{site.hours}</p>}
            </div>
          </aside>
        </div>
      )}
    </>
  );
}
