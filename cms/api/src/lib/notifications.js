// Staff notifications for website activity (booking requests, cancellations, booking chat, contact messages, live chat).
//
// - notifyStaff() stores one notification. Each belongs to a CMS module and is shown only to staff
//   whose role can view that module. Read state is per staff member (notification_reads).
// - The CMS gets them in near real time by long-polling GET /api/notifications/wait: the request
//   stays open until something newer than the client's last id exists, or ~20 s pass. Works on
//   Vercel (no WebSockets) and across instances, because every instance checks the database.
//   Within one instance (local dev) waiters are also woken immediately through an in-process event.
import { EventEmitter } from 'node:events';
import { params, q, run } from '../db/index.js';
import { longDate, time12 } from './dates.js';

export const NOTIFICATION_MODULES = ['bookings', 'inquiries'];
const KEEP_DAYS = 90;

export const bus = new EventEmitter();
bus.setMaxListeners(0);

export async function notifyStaff(n) {
  try {
    await run('INSERT INTO notifications (type, module, title, body, link) VALUES ($1, $2, $3, $4, $5)', [
      n.type.slice(0, 30), n.module, n.title.slice(0, 200), n.body?.slice(0, 500) ?? null, n.link?.slice(0, 200) ?? null,
    ]);
    await run(`DELETE FROM notifications WHERE created_at < now() - INTERVAL '${KEEP_DAYS} days'`);
    bus.emit('new');
  } catch (err) {
    console.error('[notifications] could not store notification:', err.message);
  }
}

const when = (b) => (b.bookingDate ? `${longDate(b.bookingDate)} ${time12(b.startTime)}` : 'no date yet');

// ---------- Messages for each website event ----------
// b: { id, reference, kind, clientName, profileName, rateLabel, bookingDate, startTime, reason }
export const bookingNote = (b) => ({
  type: b.kind === 'Inquiry' ? 'inquiry_profile' : 'booking_requested', module: 'bookings', link: `/bookings/${b.id}`,
  title: `${b.kind === 'Inquiry' ? 'New inquiry' : 'New booking request'} ${b.reference}`,
  body: `${b.clientName} · ${b.profileName}${b.rateLabel ? ` · ${b.rateLabel}` : ''} · ${when(b)}${b.memberNo ? ` · member ${b.memberNo}` : ''}`,
});
export const bookingCancelledNote = (b) => ({
  type: 'booking_cancelled', module: 'bookings', link: `/bookings/${b.id}`,
  title: `Booking ${b.reference} cancelled by the client`,
  body: `${b.clientName} · ${b.profileName} · ${when(b)}${b.reason ? ` · “${b.reason}”` : ''}`,
});
export const bookingRescheduledNote = (b) => ({
  type: 'booking_rescheduled', module: 'bookings', link: `/bookings/${b.id}`,
  title: `Booking ${b.reference} rescheduled by the client`,
  body: `${b.clientName} · ${b.profileName} · now ${when(b)}`,
});

export const inquiryNote = (i) => ({
  type: 'inquiry_received', module: 'inquiries', link: `/inquiries?search=${encodeURIComponent(i.reference)}`,
  title: `New message ${i.reference}`,
  body: `${i.name} · ${i.subject}`,
});

// ---------- Reading (per staff member) ----------
const visible = (admin) => NOTIFICATION_MODULES.filter((m) => ['view', 'manage'].includes(admin.permissions[m]));

function scope(p, admin) {
  const mods = visible(admin);
  if (!mods.length) return 'FALSE';
  return `n.module IN (${mods.map((m) => p.add(m)).join(', ')})`;
}

export async function listNotifications(admin, { afterId, beforeId, unreadOnly, module, limit = 30 } = {}) {
  const p = params([admin.id]);
  const where = [scope(p, admin)];
  if (afterId) where.push(`n.id > ${p.add(afterId)}`);
  if (beforeId) where.push(`n.id < ${p.add(beforeId)}`);
  if (unreadOnly) where.push('nr.user_id IS NULL');
  if (module && NOTIFICATION_MODULES.includes(module)) where.push(`n.module = ${p.add(module)}`);
  const lim = p.add(Math.min(Math.max(limit, 1), 100));
  return q(
    `SELECT n.id, n.type, n.module, n.title, n.body, n.link, n.created_at, (nr.user_id IS NOT NULL) AS is_read
     FROM notifications n
     LEFT JOIN notification_reads nr ON nr.notification_id = n.id AND nr.user_id = $1
     WHERE ${where.join(' AND ')}
     ORDER BY n.id DESC LIMIT ${lim}`,
    p.values
  );
}

export async function unreadCount(admin) {
  const p = params([admin.id]);
  const rows = await q(
    `SELECT COUNT(*)::int AS n FROM notifications n
     WHERE ${scope(p, admin)} AND NOT EXISTS (SELECT 1 FROM notification_reads nr WHERE nr.notification_id = n.id AND nr.user_id = $1)`,
    p.values
  );
  return rows[0].n;
}

export async function latestId(admin) {
  const p = params();
  return (await q(`SELECT COALESCE(MAX(n.id), 0) AS id FROM notifications n WHERE ${scope(p, admin)}`, p.values))[0].id;
}

/** ids: array of notification ids, or 'all' for everything this admin can see. */
export async function markRead(admin, ids) {
  const p = params([admin.id]);
  const where = [scope(p, admin)];
  if (ids !== 'all') {
    const list = (Array.isArray(ids) ? ids : []).map(Number).filter(Number.isInteger).slice(0, 200);
    if (!list.length) return;
    where.push(`n.id IN (${list.map((id) => p.add(id)).join(', ')})`);
  }
  await run(
    `INSERT INTO notification_reads (notification_id, user_id)
     SELECT n.id, $1 FROM notifications n WHERE ${where.join(' AND ')}
     ON CONFLICT DO NOTHING`,
    p.values
  );
}
