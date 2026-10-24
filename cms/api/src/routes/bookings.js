// CMS: booking requests and profile inquiries.
import { Router } from 'express';
import { one, params, q, run, tx } from '../db/index.js';
import { HttpError, idParam, paging, sendCsv, wrap } from '../lib/http.js';
import { validate } from '../lib/validate.js';
import { isIsoDate } from '../lib/dates.js';
import { notify } from '../lib/mailer.js';
import { bookingMessage, bookingReceived, bookingStatusChanged } from '../lib/emails.js';
import { logEvent } from '../lib/audit.js';
import { bookingRules, loadSettings } from '../services/settings.js';
import { dayAvailability, openDays } from '../services/availability.js';
import {
  addEvent, assertTransition, BOOKING_SOURCES, CONTACT_METHODS, createBooking, loadBooking, loadEvents, moveBooking, parseFees, publicBooking, quote, SELECT_BOOKING, TRANSITIONS,
} from '../services/bookings.js';
import { readChat, sendChat } from '../services/chat.js';
import { encryptText } from '../lib/encryption.js';

const router = Router();

function filters(query) {
  const p = params();
  const where = [];
  if (query.kind === 'Booking' || query.kind === 'Inquiry') where.push(`b.kind = ${p.add(query.kind)}`);
  if (query.status === 'Open') where.push("b.status IN ('Pending','Confirmed')");
  else if (query.status) where.push(`b.status = ${p.add(query.status)}`);
  if (query.profileId) where.push(`b.profile_id = ${p.add(Number(query.profileId))}`);
  if (query.source) where.push(`b.source = ${p.add(query.source)}`);
  if (isIsoDate(query.from)) where.push(`b.booking_date >= ${p.add(query.from)}`);
  if (isIsoDate(query.to)) where.push(`b.booking_date <= ${p.add(query.to)}`);
  if (query.upcoming === '1') where.push("b.booking_date >= ph_today()");
  if (query.search) {
    const s = p.add(`%${String(query.search).trim()}%`);
    where.push(`(b.reference ILIKE ${s} OR b.client_name ILIKE ${s} OR b.client_email ILIKE ${s} OR b.client_phone ILIKE ${s} OR p.display_name ILIKE ${s})`);
  }
  return { p, w: where.length ? `WHERE ${where.join(' AND ')}` : '' };
}

const ORDER = {
  upcoming: 'b.starts_at ASC NULLS LAST, b.created_at',
  newest: 'b.created_at DESC',
  date_desc: 'b.starts_at DESC NULLS LAST, b.created_at DESC',
};

router.get('/', wrap(async (req, res) => {
  const { page, pageSize, offset } = paging(req.query);
  const { p, w } = filters(req.query);
  const { total } = await one(`SELECT COUNT(*)::int AS total FROM bookings b JOIN profiles p ON p.id = b.profile_id ${w}`, p.values);
  const items = await q(`${SELECT_BOOKING} ${w} ORDER BY ${ORDER[req.query.sort] || ORDER.newest} LIMIT ${p.add(pageSize)} OFFSET ${p.add(offset)}`, p.values);
  res.json({ items: items.map(parseFees), total, page, pageSize });
}));

router.get('/export', wrap(async (req, res) => {
  const { p, w } = filters(req.query);
  const rows = await q(`${SELECT_BOOKING} ${w} ORDER BY b.starts_at DESC NULLS LAST, b.created_at DESC LIMIT 10000`, p.values);
  sendCsv(res, `bookings-${new Date().toISOString().slice(0, 10)}.csv`,
    ['Reference', 'Kind', 'Status', 'Profile', 'Session', 'Date', 'Time', 'Location', 'Client', 'Email', 'Phone', 'Rate', 'Fees', 'Total', 'Source', 'Created'],
    rows.map((b) => [b.reference, b.kind, b.status, b.profileName, b.rateLabel, b.bookingDate, b.startTime, b.locationName, b.clientName, b.clientEmail, b.clientPhone, b.ratePrice, b.feesTotal, b.total, b.source, b.createdAt]));
}));

router.get('/stats', wrap(async (_req, res) => {
  res.json(await one(`SELECT
      COUNT(*) FILTER (WHERE status = 'Pending' AND kind = 'Booking')::int AS pending,
      COUNT(*) FILTER (WHERE status = 'Pending' AND kind = 'Inquiry')::int AS inquiries,
      COUNT(*) FILTER (WHERE status = 'Confirmed' AND booking_date = ph_today())::int AS today,
      COUNT(*) FILTER (WHERE status = 'Confirmed' AND booking_date > ph_today())::int AS upcoming,
      COUNT(*) FILTER (WHERE status = 'Completed' AND booking_date >= date_trunc('month', ph_today())::date)::int AS completed_month
    FROM bookings`));
}));

// Staff helpers: live slots for (re)scheduling and the price for a rate.
router.get('/slots', wrap(async (req, res) => {
  const profileId = Number(req.query.profileId);
  const r = Number(req.query.rateId) ? await one('SELECT duration_minutes FROM profile_rates WHERE id = $1 AND profile_id = $2', [Number(req.query.rateId), profileId]) : null;
  const duration = Number(req.query.duration) || r?.durationMinutes;
  if (!duration) throw new HttpError(422, 'Choose a session length.');
  if (req.query.days) return res.json(await openDays({ profileId, durationMinutes: duration, from: req.query.from, days: Math.min(Number(req.query.days), 31), excludeBookingId: Number(req.query.exclude) || null }));
  res.json(await dayAvailability({ profileId, durationMinutes: duration, date: req.query.date, excludeBookingId: Number(req.query.exclude) || null }));
}));

router.post('/quote', wrap(async (req, res) => {
  const r = await quote({ one, q }, { profileId: Number(req.body.profileId), rateId: Number(req.body.rateId), locationId: Number(req.body.locationId) || null });
  res.json({ rateLabel: r.rate.label, durationMinutes: r.rate.durationMinutes, ratePrice: r.ratePrice, fees: r.fees, feesTotal: r.feesTotal, total: r.total });
}));

async function detail(id) {
  const b = await loadBooking({ one }, 'b.id', id);
  if (!b) throw new HttpError(404, 'Booking not found.');
  return { ...b, events: await loadEvents({ q }, id), transitions: TRANSITIONS[b.kind][b.status] || [], chat: b.kind === 'Booking' ? await readChat(b, 'Staff') : null };
}

router.get('/:id', wrap(async (req, res) => res.json(await detail(idParam(req)))));

// ---------- Staff-created bookings (phone / messaging) ----------
const createSchema = {
  kind: { type: 'enum', values: ['Booking', 'Inquiry'], default: 'Booking' },
  profileId: { type: 'int', required: true, min: 1, message: 'Choose a profile.' },
  rateId: { type: 'int', min: 1 },
  date: { type: 'date' },
  time: { type: 'time' },
  locationId: { type: 'int', min: 1 },
  meetingPlace: { type: 'string', max: 200 },
  clientName: { type: 'string', required: true, max: 150, label: 'Client name' },
  clientEmail: { type: 'email', required: true, label: 'Client email' },
  clientPhone: { type: 'phone' },
  preferredContact: { type: 'enum', values: CONTACT_METHODS, default: 'Email' },
  clientNotes: { type: 'string', max: 2000 },
  staffNotes: { type: 'string', max: 4000 },
  source: { type: 'enum', values: BOOKING_SOURCES, default: 'Phone' },
  status: { type: 'enum', values: ['Pending', 'Confirmed'], default: 'Confirmed' },
  sendEmail: { type: 'bool', virtual: true },
};

router.post('/', wrap(async (req, res) => {
  const d = validate(req.body, createSchema);
  const booking = d.kind === 'Booking';
  let priced = null;
  if (booking) {
    if (!d.rateId || !d.date || !d.time) throw new HttpError(422, 'Choose a session, date and time.', { rateId: d.rateId ? undefined : 'Required.', date: d.date ? undefined : 'Required.', time: d.time ? undefined : 'Required.' });
    priced = await quote({ one, q }, { profileId: d.profileId, rateId: d.rateId, locationId: d.locationId });
    // staff may book outside the online lead time / window, but not on top of another booking
  }
  const { bufferMinutes } = await bookingRules();
  const created = await tx((db) => createBooking(db, {
    ...d, bufferMinutes, rateLabel: priced?.rate.label, durationMinutes: priced?.rate.durationMinutes, ratePrice: priced?.ratePrice, fees: priced?.fees, feesTotal: priced?.feesTotal, total: priced?.total,
    status: booking ? d.status : 'Pending', actor: req.admin.name,
  }));
  req.auditHandled = true;
  const b = await detail(created.id);
  await logEvent({ action: 'Created', module: 'bookings', entityType: d.kind, entityId: b.id, entityLabel: b.reference,
    summary: `Created ${d.kind.toLowerCase()} ${b.reference} for ${b.clientName} with ${b.profileName}${b.bookingDate ? ` on ${b.bookingDate} ${b.startTime}` : ''} (${d.source})` }, req);
  if (req.body.sendEmail) await notify(bookingReceived(await loadSettings(), publicBooking(b, b.events.filter((e) => e.visibleToClient)), b.clientEmail));
  res.status(201).json(b);
}));

// ---------- Changes ----------
const editSchema = {
  clientName: createSchema.clientName,
  clientEmail: createSchema.clientEmail,
  clientPhone: createSchema.clientPhone,
  preferredContact: createSchema.preferredContact,
  locationId: createSchema.locationId,
  meetingPlace: createSchema.meetingPlace,
  clientNotes: createSchema.clientNotes,
  staffNotes: createSchema.staffNotes,
};

router.put('/:id', wrap(async (req, res) => {
  const id = idParam(req);
  const d = validate(req.body, editSchema);
  await run(`UPDATE bookings SET client_name = $1, client_email = $2, client_phone = $3, preferred_contact = $4, location_id = $5, meeting_place = $6,
    client_notes = $7, staff_notes = $8, updated_at = now() WHERE id = $9`,
  [d.clientName, d.clientEmail, d.clientPhone, d.preferredContact, d.locationId, d.meetingPlace, encryptText(d.clientNotes), d.staffNotes, id]);
  res.json(await detail(id));
}));

// body: { status, note?, reason?, notify? }  note is shown to the client and emailed when notify is on.
router.post('/:id/status', wrap(async (req, res) => {
  const id = idParam(req);
  const before = await detail(id);
  const { status, note, reason } = validate(req.body, {
    status: { type: 'enum', values: ['Pending', 'Confirmed', 'Completed', 'Cancelled', 'Declined', 'No-Show', 'Answered', 'Closed'], required: true },
    note: { type: 'string', max: 1000 },
    reason: { type: 'string', max: 300 },
  });
  assertTransition(before, status);
  const { bufferMinutes } = await bookingRules();
  await tx(async (db) => {
    if (before.kind === 'Booking' && status === 'Pending' && before.bookingDate) {
      // restoring: the slot must still be free
      await moveBooking(db, before, { date: before.bookingDate, time: before.startTime, countAsReschedule: false, bufferMinutes });
    }
    await db.run(`UPDATE bookings SET status = $1::text, cancel_reason = CASE WHEN $1::text IN ('Cancelled','Declined') THEN $2::text ELSE NULL END,
      cancelled_by = CASE WHEN $1::text IN ('Cancelled','Declined') THEN 'Staff' ELSE NULL END, updated_at = now() WHERE id = $3`, [status, reason || null, id]);
    const titles = { Confirmed: 'Confirmed by the concierge', Declined: 'Request declined', Cancelled: 'Cancelled by the concierge', Completed: 'Completed', 'No-Show': 'Marked as no-show',
      Pending: 'Reopened', Answered: 'Concierge replied', Closed: 'Closed' };
    await addEvent(db, id, { status, title: titles[status], note: note || reason || null, actor: req.admin.name, visible: status !== 'No-Show' });
  });
  const after = await detail(id);
  if (req.body.notify) {
    const email = bookingStatusChanged(await loadSettings(), publicBooking(after), after.clientEmail, { status, message: note });
    if (email) await notify(email);
  }
  res.json(after);
}));

// body: { date, time, rateId?, note?, notify?, force? }  force skips the online lead time/window (never overlaps).
router.post('/:id/reschedule', wrap(async (req, res) => {
  const id = idParam(req);
  const b = await detail(id);
  if (b.kind !== 'Booking' || !['Pending', 'Confirmed'].includes(b.status)) throw new HttpError(409, 'Only pending or confirmed bookings can be rescheduled.');
  const { date, time, rateId, note } = validate(req.body, { date: { type: 'date', required: true }, time: { type: 'time', required: true }, rateId: { type: 'int', min: 1 }, note: { type: 'string', max: 1000 } });
  let priced = null;
  if (rateId && rateId !== b.rateId) priced = await quote({ one, q }, { profileId: b.profileId, rateId, locationId: b.locationId });
  const duration = priced?.rate.durationMinutes || b.durationMinutes;
  if (!req.body.force) {
    const avail = await dayAvailability({ profileId: b.profileId, durationMinutes: duration, date, excludeBookingId: id });
    if (!avail.slots.includes(time)) throw new HttpError(409, `That time isn’t open (${avail.closed || 'outside availability'}). Tick “Ignore availability” to book it anyway.`, { time: 'Not available.' });
  }
  const { bufferMinutes } = await bookingRules();
  await tx(async (db) => {
    await moveBooking(db, b, { date, time, durationMinutes: duration, countAsReschedule: false, bufferMinutes });
    if (priced) {
      await db.run('UPDATE bookings SET rate_id = $1, rate_label = $2, rate_price = $3, fees = $4, fees_total = $5, total = $6 WHERE id = $7',
        [priced.rate.id, priced.rate.label, priced.ratePrice, JSON.stringify(priced.fees), priced.feesTotal, priced.total, id]);
    }
    await addEvent(db, id, { status: b.status, title: 'New time set by the concierge', note: note || `From ${b.bookingDate} ${b.startTime} to ${date} ${time}`, actor: req.admin.name });
  });
  const after = await detail(id);
  if (req.body.notify) await notify(bookingStatusChanged(await loadSettings(), publicBooking(after), after.clientEmail, { status: 'Rescheduled', message: note }));
  res.json(after);
}));

// A message to the client: added to the timeline (visible on the status page) and optionally emailed.
router.post('/:id/notes', wrap(async (req, res) => {
  const id = idParam(req);
  const { note } = validate(req.body, { note: { type: 'string', required: true, max: 1000, label: 'Message' } });
  const visible = req.body.visible !== false;
  await addEvent({ run }, id, { title: visible ? 'Message from the concierge' : 'Internal note', note, actor: req.admin.name, visible });
  const after = await detail(id);
  if (visible && req.body.notify) await notify(bookingMessage(await loadSettings(), publicBooking(after), after.clientEmail, note));
  res.json(after);
}));

// Chat with the client: staff read it here and reply as the concierge.
router.post('/:id/messages', wrap(async (req, res) => {
  const b = await detail(idParam(req));
  await sendChat(b, 'Concierge', req.body.body, req.admin.name);
  res.status(201).json(await detail(b.id));
}));

router.delete('/:id', wrap(async (req, res) => {
  const b = await detail(idParam(req));
  if (!['Cancelled', 'Declined', 'Closed'].includes(b.status)) throw new HttpError(409, 'Only cancelled, declined or closed requests can be deleted.');
  await run('DELETE FROM bookings WHERE id = $1', [b.id]);
  res.status(204).end();
}));

export default router;
