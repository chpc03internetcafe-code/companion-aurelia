// Sample client ↔ concierge chats on confirmed bookings, so the chat can be tried without typing.
//   npm run db:seed:chat      adds them to the database in DATABASE_URL (Supabase) or the local one
// Also runs at the end of `npm run db:seed`. Creates the chat table first if it's missing (same as db:init).
// Does nothing when the database already has chat messages, so it's safe to run again. No emails are sent.
//
// Each thread ends with an unread reply for the client, so the "new message" badges show too.
import '../env.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { closeDb, one, q, run } from './index.js';
import { encryptMessages } from './encrypt-messages.js';
import { initDb } from './init.js';

const first = (n) => String(n || '').trim().split(/\s+/)[0];

// [sender, text, minutes before now]; {client} / {companion} / {place} are filled in per booking
const THREADS = [
  [
    ['Client', 'Hi! Thanks for confirming my booking with {companion}. Looking forward to it.', 1500],
    ['Concierge', 'Hi {client}, you’re welcome! Is {place} still the plan?', 1440],
    ['Client', 'Yes, same place. I’ll be at the lobby lounge a few minutes early.', 1380],
    ['Concierge', 'Perfect. {companion} will meet you there — we’ll message here if anything changes.', 120],
  ],
  [
    ['Concierge', 'Hello {client}, your booking with {companion} is confirmed. Anything we should know beforehand?', 2900],
    ['Client', 'Hi! Nothing special — maybe dinner first if that works?', 2800],
    ['Concierge', 'Of course. Happy to reserve a table nearby if you’d like.', 2700],
    ['Client', 'That would be great, thank you!', 2650],
    ['Concierge', 'Done — a table for two at 7 PM. See the details in your booking.', 45],
  ],
  [
    ['Client', 'Quick question — is smart casual fine for the dress code?', 600],
    ['Concierge', 'Smart casual is perfect. Enjoy your evening!', 30],
  ],
];

export async function seedChat({ log = console.log, max = THREADS.length } = {}) {
  if (await one('SELECT 1 AS x FROM booking_messages LIMIT 1')) {
    log('• Chat messages already exist — skipping demo chats.');
    return 0;
  }
  const bookings = await q(`SELECT b.id, b.client_name, b.meeting_place, p.display_name, l.name AS location_name
    FROM bookings b JOIN profiles p ON p.id = b.profile_id LEFT JOIN locations l ON l.id = b.location_id
    WHERE b.kind = 'Booking' AND b.status = 'Confirmed' AND b.starts_at > ph_now()
    ORDER BY b.starts_at LIMIT $1`, [max]);
  if (!bookings.length) {
    log('• No confirmed upcoming bookings — nothing to add.');
    return 0;
  }
  let count = 0;
  for (const [i, b] of bookings.entries()) {
    const fill = (s) => s.replace('{client}', first(b.clientName)).replace('{companion}', b.displayName)
      .replace('{place}', b.meetingPlace || b.locationName || 'the venue');
    let lastClientSeen = 0;
    let lastDeskSeen = 0;
    const thread = THREADS[i % THREADS.length];
    for (const [n, [sender, text, minutesAgo]] of thread.entries()) {
      const m = await one(`INSERT INTO booking_messages (booking_id, sender, author, body, created_at)
        VALUES ($1, $2, $3, $4, now() - make_interval(mins => $5)) RETURNING id`,
      [b.id, sender, sender === 'Concierge' ? 'Demo data' : null, fill(text), minutesAgo]);
      const last = n === thread.length - 1;
      // the desk has read everything; the client hasn't seen the final reply yet
      lastDeskSeen = m.id;
      if (!last) lastClientSeen = m.id;
      count += 1;
    }
    await run('UPDATE bookings SET client_seen_message_id = $1, companion_seen_message_id = $2 WHERE id = $3', [lastClientSeen, lastDeskSeen, b.id]);
  }
  await encryptMessages({ quiet: true });
  log(`✓ Demo chats: ${count} messages on ${bookings.length} confirmed booking${bookings.length === 1 ? '' : 's'}`);
  return count;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  (async () => {
    await initDb();
    await seedChat();
    await closeDb();
  })().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
