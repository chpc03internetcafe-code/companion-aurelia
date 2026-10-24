// Live chat between website visitors and the concierge desk.
//
// - A visitor (guest or signed-in member) starts a chat from the website widget. Their browser gets a random
//   token in an httpOnly cookie; only its SHA-256 is stored, so the chat can't be opened from anywhere else.
// - Staff with the Contact Messages permission answer in the CMS (Live chat). Messages are stored encrypted.
// - Both sides long-poll for new messages (lib/longpoll.js), so it works on Vercel without WebSockets.
// - Staff are notified when a chat starts (or a quiet chat wakes up); the message text never goes into
//   notifications, emails or the audit trail.
// - If the visitor has left when staff reply and gave an email, they get a "you have a reply" email (no text).
import crypto from 'node:crypto';
import { one, params, q, run, tx } from '../db/index.js';
import { HttpError } from '../lib/http.js';
import { readCookie, sha256, writeCookie } from '../lib/auth.js';
import { encryptText } from '../lib/encryption.js';
import { newReference } from '../lib/refs.js';
import { poke } from '../lib/longpoll.js';
import { notifyStaff } from '../lib/notifications.js';
import { notify } from '../lib/mailer.js';
import { liveChatReply } from '../lib/emails.js';
import { cached } from '../lib/cache.js';
import { loadSettings } from './settings.js';

export const COOKIE = 'aurelia_chat';
const COOKIE_DAYS = 30;
export const MAX_LENGTH = 2000;
export const TOPIC = 'live-chat';
const AWAY_MS = 2 * 60_000; // the visitor counts as gone (and is emailed about replies) after this long without checking in

const SELECT = `SELECT c.*, u.full_name AS assigned_name, m.member_no, m.full_name AS member_name
  FROM live_chats c LEFT JOIN admin_users u ON u.id = c.assigned_to LEFT JOIN members m ON m.id = c.member_id`;

export function cleanText(text) {
  const body = String(text ?? '').replace(/\r\n/g, '\n').trim();
  if (!body) throw new HttpError(422, 'Write a message first.', { body: 'Write a message first.' });
  if (body.length > MAX_LENGTH) throw new HttpError(422, `Messages can be up to ${MAX_LENGTH} characters.`, { body: `Up to ${MAX_LENGTH} characters.` });
  return body;
}

// ---------- Visitor side ----------
/** The chat this browser belongs to (by its cookie), or null. */
export async function visitorChat(req) {
  const token = readCookie(req, COOKIE);
  if (!token || token.length < 32) return null;
  return one(`${SELECT} WHERE c.token_hash = $1`, [sha256(token)]);
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

/** Starts a chat for this browser with its first message, and sets the cookie. */
export async function startChat(req, res, { name, email, message, page, memberId }) {
  const body = cleanText(message);
  const token = crypto.randomBytes(32).toString('base64url');
  const chat = await tx(async (db) => {
    const reference = await newReference(db, 'CHAT', 'live_chats', 'reference');
    const c = await db.one(`INSERT INTO live_chats (reference, token_hash, member_id, visitor_name, visitor_email, page_url, visitor_seen_at)
      VALUES ($1, $2, $3, $4, $5, $6, now()) RETURNING id, reference`, [reference, sha256(token), memberId || null, name, email || null, page || null]);
    const m = await db.one("INSERT INTO live_chat_messages (chat_id, sender, body) VALUES ($1, 'Visitor', $2) RETURNING id", [c.id, encryptText(body)]);
    await db.run('UPDATE live_chats SET visitor_seen_message_id = $1 WHERE id = $2', [m.id, c.id]);
    return c;
  });
  writeCookie(req, res, COOKIE, token, COOKIE_DAYS * 86400);
  await notifyStaff({ type: 'live_chat', module: 'inquiries', link: `/live-chat/${chat.id}`, title: `Live chat from ${name}`, body: `${chat.reference} · a visitor is waiting for a reply.` });
  poke(TOPIC);
  return one(`${SELECT} WHERE c.id = $1`, [chat.id]);
}

const visitorShape = (m) => ({ id: m.id, from: m.sender === 'Visitor' ? 'me' : m.sender === 'Staff' ? 'staff' : 'system', name: m.sender === 'Staff' ? 'Concierge' : null, body: m.body, at: m.createdAt });
export const publicChat = (c) => ({ reference: c.reference, status: c.status, name: c.visitorName, email: c.visitorEmail, startedAt: c.createdAt });

/** Messages after `after` for the visitor; marks them seen. Returns null when there's nothing new (for long polling). */
export async function visitorMessages(c, after = 0, { onlyNew = false } = {}) {
  const rows = await q('SELECT id, sender, body, created_at FROM live_chat_messages WHERE chat_id = $1 AND id > $2 ORDER BY id LIMIT 500', [c.id, Math.max(0, Number(after) || 0)]);
  const status = (await one('SELECT status FROM live_chats WHERE id = $1', [c.id]))?.status || c.status;
  run(`UPDATE live_chats SET visitor_seen_at = now()${rows.length ? ', visitor_seen_message_id = GREATEST(visitor_seen_message_id, $2)' : ''} WHERE id = $1`,
    rows.length ? [c.id, rows[rows.length - 1].id] : [c.id]).catch(() => {});
  if (onlyNew && !rows.length && status === c.status) return null;
  return { chat: publicChat({ ...c, status }), messages: rows.map(visitorShape) };
}

// ---------- Both sides ----------
/** Adds a message. sender: 'Visitor' | 'Staff' (with admin) | 'System'. */
export async function addMessage(c, sender, text, admin = null) {
  const body = sender === 'System' ? text : cleanText(text);
  const m = await one('INSERT INTO live_chat_messages (chat_id, sender, author_id, author, body) VALUES ($1, $2, $3, $4, $5) RETURNING id',
    [c.id, sender, admin?.id || null, admin?.name?.slice(0, 150) || null, encryptText(body)]);
  const seen = sender === 'Visitor' ? ', visitor_seen_message_id = $2, visitor_seen_at = now()' : sender === 'Staff' ? ', staff_seen_message_id = $2' : '';
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
    const v = await one(`SELECT visitor_seen_at, (SELECT COUNT(*)::int FROM live_chat_messages WHERE chat_id = $1 AND sender = 'Staff' AND id > lc.visitor_seen_message_id) AS unread
      FROM live_chats lc WHERE id = $1`, [c.id]);
    const away = !v.visitorSeenAt || Date.now() - new Date(v.visitorSeenAt).getTime() > AWAY_MS;
    if (away && v.unread === 1) await notify(liveChatReply(await loadSettings(), c));
  }
  return m.id;
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
const staffShape = (m) => ({ id: m.id, sender: m.sender, name: m.sender === 'Staff' ? m.author || 'Concierge' : m.sender === 'Visitor' ? null : 'System', body: m.body, at: m.createdAt });

const unreadSql = `(SELECT COUNT(*)::int FROM live_chat_messages lm WHERE lm.chat_id = c.id AND lm.sender = 'Visitor' AND lm.id > c.staff_seen_message_id)`;

/** ?status=Open|Closed|all &search &mine (assigned to this admin). */
export async function listChats(admin, { status = 'Open', search, mine, limit = 100 } = {}) {
  const p = params();
  const where = [];
  if (['Open', 'Closed'].includes(status)) where.push(`c.status = ${p.add(status)}`);
  if (mine) where.push(`c.assigned_to = ${p.add(admin.id)}`);
  if (search) {
    const s = p.add(`%${search}%`);
    where.push(`(c.reference ILIKE ${s} OR c.visitor_name ILIKE ${s} OR c.visitor_email ILIKE ${s} OR m.member_no ILIKE ${s})`);
  }
  const rows = await q(`SELECT c.*, u.full_name AS assigned_name, m.member_no, ${unreadSql} AS unread, last.body AS last_body, last.sender AS last_sender
    FROM live_chats c LEFT JOIN admin_users u ON u.id = c.assigned_to LEFT JOIN members m ON m.id = c.member_id
    LEFT JOIN LATERAL (SELECT lm.body, lm.sender FROM live_chat_messages lm WHERE lm.chat_id = c.id ORDER BY lm.id DESC LIMIT 1) last ON TRUE
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY (c.status = 'Open') DESC, c.last_message_at DESC LIMIT ${p.add(Math.min(limit, 200))}`, p.values);
  const cut = (t) => { const s = String(t || '').replace(/\s+/g, ' '); return s.length > 120 ? `${s.slice(0, 119).trimEnd()}…` : s; };
  return rows.map((r) => ({
    id: r.id, reference: r.reference, status: r.status, visitorName: r.visitorName, visitorEmail: r.visitorEmail,
    memberId: r.memberId, memberNo: r.memberNo, assignedTo: r.assignedTo, assignedName: r.assignedName, unread: r.unread,
    lastMessageAt: r.lastMessageAt, createdAt: r.createdAt, preview: r.lastBody ? cut(r.lastBody) : '', lastSender: r.lastSender,
    visitorOnline: r.status === 'Open' && !!r.visitorSeenAt && Date.now() - new Date(r.visitorSeenAt).getTime() < 60_000,
  }));
}

/** Open chats and unread visitor messages, for the CMS badge. */
export const chatStats = () => one(`SELECT COUNT(*) FILTER (WHERE c.status = 'Open')::int AS open,
    COALESCE(SUM(${unreadSql}) FILTER (WHERE c.status = 'Open'), 0)::int AS unread,
    COUNT(*) FILTER (WHERE c.status = 'Open' AND ${unreadSql} > 0)::int AS waiting FROM live_chats c`);

export const latestMessageId = async () => (await one('SELECT COALESCE(MAX(id), 0)::int AS id FROM live_chat_messages')).id;

export async function loadChat(id) {
  const c = await one(`${SELECT} WHERE c.id = $1`, [id]);
  if (!c) throw new HttpError(404, 'Chat not found.');
  return c;
}

/** The chat with messages after `after` for staff; marks visitor messages seen when markSeen. */
export async function staffThread(c, after = 0, markSeen = true) {
  const rows = await q('SELECT id, sender, author, body, created_at FROM live_chat_messages WHERE chat_id = $1 AND id > $2 ORDER BY id LIMIT 1000', [c.id, Math.max(0, Number(after) || 0)]);
  if (markSeen && rows.length) await run('UPDATE live_chats SET staff_seen_message_id = GREATEST(staff_seen_message_id, $1) WHERE id = $2', [rows[rows.length - 1].id, c.id]);
  return {
    chat: {
      id: c.id, reference: c.reference, status: c.status, visitorName: c.visitorName, visitorEmail: c.visitorEmail, pageUrl: c.pageUrl,
      memberId: c.memberId, memberNo: c.memberNo, memberName: c.memberName, assignedTo: c.assignedTo, assignedName: c.assignedName,
      createdAt: c.createdAt, closedAt: c.closedAt, lastMessageAt: c.lastMessageAt,
      visitorOnline: c.status === 'Open' && !!c.visitorSeenAt && Date.now() - new Date(c.visitorSeenAt).getTime() < 60_000,
    },
    messages: rows.map(staffShape),
  };
}
