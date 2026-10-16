// Booking chat: the client and the companion message each other about a confirmed booking.
//
// - Sending is open while the booking is Confirmed. Before that the chat is closed; afterwards it stays readable.
// - Staff read every thread in the CMS and can write as the concierge.
// - Each side's last-read message id (bookings.client_seen_message_id / companion_seen_message_id) gives unread
//   counts. The other side is emailed only for the first unread message, so a conversation doesn't flood inboxes.
// - The companion sees the client's first name only, like everywhere else in the portal.
import { one, q, run } from '../db/index.js';
import { HttpError } from '../lib/http.js';
import { rateLimit } from '../lib/auth.js';
import { notify } from '../lib/mailer.js';
import { chatMessageToClient, chatMessageToCompanion } from '../lib/emails.js';
import { loadSettings } from './settings.js';

export const PARTIES = ['Client', 'Companion'];
const SEEN = { Client: 'client_seen_message_id', Companion: 'companion_seen_message_id' };
const MAX = 2000;
const firstName = (n) => String(n || '').trim().split(/\s+/)[0];

/** Whether the booking has a chat at all, whether it takes new messages, and what to tell the user if not. */
export function chatState(b) {
  if (b.kind !== 'Booking') return null;
  if (b.status === 'Confirmed') return { open: true, note: null };
  if (b.status === 'Pending') return { open: false, note: 'The chat opens once the booking is confirmed.' };
  return { open: false, note: 'This booking is closed, so the chat is read-only.' };
}

// How a message is labelled for each viewer: 'Client' | 'Companion' | 'Staff'.
function shape(m, viewer, b) {
  const mine = m.sender === viewer;
  let name;
  if (m.sender === 'Concierge') name = viewer === 'Staff' && m.author ? `Concierge (${m.author})` : 'Concierge';
  else if (m.sender === 'Companion') name = b.profileName;
  else name = viewer === 'Companion' ? firstName(b.clientName) : b.clientName;
  return { id: m.id, from: mine ? 'me' : m.sender === 'Concierge' ? 'concierge' : 'them', sender: m.sender, name, body: m.body, at: m.createdAt };
}

/**
 * Messages after `after` (an id) for this viewer, plus the chat state. Reading marks them seen for a party.
 * b: SELECT_BOOKING row.
 */
export async function readChat(b, viewer, after = 0) {
  const state = chatState(b);
  if (!state) throw new HttpError(404, 'This request has no chat.');
  const rows = await q('SELECT id, sender, author, body, created_at FROM booking_messages WHERE booking_id = $1 AND id > $2 ORDER BY id LIMIT 500',
    [b.id, Math.max(0, Number(after) || 0)]);
  if (rows.length && SEEN[viewer]) {
    await run(`UPDATE bookings SET ${SEEN[viewer]} = GREATEST(${SEEN[viewer]}, $1) WHERE id = $2`, [rows[rows.length - 1].id, b.id]);
  }
  return { ...state, messages: rows.map((m) => shape(m, viewer, b)) };
}

/** Adds a message from 'Client', 'Companion' or 'Concierge' (staff, with authorName) and emails the other side if needed. */
export async function sendChat(b, sender, text, authorName = null) {
  const body = String(text ?? '').replace(/\r\n/g, '\n').trim();
  if (!body) throw new HttpError(422, 'Write a message first.', { body: 'Write a message first.' });
  if (body.length > MAX) throw new HttpError(422, `Messages can be up to ${MAX} characters.`, { body: `Up to ${MAX} characters.` });
  const state = chatState(b);
  if (!state) throw new HttpError(404, 'This request has no chat.');
  // staff can still add a note to a closed thread; the client and companion can't
  if (!state.open && sender !== 'Concierge') throw new HttpError(409, state.note);
  rateLimit(`chat:${sender}:${b.id}`, 30, 10 * 60000);

  const m = await one('INSERT INTO booking_messages (booking_id, sender, author, body) VALUES ($1, $2, $3, $4) RETURNING id',
    [b.id, sender, authorName ? String(authorName).slice(0, 150) : null, body]);
  if (SEEN[sender]) await run(`UPDATE bookings SET ${SEEN[sender]} = GREATEST(${SEEN[sender]}, $1) WHERE id = $2`, [m.id, b.id]);

  // email each other party for whom this is the only unread message
  const site = await loadSettings();
  for (const party of PARTIES.filter((p) => p !== sender)) {
    const { n } = await one(`SELECT COUNT(*)::int AS n FROM booking_messages bm JOIN bookings bk ON bk.id = bm.booking_id
      WHERE bm.booking_id = $1 AND bm.sender <> $2 AND bm.id > bk.${SEEN[party]}`, [b.id, party]);
    if (n !== 1) continue;
    if (party === 'Client') await notify(chatMessageToClient(site, b));
    else {
      const a = await one(`SELECT ca.email, p.display_name AS name FROM companion_accounts ca JOIN profiles p ON p.id = ca.profile_id
        WHERE ca.profile_id = $1 AND ca.status = 'Active'`, [b.profileId]);
      if (a) await notify(chatMessageToCompanion(site, a, b));
    }
  }
  return m.id;
}

/** Message counts for a party, keyed by booking id: { [bookingId]: { total, unread } }. `where` is a fixed column name. */
export async function messageCounts(party, where, value) {
  const rows = await q(`SELECT bm.booking_id, COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE bm.sender <> $2 AND bm.id > b.${SEEN[party]})::int AS unread
    FROM booking_messages bm JOIN bookings b ON b.id = bm.booking_id WHERE ${where} = $1 GROUP BY bm.booking_id`, [value, party]);
  return Object.fromEntries(rows.map((r) => [r.bookingId, { total: r.total, unread: r.unread }]));
}
