// Live chat between website visitors and the concierge desk.
//
// - A website visitor starts a chat from the chat button. Their browser gets a random
//   token in an httpOnly cookie; only its SHA-256 is stored, so the chat can't be opened from anywhere else.
// - Staff with the Contact Messages permission answer in the CMS (Live chat). Messages are stored encrypted.
// - Both sides long-poll for new messages (lib/longpoll.js), so it works on Vercel without WebSockets.
// - Staff are notified when a chat starts (or a quiet chat wakes up); the message text never goes into
//   notifications, emails or the audit trail.
// - If the visitor has left when staff reply and gave an email, they get a "you have a reply" email (no text).
// - Staff can send a profile card (a message with profile_id), shown on the website with View and Book buttons.
// - Desk hours (settings): outside them the chat says when the desk is back, and visitors must leave an email.
// - A chat can be about a profile ("Chat about …" on a profile page). The visitor sees when the desk has read
//   their messages and when someone is typing a reply (staff_typing_until, refreshed while staff type); staff see
//   when the visitor is typing (visitor_typing_until, refreshed the same way).
// - Staff can add internal notes (live_chat_messages.internal): stored and shown like messages in the CMS, never
//   sent to the visitor, never counted as a reply.
// - When the chat has ended the visitor can rate it (Good / Bad, with an optional comment) and, if the desk allows it
//   (setting liveChatTranscripts, off by default), email themselves the transcript once. That transcript is the only
//   email that carries message text, and only the visitor can ask for it.
// - Single messages can be deleted "for me" (hidden from the visitor, or from one staff member) or, for your own
//   side's messages, "for everyone" (the text is erased; both sides see "This message was deleted").
// - Privacy: an ended chat stays readable in the visitor's browser for DEVICE_MINUTES (for the rating and transcript),
//   then the browser no longer gets it (unless staff reopen it). The visitor can remove it from the device or delete
//   it for good at any time. With liveChatRetentionDays set, chats with no activity for that long are deleted.
import crypto from 'node:crypto';
import { one, params, q, run, tx } from '../db/index.js';
import { HttpError } from '../lib/http.js';
import { readCookie, sha256, writeCookie } from '../lib/auth.js';
import { encryptText } from '../lib/encryption.js';
import { newReference } from '../lib/refs.js';
import { poke } from '../lib/longpoll.js';
import { notifyStaff } from '../lib/notifications.js';
import { notify } from '../lib/mailer.js';
import { liveChatReply, liveChatTranscript } from '../lib/emails.js';
import { cached } from '../lib/cache.js';
import { logEvent } from '../lib/audit.js';
import { phDate, phMinutesNow, time12, toMin, weekday } from '../lib/dates.js';
import { loadSettings } from './settings.js';
import { cardsByIds } from './profiles.js';

export const COOKIE = 'aurelia_chat';
const COOKIE_DAYS = 30;
export const MAX_LENGTH = 2000;
export const TOPIC = 'live-chat';
const AWAY_MS = 2 * 60_000; // the visitor counts as gone (and is emailed about replies) after this long without checking in
const DEVICE_MINUTES = 30; // an ended chat stays in the visitor's browser this long
const PURGE_EVERY_MS = 10 * 60_000; // how often (per server instance) old chats are looked for
const TYPING_SECONDS = 6; // both composers refresh this every few seconds while typing

const SELECT = `SELECT c.*, u.full_name AS assigned_name, pr.display_name AS profile_name, pr.slug AS profile_slug
  FROM live_chats c LEFT JOIN admin_users u ON u.id = c.assigned_to LEFT JOIN profiles pr ON pr.id = c.profile_id`;

export function cleanText(text) {
  const body = String(text ?? '').replace(/\r\n/g, '\n').trim();
  if (!body) throw new HttpError(422, 'Write a message first.', { body: 'Write a message first.' });
  if (body.length > MAX_LENGTH) throw new HttpError(422, `Messages can be up to ${MAX_LENGTH} characters.`, { body: `Up to ${MAX_LENGTH} characters.` });
  return body;
}

// ---------- Visitor side ----------
/** The chat this browser belongs to (by its cookie), or null; an ended chat only for DEVICE_MINUTES after it ended. */
export async function visitorChat(req) {
  const token = readCookie(req, COOKIE);
  if (!token || token.length < 32) return null;
  return one(`${SELECT} WHERE c.token_hash = $1 AND (c.status = 'Open' OR c.closed_at > now() - make_interval(mins => $2))`, [sha256(token), DEVICE_MINUTES]);
}

export const forgetChat = (req, res) => writeCookie(req, res, COOKIE, '', 0);

/** Whether someone who can answer chats has used the CMS in the last 10 minutes. */
export function deskOnline() {
  return cached('live-chat:online', 30_000, async () => {
    const rows = await q(`SELECT r.permissions, r.is_system FROM admin_sessions s JOIN admin_users u ON u.id = s.user_id JOIN admin_roles r ON r.id = u.role_id
      WHERE s.expires_at > now() AND s.last_seen_at > now() - INTERVAL '10 minutes' AND u.status = 'Active'`);
    return rows.some((r) => {
      if (r.isSystem) return true;
      try { return ['view', 'manage'].includes(JSON.parse(r.permissions || '{}').inquiries); } catch { return false; }
    });
  });
}

// ---------- Desk hours ----------
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const parseHours = (v) => { try { const h = JSON.parse(v || '{}'); return h && typeof h === 'object' ? h : {}; } catch { return {}; } };
/** A day's opening as minutes from that midnight; a close before the open runs into the next day. */
const span = (hours, day) => {
  const v = hours[day];
  if (!Array.isArray(v) || v.length !== 2) return null;
  const open = toMin(v[0]);
  const close = toMin(v[1]);
  return { open, close: close <= open ? close + 1440 : close, label: time12(v[0]) };
};

/** { open, opensAt } — whether the desk keeps hours now (Manila time) and, if closed, when it opens next ("today at 6:00 PM"). */
export function deskHours(settings, now = new Date()) {
  if (settings.liveChatHoursEnabled !== '1') return { open: true, opensAt: null };
  const hours = parseHours(settings.liveChatHours);
  const day = weekday(phDate(now));
  const min = phMinutesNow(now);
  const today = span(hours, day);
  const yesterday = span(hours, (day + 6) % 7);
  if ((today && min >= today.open && min < today.close) || (yesterday && min + 1440 < yesterday.close)) return { open: true, opensAt: null };
  for (let k = 0; k < 8; k += 1) {
    const s = span(hours, (day + k) % 7);
    if (s && k * 1440 + s.open > min) return { open: false, opensAt: `${k === 0 ? 'today' : k === 1 ? 'tomorrow' : DAYS[(day + k) % 7]} at ${s.label}` };
  }
  return { open: false, opensAt: null };
}

/** What the chat window shows about the desk: online now, open hours, and the away message. */
export async function deskInfo() {
  const s = await loadSettings();
  const h = deskHours(s);
  return { online: h.open && (await deskOnline()), open: h.open, opensAt: h.opensAt, awayMessage: h.open ? '' : s.liveChatOfflineMessage || '' };
}

/** Starts a chat for this browser with its first message, and sets the cookie. */
export async function startChat(req, res, { name, email, message, page, profileId }) {
  const body = cleanText(message);
  const profile = profileId ? await one("SELECT id, display_name FROM profiles WHERE id = $1 AND status <> 'Retired'", [profileId]) : null;
  const token = crypto.randomBytes(32).toString('base64url');
  const chat = await tx(async (db) => {
    const reference = await newReference(db, 'CHAT', 'live_chats', 'reference');
    const c = await db.one(`INSERT INTO live_chats (reference, token_hash, visitor_name, visitor_email, page_url, profile_id, visitor_seen_at)
      VALUES ($1, $2, $3, $4, $5, $6, now()) RETURNING id, reference`, [reference, sha256(token), name, email || null, page || null, profile?.id || null]);
    const m = await db.one("INSERT INTO live_chat_messages (chat_id, sender, body) VALUES ($1, 'Visitor', $2) RETURNING id", [c.id, encryptText(body)]);
    await db.run('UPDATE live_chats SET visitor_seen_message_id = $1 WHERE id = $2', [m.id, c.id]);
    return c;
  });
  writeCookie(req, res, COOKIE, token, COOKIE_DAYS * 86400);
  await notifyStaff({ type: 'live_chat', module: 'inquiries', link: `/live-chat/${chat.id}`, title: `Live chat from ${name}`, body: `${chat.reference} · ${profile ? `asking about ${profile.displayName}` : 'a visitor is waiting for a reply'}.` });
  poke(TOPIC);
  return one(`${SELECT} WHERE c.id = $1`, [chat.id]);
}

const visitorShape = (m, cards) => ({
  id: m.id, from: m.sender === 'Visitor' ? 'me' : m.sender === 'Staff' ? 'staff' : 'system', name: m.sender === 'Staff' ? 'Concierge' : null, body: m.body, at: m.createdAt,
  card: m.profileId ? cards.get(m.profileId) || null : null, // null when the profile is no longer published
  deleted: !!m.deletedAt, // deleted for everyone: body is ''
});
/** Ids of the chat's messages deleted for everyone, so either side can update messages it already shows. */
const deletedIds = async (chatId) => (await q('SELECT id FROM live_chat_messages WHERE chat_id = $1 AND deleted_at IS NOT NULL', [chatId])).map((r) => r.id);
/** Public profile cards for the messages that carry one. */
const cardsFor = async (rows) => new Map((await cardsByIds([...new Set(rows.map((r) => r.profileId).filter(Boolean))])).map((c) => [c.id, c]));
export const publicChat = (c) => ({
  reference: c.reference, status: c.status, name: c.visitorName, email: c.visitorEmail, startedAt: c.createdAt,
  profile: c.profileId && c.profileName ? { name: c.profileName, slug: c.profileSlug } : null,
  seenId: c.staffSeenMessageId || 0, // the desk has read the visitor's messages up to this id
  typing: !!c.typing, // someone at the desk is writing a reply
  rating: c.rating || null, // 'Good' | 'Bad' once the visitor rated the ended chat
  transcriptSent: !!c.transcriptSentAt,
  deletions: c.deletions || 0, // messages deleted for everyone so far
});

/**
 * Messages after `after` for the visitor, with the chat's status, read receipt and typing state; marks them seen.
 * For long polling (onlyNew), returns null while nothing differs from what the browser already shows (`known`).
 * `background`: the visitor's tab is hidden, so the messages are delivered but not counted as read.
 */
export async function visitorMessages(c, after = 0, { onlyNew = false, known = {}, background = false } = {}) {
  const rows = await q(`SELECT id, sender, body, profile_id, created_at, deleted_at FROM live_chat_messages
    WHERE chat_id = $1 AND id > $2 AND NOT internal AND NOT visitor_hidden ORDER BY id LIMIT 500`, [c.id, Math.max(0, Number(after) || 0)]);
  const now = await one(`SELECT status, staff_seen_message_id, COALESCE(staff_typing_until > now(), FALSE) AS typing, rating, transcript_sent_at, deletions
    FROM live_chats WHERE id = $1`, [c.id]);
  const cur = { ...c, ...(now || {}) };
  if (!background) {
    run(`UPDATE live_chats SET visitor_seen_at = now()${rows.length ? ', visitor_seen_message_id = GREATEST(visitor_seen_message_id, $2)' : ''} WHERE id = $1`,
      rows.length ? [c.id, rows[rows.length - 1].id] : [c.id]).catch(() => {});
  }
  if (onlyNew && !rows.length && cur.status === c.status && cur.rating === c.rating
    && (known.seenId === undefined || known.seenId === (cur.staffSeenMessageId || 0))
    && (known.typing === undefined || known.typing === !!cur.typing)
    && (known.deletions === undefined || known.deletions === (cur.deletions || 0))) return null;
  const cards = await cardsFor(rows);
  return { chat: publicChat(cur), messages: rows.map((m) => visitorShape(m, cards)), deleted: await deletedIds(c.id) };
}

// ---------- Both sides ----------
/**
 * Adds a message. sender: 'Visitor' | 'Staff' (with admin) | 'System'. profileId: a profile card (staff), the text is
 * then optional. internal: a staff note, only seen in the CMS (doesn't count as a reply or change the chat's order).
 */
export async function addMessage(c, sender, text, admin = null, { profileId = null, internal = false } = {}) {
  const body = sender === 'System' ? text : profileId ? String(text ?? '').replace(/\r\n/g, '\n').trim().slice(0, MAX_LENGTH) : cleanText(text);
  const note = sender === 'Staff' && internal && !profileId;
  const m = await one('INSERT INTO live_chat_messages (chat_id, sender, author_id, author, body, profile_id, internal) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id',
    [c.id, sender, admin?.id || null, admin?.name?.slice(0, 150) || null, encryptText(body), profileId, note]);
  if (note) {
    await run('UPDATE live_chats SET updated_at = now() WHERE id = $1', [c.id]);
    poke(TOPIC);
    return m.id;
  }
  const seen = sender === 'Visitor' ? ', visitor_seen_message_id = $2, visitor_seen_at = now(), visitor_typing_until = NULL' : sender === 'Staff' ? ', staff_seen_message_id = $2, staff_typing_until = NULL' : '';
  await run(`UPDATE live_chats SET last_message_at = now(), updated_at = now()${seen} WHERE id = $1`, seen ? [c.id, m.id] : [c.id]);
  poke(TOPIC);

  if (sender === 'Visitor') {
    // a chat that had gone quiet: tell the desk again (not for every message of a running conversation)
    const recent = await one(`SELECT COUNT(*)::int AS n FROM live_chat_messages WHERE chat_id = $1 AND sender = 'Visitor' AND id <> $2
      AND created_at > now() - INTERVAL '15 minutes'`, [c.id, m.id]);
    if (!recent.n) await notifyStaff({ type: 'live_chat', module: 'inquiries', link: `/live-chat/${c.id}`, title: `New live chat message from ${c.visitorName}`, body: `${c.reference} · waiting for a reply.` });
  }
  if (sender === 'Staff' && c.visitorEmail) {
    // the visitor left: email them once per batch of unread replies (without the text)
    const v = await one(`SELECT visitor_seen_at, (SELECT COUNT(*)::int FROM live_chat_messages WHERE chat_id = $1 AND sender = 'Staff' AND NOT internal AND deleted_at IS NULL AND id > lc.visitor_seen_message_id) AS unread
      FROM live_chats lc WHERE id = $1`, [c.id]);
    const away = !v.visitorSeenAt || Date.now() - new Date(v.visitorSeenAt).getTime() > AWAY_MS;
    if (away && v.unread === 1) await notify(liveChatReply(await loadSettings(), c));
  }
  return m.id;
}

/** Staff started (on) or stopped typing a reply; shown to the visitor for a few seconds unless refreshed. */
export async function setStaffTyping(c, on) {
  await run(`UPDATE live_chats SET staff_typing_until = ${on ? `now() + INTERVAL '${TYPING_SECONDS} seconds'` : 'NULL'} WHERE id = $1`, [c.id]);
  poke(TOPIC);
}

/** The visitor started (on) or stopped typing; shown to the desk for a few seconds unless refreshed. */
export async function setVisitorTyping(c, on) {
  await run(`UPDATE live_chats SET visitor_typing_until = ${on ? `now() + INTERVAL '${TYPING_SECONDS} seconds'` : 'NULL'} WHERE id = $1`, [c.id]);
  poke(TOPIC);
}

/** Open chats whose visitor is typing, as a sorted comma list of ids ('' for none), for the CMS feed. */
export const typingChats = async () => (await q("SELECT id FROM live_chats WHERE status = 'Open' AND visitor_typing_until > now() ORDER BY id"))
  .map((r) => r.id).join(',');

/** The visitor's verdict on an ended chat: rating 'Good' | 'Bad', comment optional (stored encrypted). Can be changed. */
export async function rateChat(c, rating, comment) {
  if (c.status !== 'Closed') throw new HttpError(409, 'You can rate the chat once it has ended.');
  if (!['Good', 'Bad'].includes(rating)) throw new HttpError(422, 'Choose a rating.', { rating: 'Choose a rating.' });
  const text = String(comment ?? '').replace(/\r\n/g, '\n').trim().slice(0, 1000);
  await run('UPDATE live_chats SET rating = $1, rating_comment = $2, rated_at = now(), updated_at = now() WHERE id = $3', [rating, text ? encryptText(text) : null, c.id]);
  poke(TOPIC);
}

/** Emails the conversation (without staff notes) to the visitor, once per chat, after it has ended. */
export async function sendTranscript(c, email) {
  if ((await loadSettings()).liveChatTranscripts !== '1') throw new HttpError(403, 'Emailing chat transcripts is turned off.');
  if (c.status !== 'Closed') throw new HttpError(409, 'You can email the transcript once the chat has ended.');
  const to = email || c.visitorEmail;
  if (!to) throw new HttpError(422, 'Add the email to send it to.', { email: 'Add the email to send it to.' });
  // claim first, so two clicks can't send it twice
  if (!await one('UPDATE live_chats SET transcript_sent_at = now() WHERE id = $1 AND transcript_sent_at IS NULL RETURNING id', [c.id])) {
    throw new HttpError(409, 'The transcript was already sent.');
  }
  const rows = await q(`SELECT m.sender, m.body, m.created_at, pr.display_name AS profile_name, pr.slug AS profile_slug
    FROM live_chat_messages m LEFT JOIN profiles pr ON pr.id = m.profile_id
    WHERE m.chat_id = $1 AND NOT m.internal AND NOT m.visitor_hidden AND m.deleted_at IS NULL ORDER BY m.id LIMIT 1000`, [c.id]);
  if (!await notify(liveChatTranscript(await loadSettings(), c, to, rows))) {
    await run('UPDATE live_chats SET transcript_sent_at = NULL WHERE id = $1', [c.id]);
    throw new HttpError(503, 'We couldn’t send the email right now. Please try again later.');
  }
}

/**
 * Deletes one message. by: 'Visitor' | 'Staff' (with admin). scope 'me': hidden for the visitor, or for this staff
 * member only. scope 'everyone': only for your own side's messages (staff: replies and notes); the text is erased
 * and both sides see that a message was deleted.
 */
export async function deleteMessage(c, messageId, by, scope, admin = null) {
  if (!['me', 'everyone'].includes(scope)) throw new HttpError(422, 'Choose who to delete it for.');
  const m = await one('SELECT id, sender, internal, visitor_hidden, deleted_at FROM live_chat_messages WHERE id = $1 AND chat_id = $2', [Number(messageId) || 0, c.id]);
  if (!m || m.sender === 'System' || (by === 'Visitor' && (m.internal || m.visitorHidden))) throw new HttpError(404, 'Message not found.');
  if (scope === 'me') {
    if (by === 'Visitor') await run('UPDATE live_chat_messages SET visitor_hidden = TRUE WHERE id = $1', [m.id]);
    else await run('INSERT INTO live_chat_hidden (message_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [m.id, admin.id]);
    return false;
  }
  if (m.sender !== by) throw new HttpError(403, 'You can only delete your own messages for everyone.');
  if (m.deletedAt) return false;
  await run("UPDATE live_chat_messages SET body = '', profile_id = NULL, deleted_at = now(), deleted_by = $2 WHERE id = $1", [m.id, by]);
  await run('UPDATE live_chats SET deletions = deletions + 1, updated_at = now() WHERE id = $1', [c.id]);
  poke(TOPIC);
  return true;
}

/** Total messages deleted for everyone, in all chats: the CMS feed answers when it changes. */
export const deletionsTotal = async () => (await one('SELECT COALESCE(SUM(deletions), 0)::int AS n FROM live_chats')).n;

/** Deletes a chat and all its messages for good (the visitor asked for it). */
export async function deleteChat(c) {
  await run('DELETE FROM live_chats WHERE id = $1', [c.id]);
  poke(TOPIC);
}

let lastPurge = 0;
/**
 * Deletes chats with no activity for liveChatRetentionDays (0 = keep them). Runs at most every PURGE_EVERY_MS per
 * server instance (force: now), from busy chat requests, so it needs no scheduled job. Returns how many were deleted.
 */
export async function purgeOldChats({ force = false } = {}) {
  if (!force && Date.now() - lastPurge < PURGE_EVERY_MS) return 0;
  lastPurge = Date.now();
  const days = Number((await loadSettings()).liveChatRetentionDays) || 0;
  if (days <= 0) return 0;
  const gone = await q(`DELETE FROM live_chats WHERE GREATEST(last_message_at, COALESCE(closed_at, last_message_at)) < now() - make_interval(days => $1)
    RETURNING id`, [days]);
  if (gone.length) {
    poke(TOPIC);
    await logEvent({ action: 'Old live chats deleted', module: 'inquiries', entityType: 'Live chat',
      summary: `Deleted ${gone.length} live chat${gone.length === 1 ? '' : 's'} with no activity for ${days} days` });
  }
  return gone.length;
}

/** Ends a chat. by: 'Visitor' | 'Staff'. */
export async function closeChat(c, by, admin = null) {
  if (c.status === 'Closed') return;
  await run("UPDATE live_chats SET status = 'Closed', closed_at = now(), updated_at = now() WHERE id = $1", [c.id]);
  await addMessage(c, 'System', by === 'Visitor' ? `${c.visitorName} ended the chat.` : 'The concierge ended the chat.', by === 'Staff' ? admin : null);
}

/** Reopens a closed chat (staff), so the visitor can reply again from the same browser. */
export async function reopenChat(c, admin) {
  if (c.status === 'Open') return;
  await run("UPDATE live_chats SET status = 'Open', closed_at = NULL, updated_at = now() WHERE id = $1", [c.id]);
  await addMessage(c, 'System', 'The concierge reopened the chat.', admin);
}

// ---------- Staff side ----------
const staffShape = (m) => ({
  id: m.id, sender: m.sender, internal: !!m.internal, deleted: !!m.deletedAt, deletedBy: m.deletedBy || null, name: m.sender === 'Staff' ? m.author || 'Concierge' : m.sender === 'Visitor' ? null : 'System', body: m.body, at: m.createdAt,
  profile: m.profileId ? { id: m.profileId, name: m.profileName || 'Removed profile', slug: m.profileSlug, photoUrl: m.profilePhoto } : null,
});

const unreadSql = `(SELECT COUNT(*)::int FROM live_chat_messages lm WHERE lm.chat_id = c.id AND lm.sender = 'Visitor' AND lm.deleted_at IS NULL AND lm.id > c.staff_seen_message_id)`;

/** ?status=Open|Closed|all &search &mine (assigned to this admin). */
export async function listChats(admin, { status = 'Open', search, mine, limit = 100 } = {}) {
  const p = params();
  const where = [];
  if (['Open', 'Closed'].includes(status)) where.push(`c.status = ${p.add(status)}`);
  if (mine) where.push(`c.assigned_to = ${p.add(admin.id)}`);
  if (search) {
    const s = p.add(`%${search}%`);
    where.push(`(c.reference ILIKE ${s} OR c.visitor_name ILIKE ${s} OR c.visitor_email ILIKE ${s})`);
  }
  const rows = await q(`SELECT c.*, u.full_name AS assigned_name, pr.display_name AS profile_name, ${unreadSql} AS unread, last.body AS last_body, last.sender AS last_sender, last.profile_id AS last_profile_id, last.deleted_at AS last_deleted_at
    FROM live_chats c LEFT JOIN admin_users u ON u.id = c.assigned_to LEFT JOIN profiles pr ON pr.id = c.profile_id
    LEFT JOIN LATERAL (SELECT lm.body, lm.sender, lm.profile_id, lm.deleted_at FROM live_chat_messages lm WHERE lm.chat_id = c.id AND NOT lm.internal ORDER BY lm.id DESC LIMIT 1) last ON TRUE
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY (c.status = 'Open') DESC, c.last_message_at DESC LIMIT ${p.add(Math.min(limit, 200))}`, p.values);
  const cut = (t) => { const s = String(t || '').replace(/\s+/g, ' '); return s.length > 120 ? `${s.slice(0, 119).trimEnd()}…` : s; };
  return rows.map((r) => ({
    id: r.id, reference: r.reference, status: r.status, visitorName: r.visitorName, visitorEmail: r.visitorEmail,
    assignedTo: r.assignedTo, assignedName: r.assignedName, unread: r.unread, profileName: r.profileName || null,
    lastMessageAt: r.lastMessageAt, createdAt: r.createdAt, rating: r.rating || null, preview: r.lastDeletedAt ? 'Message deleted' : r.lastBody ? cut(r.lastBody) : r.lastProfileId ? 'Sent a profile card' : '', lastSender: r.lastSender,
    visitorOnline: r.status === 'Open' && !!r.visitorSeenAt && Date.now() - new Date(r.visitorSeenAt).getTime() < 60_000,
  }));
}

/** Open chats and unread visitor messages, for the CMS badge. */
export const chatStats = () => one(`SELECT COUNT(*) FILTER (WHERE c.status = 'Open')::int AS open,
    COALESCE(SUM(${unreadSql}) FILTER (WHERE c.status = 'Open'), 0)::int AS unread,
    COUNT(*) FILTER (WHERE c.status = 'Open' AND ${unreadSql} > 0)::int AS waiting FROM live_chats c`);

/**
 * Visitor messages after `after` in open chats, newest first, for the CMS's live alerts. `notified`: the server
 * already sent a staff notification for it (a new chat, or a chat that had been quiet for 15 minutes; see addMessage).
 */
export const chatAlerts = (after) => q(`SELECT m.id, m.chat_id, c.visitor_name, c.assigned_to,
    NOT EXISTS (SELECT 1 FROM live_chat_messages p WHERE p.chat_id = m.chat_id AND p.sender = 'Visitor' AND p.id < m.id
      AND p.created_at > m.created_at - INTERVAL '15 minutes') AS notified
  FROM live_chat_messages m JOIN live_chats c ON c.id = m.chat_id
  WHERE m.id > $1 AND m.sender = 'Visitor' AND c.status = 'Open' ORDER BY m.id DESC LIMIT 10`, [after]);

export const latestMessageId = async () => (await one('SELECT COALESCE(MAX(id), 0)::int AS id FROM live_chat_messages')).id;

export async function loadChat(id) {
  const c = await one(`${SELECT} WHERE c.id = $1`, [id]);
  if (!c) throw new HttpError(404, 'Chat not found.');
  return c;
}

/**
 * The chat with messages after `after` for staff member `viewerId` (without the ones they deleted for themselves);
 * marks visitor messages seen when markSeen.
 */
export async function staffThread(c, after = 0, viewerId = null, markSeen = true) {
  const rows = await q(`SELECT m.id, m.sender, m.author, m.body, m.created_at, m.profile_id, m.internal, m.deleted_at, m.deleted_by, pr.display_name AS profile_name, pr.slug AS profile_slug,
      (SELECT url FROM profile_media pm WHERE pm.profile_id = m.profile_id AND pm.kind = 'photo' ORDER BY pm.is_primary DESC, pm.sort_order, pm.id LIMIT 1) AS profile_photo
    FROM live_chat_messages m LEFT JOIN profiles pr ON pr.id = m.profile_id
    WHERE m.chat_id = $1 AND m.id > $2 AND NOT EXISTS (SELECT 1 FROM live_chat_hidden h WHERE h.message_id = m.id AND h.user_id = $3)
    ORDER BY m.id LIMIT 1000`, [c.id, Math.max(0, Number(after) || 0), viewerId || 0]);
  const shared = rows.filter((m) => !m.internal); // the visitor's "Seen" only follows messages they can see
  if (markSeen && shared.length) {
    await run('UPDATE live_chats SET staff_seen_message_id = GREATEST(staff_seen_message_id, $1) WHERE id = $2', [shared[shared.length - 1].id, c.id]);
    poke(TOPIC); // the visitor's "Seen"
  }
  return {
    chat: {
      id: c.id, reference: c.reference, status: c.status, visitorName: c.visitorName, visitorEmail: c.visitorEmail, pageUrl: c.pageUrl,
      profile: c.profileId && c.profileName ? { id: c.profileId, name: c.profileName, slug: c.profileSlug } : null,
      assignedTo: c.assignedTo, assignedName: c.assignedName,
      createdAt: c.createdAt, closedAt: c.closedAt, lastMessageAt: c.lastMessageAt,
      visitorOnline: c.status === 'Open' && !!c.visitorSeenAt && Date.now() - new Date(c.visitorSeenAt).getTime() < 60_000,
      visitorTyping: c.status === 'Open' && !!c.visitorTypingUntil && new Date(c.visitorTypingUntil) > new Date(),
      rating: c.rating || null, ratingComment: c.ratingComment || '', ratedAt: c.ratedAt, transcriptSentAt: c.transcriptSentAt,
    },
    messages: rows.map(staffShape),
    deleted: await deletedIds(c.id),
  };
}
