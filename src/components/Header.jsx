import { useEffect, useState } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { useSite } from '../context/SiteContext';
import { boldHtml } from '../utils/format';
import { IconClose, IconCrown, IconHeart, IconMenu, IconUser } from './Icons';

function Announcements({ items }) {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (items.length < 2) return undefined;
    const t = setInterval(() => setI((n) => (n + 1) % items.length), 5000);
    return () => clearInterval(t);
  }, [items.length]);
  if (!items.length) return null;
  return (
    <div className="announce">
      <div className="container announce-inner">
        <span key={i} className="announce-msg" dangerouslySetInnerHTML={{ __html: boldHtml(items[i % items.length]) }} />
      </div>
    </div>
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

export default function Header() {
  const { site, categories, member, favorites } = useSite();
  const [open, setOpen] = useState(false);
  const { pathname } = useLocation();
  useEffect(() => setOpen(false), [pathname]);
  // the companion portal (/companion…, not /companions) is for the person behind a profile: no client shortcuts there
  const portal = /^\/companion(\/|$)/.test(pathname);
  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [open]);
  const nav = [
    ['/companions', 'All companions'],
    ...categories.map((c) => [`/${c.slug}`, c.name]),
    ['/locations', 'Locations'],
    ['/vip', 'VIP'],
    ['/guides', 'Guides'],
  ];

  return (
    <>
      <Announcements items={[site.announcement1, site.announcement2, site.announcement3].filter(Boolean)} />
      <header className="header">
        <div className="container header-inner">
          <Logo />
          <nav className="nav" aria-label="Main">
            {nav.map(([to, label]) => <NavLink key={to} to={to}>{label}</NavLink>)}
          </nav>
          <div className="header-actions">
            {!portal && <>
              <Link to="/favorites" className="icon-link" aria-label={`Favourites (${favorites.length})`} title="Favourites">
                <IconHeart size={18} />{favorites.length > 0 && <span className="count">{favorites.length}</span>}
              </Link>
              <Link to="/account" className="icon-link" aria-label={member ? 'My account' : 'Sign in'} title={member ? `${member.firstName}’s account` : 'Member sign-in'}>
                {member?.vipActive ? <IconCrown size={18} /> : <IconUser size={18} />}{member && <span className="dot" aria-hidden="true" />}
              </Link>
              <Link to="/companions?available=today" className="btn btn-primary btn-sm header-book">Available today</Link>
            </>}
            <button className="menu-toggle" onClick={() => setOpen(true)} aria-label="Open menu"><IconMenu size={26} /></button>
          </div>
        </div>
      </header>
      {open && (
        <div className="drawer-backdrop" onClick={() => setOpen(false)}>
          <aside className="drawer" onClick={(e) => e.stopPropagation()} aria-label="Menu">
            <div className="drawer-head">
              <Logo />
              <button onClick={() => setOpen(false)} aria-label="Close menu"><IconClose size={26} /></button>
            </div>
            <nav>
              <NavLink to="/" end>Home</NavLink>
              {nav.map(([to, label]) => <NavLink key={to} to={to}>{label}</NavLink>)}
              {portal ? <NavLink to="/companion">Companion portal</NavLink> : <>
                <NavLink to="/favorites">Favourites ({favorites.length})</NavLink>
                <NavLink to="/booking-status">Check my booking</NavLink>
              </>}
              <NavLink to="/faq">FAQ</NavLink>
              <NavLink to="/contact">Contact</NavLink>
              {!portal && <NavLink to="/account">{member ? 'My account' : 'Member sign-in'}</NavLink>}
            </nav>
            {!portal && <Link to="/companions?available=today" className="btn btn-primary btn-block">Available today</Link>}
          </aside>
        </div>
      )}
    </>
  );
}
