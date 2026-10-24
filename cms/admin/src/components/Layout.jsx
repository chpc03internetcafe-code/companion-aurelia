import { Suspense, useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { api } from '../lib/api';
import { useUi } from '../lib/ui';
import { moduleForPath, useAuth } from '../lib/auth';
import { NOTIFY_MODULES, useNotifications } from '../lib/notifications';
import { Avatar, Loading, Modal } from './kit';
import NotificationBell from './NotificationBell';
import { IdleWarning, useIdleTimeout } from '../lib/idle';
import { ChangePasswordForm } from '../pages/Login';

const NAV = [
  ['Agency', [
    { to: '/', label: 'Dashboard', icon: '◫', always: true, end: true },
    { module: 'bookings', to: '/bookings', label: 'Bookings', icon: '📅', badge: 'bookings' },
    { module: 'profiles', to: '/profiles', label: 'Profiles', icon: '✦' },
    { module: 'inquiries', to: '/live-chat', label: 'Live chat', icon: '💬', badge: 'chat' },
    { module: 'inquiries', to: '/inquiries', label: 'Messages', icon: '✉', badge: 'inquiries' },
  ]],
  ['Website', [
    { module: 'locations', to: '/locations', label: 'Locations & Categories', icon: '⌖' },
    { module: 'content', to: '/content', label: 'Content & FAQs', icon: '📝' },
    { module: 'seo', to: '/seo', label: 'SEO & Redirects', icon: '⤳' },
    { module: 'settings', to: '/settings', label: 'Site Settings', icon: '⚙' },
  ]],
  ['Team', [
    { module: 'users', to: '/users', label: 'Users', icon: '👥' },
    { module: 'users', to: '/roles', label: 'Roles', icon: '🔑' },
    { module: 'audit', to: '/audit', label: 'Audit Trail', icon: '☰' },
  ]],
];

export default function Layout() {
  const { metaError, loadMeta, meta, toast } = useUi();
  const { user, can, logout, idleLogout } = useAuth();
  const idleLeft = useIdleTimeout(meta?.site?.idleMinutes, idleLogout);
  const { unread } = useNotifications();
  const [open, setOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [changingPw, setChangingPw] = useState(false);
  const [badges, setBadges] = useState({});
  const [liveTick, setLiveTick] = useState(0);
  const { pathname } = useLocation();
  const site = meta?.site || {};
  const nav = NAV.map(([group, items]) => [group, items.filter((m) => m.always || can(m.module))]).filter(([, items]) => items.length);

  useEffect(() => {
    if (site.siteName) document.title = `${unread ? `(${unread}) ` : ''}${site.siteName} · CMS`;
  }, [site.siteName, unread]);
  useEffect(() => {
    const on = (e) => { if (e.detail.modules.some((m) => NOTIFY_MODULES.includes(m))) setLiveTick((n) => n + 1); };
    window.addEventListener('cms:notification', on);
    return () => window.removeEventListener('cms:notification', on);
  }, []);

  // Work-queue badges: booking requests to confirm, new messages, live chats waiting.
  useEffect(() => {
    const none = Promise.resolve(null);
    Promise.all([
      can('bookings') ? api.get('/bookings/stats') : none,
      can('inquiries') ? api.get('/inquiries/stats') : none,
      can('inquiries') ? api.get('/live-chat/stats') : none,
    ]).then(([b, q, lc]) => setBadges({
      bookings: (b?.pending || 0) + (b?.inquiries || 0), inquiries: q?.new || 0, chat: lc?.waiting || 0,
    })).catch(() => {});
  }, [pathname, can, liveTick]);
  useEffect(() => { setMenuOpen(false); setOpen(false); }, [pathname]);

  const module = moduleForPath(pathname);
  const viewOnly = module && module !== 'audit' && can(module, 'view') && !can(module, 'manage');

  return (
    <div className="shell">
      <aside className={`sidebar ${open ? 'open' : ''}`}>
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">{(site.logoText || 'A')[0]}</span>
          <div><strong>{site.logoText || 'Aurelia'}</strong><small>Agency CMS</small></div>
        </div>
        <nav>
          {nav.map(([group, items]) => (
            <div key={group} className="nav-group">
              <span className="nav-label">{group}</span>
              {items.map((m) => (
                <NavLink key={m.to} to={m.to} end={m.end} className="nav-item">
                  <i aria-hidden="true">{m.icon}</i>{m.label}
                  {m.badge && badges[m.badge] > 0 && <b className="nav-badge" title="Needs attention">{badges[m.badge]}</b>}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
        <div className="sidebar-foot">
          <a href={import.meta.env.VITE_WEBSITE_URL || meta?.websiteUrl || 'http://localhost:5173'} target="_blank" rel="noreferrer">View website ↗</a>
        </div>
      </aside>
      {open && <div className="scrim" onClick={() => setOpen(false)} />}

      <div className="main">
        <header className="topbar">
          <button className="menu-btn" onClick={() => setOpen(true)} aria-label="Open menu">☰</button>
          <span className="topbar-title">{site.siteName || 'CMS'}</span>
          <NotificationBell />
          <div className="user-menu">
            <button className="user-menu-btn" onClick={() => setMenuOpen((o) => !o)} aria-haspopup="menu" aria-expanded={menuOpen}>
              <Avatar name={user.name} size={32} />
              <span className="who hide-sm"><span>{user.name}</span><small>{user.role}</small></span>
            </button>
            {menuOpen && (
              <>
                <div className="scrim clear" onClick={() => setMenuOpen(false)} />
                <div className="user-menu-pop" role="menu">
                  <div className="head"><strong>{user.name}</strong><small>{user.email} · {user.role}</small></div>
                  <button role="menuitem" onClick={() => { setMenuOpen(false); setChangingPw(true); }}>Change password</button>
                  <button role="menuitem" onClick={logout}>Sign out</button>
                </div>
              </>
            )}
          </div>
        </header>
        <main className="content">
          {metaError && (
            <div className="banner-error"><strong>Can’t connect to the API.</strong> {metaError}<button className="btn btn-sm btn-ghost" onClick={loadMeta}>Retry</button></div>
          )}
          {viewOnly && <div className="view-only">👁 View only — your role ({user.role}) can see this section but not change it.</div>}
          {meta ? <Suspense fallback={<div className="card"><Loading /></div>}><Outlet /></Suspense> : !metaError && <div className="card"><Loading /></div>}
        </main>
      </div>
      <IdleWarning seconds={idleLeft} onSignOut={logout} />
      {changingPw && (
        <Modal title="Change password" onClose={() => setChangingPw(false)} size="narrow">
          <ChangePasswordForm onDone={() => { setChangingPw(false); toast('Password changed. Other devices were signed out.'); }} />
        </Modal>
      )}
    </div>
  );
}
