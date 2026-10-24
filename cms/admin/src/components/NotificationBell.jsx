import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { MODULE_ICONS, timeAgo, useNotifications } from '../lib/notifications';

// Top-bar bell: unread count, the latest notifications, and alert preferences.
export default function NotificationBell() {
  const { enabled, items, unread, connected, open, markAllRead, sound, setSound, permission, enableDesktop } = useNotifications();
  const [show, setShow] = useState(false);
  const [, tick] = useState(0);
  const { pathname } = useLocation();
  useEffect(() => setShow(false), [pathname]);
  useEffect(() => {
    if (!show) return undefined;
    const t = setInterval(() => tick((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, [show]);
  if (!enabled) return null;

  return (
    <div className="notif-bell">
      <button className="notif-bell-btn" onClick={() => setShow((s) => !s)} aria-haspopup="dialog" aria-expanded={show}
        aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'} title={connected ? 'Notifications' : 'Reconnecting to live notifications…'}>
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
        </svg>
        {unread > 0 && <b className="notif-count">{unread > 99 ? '99+' : unread}</b>}
        {!connected && <span className="notif-offline" aria-hidden="true" />}
      </button>
      {show && (
        <>
          <div className="scrim clear" onClick={() => setShow(false)} />
          <div className="notif-menu" role="dialog" aria-label="Notifications">
            <div className="notif-menu-head">
              <strong>Notifications</strong>
              {unread > 0 && <button className="link" onClick={markAllRead}>Mark all read</button>}
            </div>
            {!connected && <p className="notif-warn">Reconnecting… new notifications will appear once the connection is back.</p>}
            <div className="notif-list">
              {items.length ? items.map((n) => (
                <button key={n.id} className="notif-item unread" onClick={() => open(n)}>
                  <i aria-hidden="true">{MODULE_ICONS[n.module]}</i>
                  <span><strong>{n.title}</strong>{n.body && <small>{n.body}</small>}<time dateTime={n.createdAt}>{timeAgo(n.createdAt)}</time></span>
                </button>
              )) : <p className="notif-empty">You’re all caught up. New booking requests, membership requests and messages from the website show up here as they happen.</p>}
            </div>
            <div className="notif-menu-foot">
              <label className="notif-pref"><input type="checkbox" checked={sound} onChange={(e) => setSound(e.target.checked)} /> Sound</label>
              {permission === 'default' && <button className="link" onClick={enableDesktop}>Enable desktop alerts</button>}
              {permission === 'denied' && <small className="muted">Desktop alerts blocked</small>}
              <Link to="/notifications" className="link">View all →</Link>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
