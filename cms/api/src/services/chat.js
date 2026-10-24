// Booking chat: the client and the concierge message each other about a confirmed booking.
//
// - Sending is open while the booking is Confirmed. Before that the chat is closed; afterwards it stays readable.
// - The client writes from the booking status page; staff answer from the booking in the CMS.
// - Each side's last-read message id gives unread counts: bookings.client_seen_message_id for the client and
//   bookings.companion_seen_message_id for the desk (the column predates the concierge-only chat).
//   The client is emailed, and staff notified, only for the first unread message, so a conversation doesn't flood inboxes.
// - Older threads may contain messages from the companion (sender 'Companion'); they're shown under the profile name.
import { one, q, run } from '../db/index.js';
import { HttpError } from '../lib/http.js';
import { rateLimit } from '../lib/auth.js';
import { notify } from '../lib/mailer.js';
import { chatMessageToClient } from '../lib/emails.js';
import { notifyStaff } from '../lib/notifications.js';
import { loadSettings } from './settings.js';
import { encryptText } from '../lib/encryption.js';

// viewer/sender → the column holding their last-read message id
const SEEN = { Client: 'client_seen_message_id', Concierge: 'companion_seen_message_id', Staff: 'companion_seen_message_id' };
const MAX = 2000;

/** Whether the booking has a chat at all, whether it takes new messages, and what to tell the user if not. */
export function chatState(b) {
  if (b.kind !== 'Booking') return null;
  if (b.status === 'Confirmed') return { open: true, note: null };
  if (b.status === 'Pending') return { open: false, note: 'The chat opens once the booking is confirmed.' };
  return { open: false, note: 'This booking is closed, so the chat is read-only.' };
}

// How a message is labelled for each viewer: 'Client' | 'Staff'.
function shape(m, viewer, b) {
  const mine = viewer === 'Client' ? m.sender === 'Client' : m.sender === 'Concierge';
  let name;
  if (m.sender === 'Concierge') name = viewer === 'Staff' && m.author ? `Concierge (${m.author})` : 'Concierge';
  else if (m.sender === 'Companion') name = b.profileName;
  else name = b.clientName;
  return { id: m.id, from: mine ? 'me' : m.sender === 'Client' ? 'them' : 'concierge', sender: m.sender, name, body: m.body, at: m.createdAt };
}

/**
 * Messages after `after` (an id) for this viewer, plus the chat state. Reading marks them seen for that side.
 * b: SELECT_BOOKING row.
 */
export async function readChat(b, viewer, after = 0) {
  const state = chatState(b);
  if (!state) throw new HttpError(404, 'This request has no chat.');
  const rows = await q('SELECT id, sender, author, body, created_at FROM booking_messages WHERE booking_id = $1 AND id > $2 ORDER BY id LIMIT 500',
    [b.id, Math.max(0, Number(after) || 0)]);
  if (rows.length) {
    await run(`UPDATE bookings SET ${SEEN[viewer]} = GREATEST(${SEEN[viewer]}, $1) WHERE id = $2`, [rows[rows.length - 1].id, b.id]);
  }
  return { ...state, messages: rows.map((m) => shape(m, viewer, b)) };
}

/** Adds a message from 'Client' or 'Concierge' (staff, with authorName) and tells the other side if needed. */
export async function sendChat(b, sender, text, authorName = null) {
  const body = String(text ?? '').replace(/\r\n/g, '\n').trim();
  if (!body) throw new HttpError(422, 'Write a message first.', { body: 'Write a message first.' });
  if (body.length > MAX) throw new HttpError(422, `Messages can be up to ${MAX} characters.`, { body: `Up to ${MAX} characters.` });
  const state = chatState(b);
  if (!state) throw new HttpError(404, 'This request has no chat.');
  // staff can still add a note to a closed thread; the client can't
  if (!state.open && sender !== 'Concierge') throw new HttpError(409, state.note);
  await rateLimit(`chat:${sender}:${b.id}`, 30, 10 * 60000);

  const m = await one('INSERT INTO booking_messages (booking_id, sender, author, body) VALUES ($1, $2, $3, $4) RETURNING id',
    [b.id, sender, authorName ? String(authorName).slice(0, 150) : null, encryptText(body)]); // stored encrypted (lib/encryption.js)
  await run(`UPDATE bookings SET ${SEEN[sender]} = GREATEST(${SEEN[sender]}, $1) WHERE id = $2`, [m.id, b.id]);

  // the other side: only for the first message they haven't read
  const other = sender === 'Client' ? 'Concierge' : 'Client';
  const { n } = await one(`SELECT COUNT(*)::int AS n FROM booking_messages bm JOIN bookings bk ON bk.id = bm.booking_id
    WHERE bm.booking_id = $1 AND bm.sender <> $2 AND bm.id > bk.${SEEN[other]}`, [b.id, other]);
  if (n === 1) {
    if (other === 'Client') await notify(chatMessageToClient(await loadSettings(), b));
    else await notifyStaff({ type: 'booking_message', module: 'bookings', link: `/bookings/${b.id}`, title: `New message from ${b.clientName}`, body: `Booking ${b.reference} · open the booking to reply.` });
  }
  return m.id;
}

/** Message counts for a side, keyed by booking id: { [bookingId]: { total, unread } }. `where` is a fixed column name. */
export async function messageCounts(viewer, where, value) {
  const rows = await q(`SELECT bm.booking_id, COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE bm.sender <> $2 AND bm.id > b.${SEEN[viewer]})::int AS unread
    FROM booking_messages bm JOIN bookings b ON b.id = bm.booking_id WHERE ${where} = $1 GROUP BY bm.booking_id`, [value, viewer === 'Client' ? 'Client' : 'Concierge']);
  return Object.fromEntries(rows.map((r) => [r.bookingId, { total: r.total, unread: r.unread }]));
}
