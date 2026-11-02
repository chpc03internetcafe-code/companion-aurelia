// Website: the visitor's side of the live chat (/api/site/chat). The chat belongs to the browser that started it
// (httpOnly cookie).
import { Router } from 'express';
import { clientIp, HttpError, wrap } from '../lib/http.js';
import { validate } from '../lib/validate.js';
import { rateLimit } from '../lib/auth.js';
import { logEvent } from '../lib/audit.js';
import { longPoll } from '../lib/longpoll.js';
import { loadSettings } from '../services/settings.js';
import { addMessage, closeChat, deleteChat, deskHours, purgeOldChats, deskInfo, forgetChat, MAX_LENGTH, rateChat, sendTranscript, setVisitorTyping, startChat, TOPIC, visitorChat, visitorMessages } from '../services/live-chat.js';

const router = Router();

async function enabled() {
  if ((await loadSettings()).liveChatEnabled !== '1') throw new HttpError(404, 'Live chat is not available.');
}
async function myChat(req) {
  const c = await visitorChat(req);
  if (!c) throw new HttpError(404, 'This chat has ended. Start a new one any time.');
  return c;
}

// The current chat (if any) with its messages, whether the desk is online, and its hours (desk: { online, open, opensAt, awayMessage }).
router.get('/', wrap(async (req, res) => {
  await enabled();
  const c = await visitorChat(req);
  const desk = await deskInfo();
  if (!c) return res.json({ chat: null, messages: [], online: desk.online, desk });
  res.json({ ...(await visitorMessages(c, req.query.after)), online: desk.online, desk });
}));

// Long poll: new messages after ?after, or a change of status, read receipt (?seen) or typing (?typing=0|1);
// { messages: [] } after ~20 s with none. ?bg=1 while the tab is hidden: delivered, but not marked as read.
router.get('/wait', wrap(async (req, res) => {
  await enabled();
  const c = await myChat(req);
  const after = Number(req.query.after) || 0;
  const known = {
    seenId: req.query.seen === undefined ? undefined : Number(req.query.seen) || 0,
    typing: req.query.typing === undefined ? undefined : req.query.typing === '1',
  };
  const opts = { onlyNew: true, known, background: req.query.bg === '1' };
  const r = await longPoll(req, res, TOPIC, () => visitorMessages(c, after, opts), { everyMs: 1_500 });
  if (res.writableEnded) return;
  res.json(r || await visitorMessages(c, after, { background: opts.background }));
}));

// Starts a chat: { name, email?, message, page?, profileId? (the profile the visitor is asking about) }.
router.post('/', wrap(async (req, res) => {
  await enabled();
  if (req.body.website) return res.status(201).json({ chat: null, messages: [] }); // honeypot
  const data = validate(req.body, {
    name: { type: 'string', required: true, max: 150, label: 'Name' },
    email: { type: 'email', label: 'Email' },
    message: { type: 'string', required: true, max: MAX_LENGTH, label: 'Message' },
    page: { type: 'string', max: 300 },
    profileId: { type: 'int', min: 1 },
  });
  if (!data.email && !deskHours(await loadSettings()).open) {
    throw new HttpError(422, 'We’re away right now. Add your email so we can reply when we’re back.', { email: 'Needed while we’re away, so we can reply.' });
  }
  await rateLimit(`livechat:${clientIp(req)}`, 5, 3600000);
  purgeOldChats().catch(() => {});
  const old = await visitorChat(req);
  if (old?.status === 'Open') await closeChat(old, 'Visitor');
  const c = await startChat(req, res, { ...data, page: data.page?.startsWith('/') ? data.page : null });
  await logEvent({ action: 'Live chat started', module: 'inquiries', entityType: 'Live chat', entityId: c.id, entityLabel: c.reference,
    summary: `${data.name} started a live chat`, actorType: 'Visitor', userName: data.name, userEmail: data.email }, req);
  const desk = await deskInfo();
  res.status(201).json({ ...(await visitorMessages(c, 0)), online: desk.online, desk });
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

// { typing: true | false } — sent every few seconds while the visitor writes, so the desk sees "typing…".
router.post('/typing', wrap(async (req, res) => {
  await enabled();
  const c = await myChat(req);
  if (c.status === 'Open') await setVisitorTyping(c, req.body.typing !== false);
  res.status(204).end();
}));

// Ends the chat but keeps it in this browser, so the visitor can rate it and email the transcript. { after }
router.post('/close', wrap(async (req, res) => {
  await enabled();
  const c = await myChat(req);
  await closeChat(c, 'Visitor');
  res.json(await visitorMessages(await visitorChat(req), req.body.after));
}));

// { rating: 'Good' | 'Bad', comment? } — once the chat has ended.
router.post('/rate', wrap(async (req, res) => {
  await enabled();
  const c = await myChat(req);
  await rateChat(c, req.body.rating, req.body.comment);
  res.json(await visitorMessages(await visitorChat(req), req.body.after));
}));

// { email? } — emails the conversation once the chat has ended (to the chat's email unless another is given).
router.post('/transcript', wrap(async (req, res) => {
  await enabled();
  const c = await myChat(req);
  const { email } = validate(req.body, { email: { type: 'email', label: 'Email' } });
  await rateLimit(`livechat-transcript:${clientIp(req)}`, 3, 3600000);
  await sendTranscript(c, email);
  res.json(await visitorMessages(await visitorChat(req), req.body.after));
}));

// Deletes the chat and its messages for good, and forgets it in this browser.
router.post('/delete', wrap(async (req, res) => {
  const c = await myChat(req);
  await deleteChat(c);
  forgetChat(req, res);
  await logEvent({ action: 'Live chat deleted', module: 'inquiries', entityType: 'Live chat', entityId: c.id, entityLabel: c.reference,
    summary: 'The visitor deleted their live chat', actorType: 'Visitor' }, req);
  res.json({ ok: true });
}));

// Ends the chat (if still open) and forgets it in this browser.
router.post('/end', wrap(async (req, res) => {
  const c = await visitorChat(req);
  if (c) await closeChat(c, 'Visitor');
  forgetChat(req, res);
  res.json({ ok: true });
}));

export default router;
