import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { MODULE_ICONS, timeAgo, useNotifications } from '../lib/notifications';
import { dateTime } from '../lib/format';
import { Empty, Loading, PageHead } from '../components/kit';

const MODULE_LABELS = { bookings: 'Bookings', profiles: 'Profiles', members: 'Members', inquiries: 'Messages' };

export default function Notifications() {
  const { open, markAllRead, syncUnread, enabled } = useNotifications();
  const [filter, setFilter] = useState({ unread: true, module: '' });
  const [state, setState] = useState({ items: [], hasMore: false, loading: true });

  const load = async (before) => {
    const r = await api.get('/notifications', { unread: filter.unread ? 1 : '', module: filter.module, before, limit: 30 });
    syncUnread(r.unread);
    setState((s) => ({ items: before ? [...s.items, ...r.items] : r.items, hasMore: r.hasMore, loading: false }));
  };
  useEffect(() => { setState((s) => ({ ...s, loading: true })); load(); }, [filter]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const on = () => load();
    window.addEventListener('cms:notification', on);
    window.addEventListener('cms:notifications-read', on);
    return () => { window.removeEventListener('cms:notification', on); window.removeEventListener('cms:notifications-read', on); };
  }, [filter]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!enabled) return <Empty title="No notifications for your role" text="Notifications cover bookings, members and contact messages." />;
  return (
    <>
      <PageHead title="Notifications" subtitle="Activity from the website: booking requests, cancellations, reschedules, membership requests, messages and new members. Kept for 90 days."
        actions={<button className="btn btn-ghost" onClick={markAllRead}>Mark all read</button>} />
      <div className="card">
        <div className="filters">
          <div className="seg">
            <button className={!filter.module ? 'on' : ''} onClick={() => setFilter({ ...filter, module: '' })}>All</button>
            {Object.entries(MODULE_LABELS).map(([k, l]) => <button key={k} className={filter.module === k ? 'on' : ''} onClick={() => setFilter({ ...filter, module: k })}>{l}</button>)}
          </div>
          <label className="check"><input type="checkbox" checked={filter.unread} onChange={(e) => setFilter({ ...filter, unread: e.target.checked })} /> Unread only</label>
        </div>
        {state.loading ? <Loading /> : state.items.length ? (
          <div>
            {state.items.map((n) => (
              <button key={n.id} className={`notif-item ${n.isRead ? '' : 'unread'}`} onClick={() => {
                if (filter.unread) setState((s) => ({ ...s, items: s.items.filter((x) => x.id !== n.id) }));
                open(n);
              }}>
                <i aria-hidden="true">{MODULE_ICONS[n.module]}</i>
                <span><strong>{n.title}</strong>{n.body && <small>{n.body}</small>}<time dateTime={n.createdAt} title={dateTime(n.createdAt)}>{timeAgo(n.createdAt)}</time></span>
              </button>
            ))}
            {state.hasMore && <div className="card-body"><button className="btn btn-ghost btn-sm" onClick={() => load(state.items.at(-1).id)}>Load more</button></div>}
          </div>
        ) : <Empty icon="🔔" title="You’re all caught up" />}
      </div>
    </>
  );
}
