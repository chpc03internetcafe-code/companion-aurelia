// Notifications for the signed-in staff member (bell menu and Notifications page in the CMS).
import { Router } from 'express';
import { wrap } from '../lib/http.js';
import { bus, latestId, listNotifications, markRead, unreadCount } from '../lib/notifications.js';

const router = Router();
const WAIT_MS = 20_000; // under Vercel's 30 s function limit
const CHECK_MS = 2_000; // how often a waiting request checks the database

const int = (v) => (Number.isInteger(Number(v)) && Number(v) > 0 ? Number(v) : undefined);

// ?unread=1 &module=appointments &before=<id> &limit=30
router.get('/', wrap(async (req, res) => {
  const limit = int(req.query.limit) || 30;
  const items = await listNotifications(req.admin, { beforeId: int(req.query.before), unreadOnly: req.query.unread === '1', module: req.query.module, limit: limit + 1 });
  res.set('Cache-Control', 'no-store');
  res.json({ items: items.slice(0, limit), hasMore: items.length > limit, unread: await unreadCount(req.admin), latestId: await latestId(req.admin) });
}));

// Long poll: answers as soon as there is a notification newer than ?after, or after ~20 s with none.
router.get('/wait', wrap(async (req, res) => {
  const after = int(req.query.after) || 0;
  let closed = false;
  res.on('close', () => { closed = true; });
  let wake = () => {};
  const onNew = () => wake();
  bus.on('new', onNew);
  try {
    const until = Date.now() + WAIT_MS;
    while (!closed) {
      const items = await listNotifications(req.admin, { afterId: after, limit: 20 });
      if (items.length || Date.now() >= until) {
        res.set('Cache-Control', 'no-store');
        return res.json({ items, unread: await unreadCount(req.admin) });
      }
      await new Promise((resolve) => {
        const t = setTimeout(resolve, Math.min(CHECK_MS, until - Date.now()));
        wake = () => { clearTimeout(t); resolve(); };
      });
    }
  } finally {
    bus.off('new', onNew);
  }
}));

// body: { ids: [1, 2] } or { all: true }
router.post('/read', wrap(async (req, res) => {
  await markRead(req.admin, req.body.all ? 'all' : req.body.ids);
  res.json({ unread: await unreadCount(req.admin) });
}));

export default router;
