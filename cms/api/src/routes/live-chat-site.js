// Website: the visitor's side of the live chat (/api/site/chat). The chat belongs to the browser that started it
// (httpOnly cookie).
import { Router } from 'express';
import { clientIp, HttpError, wrap } from '../lib/http.js';
import { validate } from '../lib/validate.js';
import { rateLimit } from '../lib/auth.js';
import { logEvent } from '../lib/audit.js';
import { longPoll } from '../lib/longpoll.js';
import { loadSettings } from '../services/settings.js';
import { addMessage, closeChat, deskOnline, forgetChat, MAX_LENGTH, publicChat, startChat, TOPIC, visitorChat, visitorMessages } from '../services/live-chat.js';

const router = Router();

async function enabled() {
  if ((await loadSettings()).liveChatEnabled !== '1') throw new HttpError(404, 'Live chat is not available.');
}
async function myChat(req) {
  const c = await visitorChat(req);
  if (!c) throw new HttpError(404, 'This chat has ended. Start a new one any time.');
  return c;
}

// The current chat (if any) with its messages, and whether the desk is online.
router.get('/', wrap(async (req, res) => {
  await enabled();
  const c = await visitorChat(req);
  const online = await deskOnline();
  if (!c) return res.json({ chat: null, messages: [], online });
  res.json({ ...(await visitorMessages(c, req.query.after)), online });
}));

// Long poll: new messages after ?after, or a status change; { messages: [] } after ~20 s with none.
router.get('/wait', wrap(async (req, res) => {
  await enabled();
  const c = await myChat(req);
  const after = Number(req.query.after) || 0;
  const r = await longPoll(req, res, TOPIC, () => visitorMessages(c, after, { onlyNew: true }), { everyMs: 1_500 });
  if (res.writableEnded) return;
  res.json(r || { chat: publicChat(c), messages: [] });
}));

// Starts a chat: { name, email?, message, page? }.
router.post('/', wrap(async (req, res) => {
  await enabled();
  if (req.body.website) return res.status(201).json({ chat: null, messages: [] }); // honeypot
  const data = validate(req.body, {
    name: { type: 'string', required: true, max: 150, label: 'Name' },
    email: { type: 'email', label: 'Email' },
    message: { type: 'string', required: true, max: MAX_LENGTH, label: 'Message' },
    page: { type: 'string', max: 300 },
  });
  await rateLimit(`livechat:${clientIp(req)}`, 5, 3600000);
  const old = await visitorChat(req);
  if (old?.status === 'Open') await closeChat(old, 'Visitor');
  const c = await startChat(req, res, { ...data, page: data.page?.startsWith('/') ? data.page : null });
  await logEvent({ action: 'Live chat started', module: 'inquiries', entityType: 'Live chat', entityId: c.id, entityLabel: c.reference,
    summary: `${data.name} started a live chat`, actorType: 'Visitor', userName: data.name, userEmail: data.email }, req);
  res.status(201).json({ ...(await visitorMessages(c, 0)), online: await deskOnline() });
}));

// { body, after } → messages after `after` (including the one just sent).
router.post('/messages', wrap(async (req, res) => {
  await enabled();
  const c = await myChat(req);
  if (c.status !== 'Open') throw new HttpError(409, 'This chat has ended. Start a new one any time.');
  await rateLimit(`livechat-msg:${c.id}`, 40, 10 * 60000);
  await addMessage(c, 'Visitor', req.body.body);
  res.status(201).json(await visitorMessages(c, req.body.after));
}));

// Ends the chat and forgets it in this browser.
router.post('/end', wrap(async (req, res) => {
  const c = await visitorChat(req);
  if (c) await closeChat(c, 'Visitor');
  forgetChat(req, res);
  res.json({ ok: true });
}));

export default router;
