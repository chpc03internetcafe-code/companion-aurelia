// CMS: the desk's side of the website live chat (/api/live-chat). Needs the Contact Messages permission
// (View to read; Manage to reply, close and assign). Message text is never written to the audit trail.
import { Router } from 'express';
import { HttpError, idParam, wrap } from '../lib/http.js';
import { logEvent } from '../lib/audit.js';
import { one } from '../db/index.js';
import { longPoll } from '../lib/longpoll.js';
import { addMessage, chatStats, closeChat, latestMessageId, listChats, loadChat, reopenChat, staffThread, TOPIC } from '../services/live-chat.js';

const router = Router();

const log = (req, c, action, summary) => logEvent({ action, module: 'inquiries', entityType: 'Live chat', entityId: c.id, entityLabel: c.reference, summary }, req);

// ?status=Open|Closed|all &search &mine=1
router.get('/', wrap(async (req, res) => {
  const items = await listChats(req.admin, { status: req.query.status || 'Open', search: String(req.query.search || '').slice(0, 100), mine: req.query.mine === '1' });
  res.json({ items, stats: await chatStats(), latestId: await latestMessageId() });
}));

router.get('/stats', wrap(async (_req, res) => res.json(await chatStats())));

// Long poll for the CMS: answers as soon as any chat has a message newer than ?after, or after ~20 s.
router.get('/wait', wrap(async (req, res) => {
  const after = Number(req.query.after) || 0;
  const latest = await longPoll(req, res, TOPIC, async () => { const id = await latestMessageId(); return id > after ? id : null; });
  if (res.writableEnded) return;
  res.json({ latestId: latest || after, stats: await chatStats() });
}));

// One chat with its messages after ?after. Viewing marks the visitor's messages as read by the desk.
router.get('/:id', wrap(async (req, res) => {
  res.json(await staffThread(await loadChat(idParam(req)), req.query.after));
}));

// { body, after }
router.post('/:id/messages', wrap(async (req, res) => {
  const c = await loadChat(idParam(req));
  if (c.status !== 'Open') throw new HttpError(409, 'This chat is closed. Reopen it to reply.');
  await addMessage(c, 'Staff', req.body.body, req.admin);
  if (!c.assignedTo) await one('UPDATE live_chats SET assigned_to = $1 WHERE id = $2 AND assigned_to IS NULL RETURNING id', [req.admin.id, c.id]);
  res.status(201).json(await staffThread(await loadChat(c.id), req.body.after));
}));

router.post('/:id/close', wrap(async (req, res) => {
  const c = await loadChat(idParam(req));
  await closeChat(c, 'Staff', req.admin);
  await log(req, c, 'Live chat closed', `Closed the live chat with ${c.visitorName}`);
  res.json(await staffThread(await loadChat(c.id)));
}));

router.post('/:id/reopen', wrap(async (req, res) => {
  const c = await loadChat(idParam(req));
  await reopenChat(c, req.admin);
  await log(req, c, 'Live chat reopened', `Reopened the live chat with ${c.visitorName}`);
  res.json(await staffThread(await loadChat(c.id)));
}));

// { userId: <admin id> | null } — null unassigns; default: the signed-in staff member.
router.post('/:id/assign', wrap(async (req, res) => {
  const c = await loadChat(idParam(req));
  const userId = req.body.userId === null ? null : Number(req.body.userId) || req.admin.id;
  const user = userId ? await one("SELECT id, full_name FROM admin_users WHERE id = $1 AND status = 'Active'", [userId]) : null;
  if (userId && !user) throw new HttpError(422, 'That staff member can’t be assigned.');
  await one('UPDATE live_chats SET assigned_to = $1, updated_at = now() WHERE id = $2 RETURNING id', [userId, c.id]);
  await log(req, c, 'Live chat assigned', user ? `Assigned the live chat with ${c.visitorName} to ${user.fullName}` : `Unassigned the live chat with ${c.visitorName}`);
  res.json(await staffThread(await loadChat(c.id)));
}));

export default router;
