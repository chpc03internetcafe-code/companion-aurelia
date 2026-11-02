// CMS: the desk's side of the website live chat (/api/live-chat). Needs the Contact Messages permission
// (View to read; Manage to reply, close and assign). Message text is never written to the audit trail.
import { Router } from 'express';
import { HttpError, idParam, wrap } from '../lib/http.js';
import { insertRow, reorder, updateRow, validate } from '../lib/validate.js';
import { SAMPLE_TEMPLATES } from '../lib/chat-templates.js';
import { logEvent } from '../lib/audit.js';
import { one, q, run } from '../db/index.js';
import { longPoll } from '../lib/longpoll.js';
import { addMessage, chatAlerts, chatStats, closeChat, latestMessageId, listChats, loadChat, reopenChat, setStaffTyping, staffThread, TOPIC, typingChats } from '../services/live-chat.js';

const router = Router();

const log = (req, c, action, summary) => logEvent({ action, module: 'inquiries', entityType: 'Live chat', entityId: c.id, entityLabel: c.reference, summary }, req);

// ?status=Open|Closed|all &search &mine=1
router.get('/', wrap(async (req, res) => {
  const items = await listChats(req.admin, { status: req.query.status || 'Open', search: String(req.query.search || '').slice(0, 100), mine: req.query.mine === '1' });
  res.json({ items, stats: await chatStats(), latestId: await latestMessageId() });
}));

router.get('/stats', wrap(async (_req, res) => res.json(await chatStats())));

// Long poll for the CMS: answers as soon as any chat has a message newer than ?after, or the chats whose visitor
// is typing differ from ?typing (comma list of ids), or after ~20 s.
router.get('/wait', wrap(async (req, res) => {
  const after = Number(req.query.after) || 0;
  const knownTyping = req.query.typing === undefined ? null : String(req.query.typing).replace(/^-$/, ''); // '-': nobody
  let typing = '';
  const latest = await longPoll(req, res, TOPIC, async () => {
    const id = await latestMessageId();
    typing = await typingChats();
    return id > after || (knownTyping !== null && typing !== knownTyping) ? id : null;
  });
  if (res.writableEnded) return;
  // alerts: visitor messages since ?after, so the CMS can chime for replies in running chats
  const id = latest || after;
  res.json({ latestId: id, typing: typing ? typing.split(',').map(Number) : [], stats: await chatStats(), alerts: after && id > after ? await chatAlerts(after) : [] });
}));

// Published profiles, for sending a profile card (chat staff may not have the Profiles permission).
router.get('/profiles', wrap(async (_req, res) => {
  res.json(await q(`SELECT p.id, p.display_name, p.slug, p.status, p.age, c.name AS category_name, l.name AS location_name,
      (SELECT url FROM profile_media m WHERE m.profile_id = p.id AND m.kind = 'photo' AND NOT m.is_hidden ORDER BY m.is_primary DESC, m.sort_order, m.id LIMIT 1) AS photo_url,
      (SELECT MIN(price) FROM profile_rates r WHERE r.profile_id = p.id AND r.is_active) AS price_from
    FROM profiles p JOIN categories c ON c.id = p.category_id LEFT JOIN locations l ON l.id = p.base_location_id
    WHERE p.status = 'Published' AND c.is_active ORDER BY p.display_name`));
}));

// ---------- Saved replies (before /:id so /templates isn't read as a chat id) ----------
const templateSchema = {
  title: { type: 'string', required: true, max: 80, label: 'Title' },
  body: { type: 'string', required: true, max: 2000, label: 'Text' },
};
const listTemplates = () => q('SELECT id, title, body FROM live_chat_templates ORDER BY sort_order, id');

router.get('/templates', wrap(async (_req, res) => res.json(await listTemplates())));
router.put('/templates', wrap(async (req, res) => {
  await reorder('live_chat_templates', req.body.order);
  res.json(await listTemplates());
}));
router.post('/templates', wrap(async (req, res) => {
  const { n } = await one('SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM live_chat_templates');
  await insertRow('live_chat_templates', templateSchema, validate(req.body, templateSchema), { sort_order: n });
  res.status(201).json(await listTemplates());
}));
// Adds the sample replies (lib/chat-templates.js) whose title isn't used yet.
router.post('/templates/samples', wrap(async (_req, res) => {
  const have = new Set((await listTemplates()).map((t) => t.title.toLowerCase()));
  const { n } = await one('SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM live_chat_templates');
  let i = n;
  for (const [title, body] of SAMPLE_TEMPLATES) {
    if (!have.has(title.toLowerCase())) await run('INSERT INTO live_chat_templates (title, body, sort_order) VALUES ($1, $2, $3)', [title, body, i++]);
  }
  res.status(201).json(await listTemplates());
}));
router.put('/templates/:id', wrap(async (req, res) => {
  await updateRow('live_chat_templates', templateSchema, idParam(req), validate(req.body, templateSchema));
  res.json(await listTemplates());
}));
router.delete('/templates/:id', wrap(async (req, res) => {
  if (!await run('DELETE FROM live_chat_templates WHERE id = $1', [idParam(req)])) throw new HttpError(404, 'Template not found.');
  res.json(await listTemplates());
}));

// One chat with its messages after ?after. Viewing marks the visitor's messages as read by the desk.
router.get('/:id', wrap(async (req, res) => {
  res.json(await staffThread(await loadChat(idParam(req)), req.query.after));
}));

// { body, after, profileId?, internal? } — with profileId, a profile card (the text is then an optional note);
// internal: a note for staff only, which can also be added to a closed chat.
router.post('/:id/messages', wrap(async (req, res) => {
  const c = await loadChat(idParam(req));
  if (req.body.internal === true) {
    await addMessage(c, 'Staff', req.body.body, req.admin, { internal: true });
    return res.status(201).json(await staffThread(await loadChat(c.id), req.body.after));
  }
  if (c.status !== 'Open') throw new HttpError(409, 'This chat is closed. Reopen it to reply.');
  let profileId = null;
  if (req.body.profileId) {
    const p = await one(`SELECT p.id FROM profiles p JOIN categories c ON c.id = p.category_id WHERE p.id = $1 AND p.status = 'Published' AND c.is_active`, [Number(req.body.profileId) || 0]);
    if (!p) throw new HttpError(422, 'Choose a published profile.', { profileId: 'Choose a published profile.' });
    profileId = p.id;
  }
  await addMessage(c, 'Staff', req.body.body, req.admin, { profileId });
  if (!c.assignedTo) await one('UPDATE live_chats SET assigned_to = $1 WHERE id = $2 AND assigned_to IS NULL RETURNING id', [req.admin.id, c.id]);
  res.status(201).json(await staffThread(await loadChat(c.id), req.body.after));
}));

// { typing: true | false } — sent every few seconds while a reply is being written, so the visitor sees "typing…".
router.post('/:id/typing', wrap(async (req, res) => {
  const c = await loadChat(idParam(req));
  if (c.status === 'Open') await setStaffTyping(c, req.body.typing !== false);
  res.status(204).end();
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
