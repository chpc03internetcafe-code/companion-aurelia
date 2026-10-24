// Booking requests and profile inquiries: quotes (rate + fees), creation, status changes, rescheduling.
import { HttpError } from '../lib/http.js';
import { newReference } from '../lib/refs.js';
import { encryptText } from '../lib/encryption.js';

export const BOOKING_STATUSES = ['Pending', 'Confirmed', 'Completed', 'Cancelled', 'Declined', 'No-Show'];
export const INQUIRY_STATUSES = ['Pending', 'Answered', 'Closed'];
export const BOOKING_SOURCES = ['Online', 'Phone', 'Messaging', 'Staff'];
export const CONTACT_METHODS = ['Email', 'Phone call', 'SMS', 'WhatsApp', 'Telegram', 'Viber'];

// Allowed status changes, per kind.
export const TRANSITIONS = {
  Booking: {
    Pending: ['Confirmed', 'Declined', 'Cancelled'],
    Confirmed: ['Completed', 'No-Show', 'Cancelled'],
    Completed: ['Confirmed'],
    'No-Show': ['Confirmed'],
    Cancelled: ['Pending'],
    Declined: ['Pending'],
  },
  Inquiry: { Pending: ['Answered', 'Closed'], Answered: ['Closed', 'Pending'], Closed: ['Pending'] },
};

export const round2 = (n) => Math.round(Number(n) * 100) / 100;

export const SELECT_BOOKING = `
  SELECT b.id, b.reference, b.kind, b.profile_id, b.rate_id, b.rate_label, b.duration_minutes, b.booking_date,
         to_char(b.start_time, 'HH24:MI') AS start_time, to_char(b.ends_at, 'YYYY-MM-DD') AS end_date, to_char(b.ends_at, 'HH24:MI') AS end_time,
         b.location_id, b.meeting_place, b.client_name, b.client_email, b.client_phone, b.preferred_contact, b.client_notes,
         b.rate_price, b.fees, b.fees_total, b.total, b.status, b.cancel_reason, b.cancelled_by, b.reschedule_count, b.source, b.staff_notes,
         b.created_at, b.updated_at,
         p.display_name AS profile_name, p.slug AS profile_slug, p.status AS profile_status,
         (SELECT url FROM profile_media pm WHERE pm.profile_id = p.id AND pm.kind = 'photo' AND NOT pm.is_hidden ORDER BY pm.is_primary DESC, pm.sort_order, pm.id LIMIT 1) AS profile_photo,
         l.name AS location_name
  FROM bookings b JOIN profiles p ON p.id = b.profile_id
  LEFT JOIN locations l ON l.id = b.location_id`;

export const parseFees = (b) => ({ ...b, fees: typeof b.fees === 'string' ? JSON.parse(b.fees || '[]') : b.fees || [] });

export async function loadBooking(db, where, value) {
  const row = await db.one(`${SELECT_BOOKING} WHERE ${where} = $1`, [value]);
  return row ? parseFees(row) : null;
}

export const loadEvents = (db, bookingId, clientOnly = false) =>
  db.q(`SELECT id, status, title, note, actor, visible_to_client, created_at FROM booking_events WHERE booking_id = $1 ${clientOnly ? 'AND visible_to_client' : ''} ORDER BY created_at, id`, [bookingId]);

export async function addEvent(db, bookingId, { status = null, title, note = null, actor = null, visible = true }) {
  await db.run('INSERT INTO booking_events (booking_id, status, title, note, actor, visible_to_client) VALUES ($1, $2, $3, $4, $5, $6)',
    [bookingId, status, title.slice(0, 150), note ? encryptText(String(note).slice(0, 1000)) : null, actor ? String(actor).slice(0, 150) : null, visible]);
}

/** What the client sees: no staff notes or internal events. */
export function publicBooking(b, events = []) {
  return {
    reference: b.reference, kind: b.kind, status: b.status,
    profile: { name: b.profileName, slug: b.profileStatus === 'Published' ? b.profileSlug : null, photo: b.profilePhoto },
    rateLabel: b.rateLabel, durationMinutes: b.durationMinutes, date: b.bookingDate, time: b.startTime, endDate: b.endDate, endTime: b.endTime,
    locationName: b.locationName, meetingPlace: b.meetingPlace, clientName: b.clientName, clientPhone: b.clientPhone, preferredContact: b.preferredContact,
    notes: b.clientNotes, ratePrice: b.ratePrice, fees: b.fees, feesTotal: b.feesTotal, total: b.total,
    cancelReason: b.cancelReason, rescheduleCount: b.rescheduleCount, createdAt: b.createdAt,
    timeline: events.map((e) => ({ status: e.status, title: e.title, note: e.note, at: e.createdAt })),
  };
}

/** Rate + applicable fees for a profile. Throws when the rate isn't a published one for this profile. */
export async function quote(db, { profileId, rateId, locationId }) {
  const rate = await db.one('SELECT id, label, duration_minutes, price FROM profile_rates WHERE id = $1 AND profile_id = $2 AND is_active', [rateId, profileId]);
  if (!rate) throw new HttpError(422, 'Choose one of the published session lengths.', { rateId: 'Choose a session length.' });
  const fees = await db.q('SELECT name, description, fee_type, amount FROM fees WHERE is_active AND (location_id IS NULL OR location_id = $1) ORDER BY sort_order, id', [locationId || null]);
  const lines = fees.map((f) => ({ name: f.name, description: f.description, amount: round2(f.feeType === 'percent' ? (rate.price * f.amount) / 100 : f.amount), percent: f.feeType === 'percent' ? f.amount : null }));
  const feesTotal = round2(lines.reduce((s, f) => s + f.amount, 0));
  return { rate, ratePrice: round2(rate.price), fees: lines, feesTotal, total: round2(rate.price + feesTotal) };
}

/**
 * Throws 409 when another active booking of the profile overlaps [date time, +duration) including the buffer.
 * bufferMinutes comes from bookingRules(), read by the caller before the transaction starts.
 */
export async function assertFree(db, { profileId, date, time, durationMinutes, excludeId = null, bufferMinutes = 0 }) {
  const clash = await db.one(
    `SELECT reference FROM bookings
     WHERE profile_id = $1 AND kind = 'Booking' AND status IN ('Pending','Confirmed') AND ($5::int IS NULL OR id <> $5)
       AND starts_at < ($2::date + $3::time) + make_interval(mins => $4::int + $6::int)
       AND ends_at + make_interval(mins => $6::int) > ($2::date + $3::time)
     LIMIT 1`,
    [profileId, date, time, durationMinutes, excludeId, bufferMinutes]
  );
  if (clash) throw new HttpError(409, 'That time overlaps another booking. Please choose another time.', { time: 'No longer available.' });
}

/**
 * Inserts a booking or inquiry inside a transaction (db = tx helpers). Locks the profile row so two
 * requests for the same time can't both get through. Returns { id, reference }.
 */
export async function createBooking(db, d) {
  await db.one('SELECT id FROM profiles WHERE id = $1 FOR UPDATE', [d.profileId]);
  if (d.kind === 'Booking') await assertFree(db, { profileId: d.profileId, date: d.date, time: d.time, durationMinutes: d.durationMinutes, bufferMinutes: d.bufferMinutes });
  const reference = await newReference(db, d.kind === 'Inquiry' ? 'INQ' : 'BK', 'bookings', 'reference');
  const row = await db.one(
    `INSERT INTO bookings (reference, kind, profile_id, rate_id, rate_label, duration_minutes, booking_date, start_time, starts_at, ends_at,
       location_id, meeting_place, client_name, client_email, client_phone, preferred_contact, client_notes,
       rate_price, fees, fees_total, total, status, source, staff_notes)
     VALUES ($1, $2, $3, $4, $5, $6, $7::date, $8::time,
       CASE WHEN $7::date IS NULL OR $8::time IS NULL THEN NULL ELSE $7::date + $8::time END,
       CASE WHEN $7::date IS NULL OR $8::time IS NULL OR $6::int IS NULL THEN NULL ELSE $7::date + $8::time + make_interval(mins => $6::int) END,
       $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22)
     RETURNING id`,
    [reference, d.kind, d.profileId, d.rateId || null, d.rateLabel || null, d.durationMinutes || null, d.date || null, d.time || null,
      d.locationId || null, d.meetingPlace || null, d.clientName, d.clientEmail, d.clientPhone || null, d.preferredContact || null, encryptText(d.clientNotes || null),
      d.ratePrice || 0, JSON.stringify(d.fees || []), d.feesTotal || 0, d.total || 0, d.status, d.source || 'Online', d.staffNotes || null]
  );
  await addEvent(db, row.id, {
    status: d.status,
    title: d.kind === 'Inquiry' ? 'Inquiry received' : d.status === 'Confirmed' ? 'Booking confirmed' : 'Booking request received',
    actor: d.actor || d.clientName,
  });
  return { id: row.id, reference };
}

/** Moves a booking to a new date/time (re-checking the slot). db = tx helpers. */
export async function moveBooking(db, b, { date, time, durationMinutes = b.durationMinutes, countAsReschedule = true, bufferMinutes = 0 }) {
  await db.one('SELECT id FROM profiles WHERE id = $1 FOR UPDATE', [b.profileId]);
  await assertFree(db, { profileId: b.profileId, date, time, durationMinutes, excludeId: b.id, bufferMinutes });
  await db.run(
    `UPDATE bookings SET booking_date = $1::date, start_time = $2::time, starts_at = $1::date + $2::time,
       ends_at = $1::date + $2::time + make_interval(mins => $3::int), duration_minutes = $3,
       reschedule_count = reschedule_count + $4, updated_at = now() WHERE id = $5`,
    [date, time, durationMinutes, countAsReschedule ? 1 : 0, b.id]
  );
}

export function assertTransition(b, to) {
  const allowed = TRANSITIONS[b.kind]?.[b.status] || [];
  if (!allowed.includes(to)) throw new HttpError(409, `A ${b.status.toLowerCase()} ${b.kind.toLowerCase()} can’t be changed to ${to}.`);
}
