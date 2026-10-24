// Availability for booking requests.
//
// A start time is offered when:
//   - the profile is published, takes bookings and isn't "away" or on time off that day,
//   - the date is inside the booking window and the time is at least `leadHours` from now,
//   - the whole session fits inside one of the profile's weekly availability blocks, and
//   - no Pending / Confirmed booking of the same profile overlaps it, keeping `bufferMinutes` free
//     before and after (bookings from the previous evening that run past midnight count too).
// All times are Manila wall clock. Minutes are counted from midnight of the day being checked.
import { q as dbq } from '../db/index.js';
import { addDays, isIsoDate, phDate, phMinutesNow, toMin, fromMin, weekday } from '../lib/dates.js';
import { bookingRules } from './settings.js';

export const ACTIVE_BOOKING = ['Pending', 'Confirmed'];
const dayDiff = (a, b) => Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86400000);

/** Profile, weekly blocks, time off and bookings for a date range — loaded once for several days. */
async function loadContext({ profileId, from, to, excludeBookingId = null, db = { q: dbq } }) {
  const [profile] = await db.q(
    `SELECT id, display_name, status, booking_enabled, away_until FROM profiles WHERE id = $1`, [profileId]);
  if (!profile) return null;
  const [schedules, timeOff, bookings] = await Promise.all([
    db.q("SELECT weekday, to_char(start_time, 'HH24:MI') AS start, to_char(end_time, 'HH24:MI') AS end_raw, end_time = '24:00' AS until_midnight FROM profile_schedules WHERE profile_id = $1 ORDER BY weekday, start_time", [profileId]),
    db.q('SELECT start_date, end_date FROM profile_time_off WHERE profile_id = $1 AND end_date >= $2 AND start_date <= $3', [profileId, from, to]),
    db.q(`SELECT id, EXTRACT(EPOCH FROM (starts_at - $2::timestamp)) / 60 AS s, EXTRACT(EPOCH FROM (ends_at - $2::timestamp)) / 60 AS e
          FROM bookings WHERE profile_id = $1 AND kind = 'Booking' AND status IN ('Pending','Confirmed')
            AND ends_at > ($2::date - 1)::timestamp AND starts_at < ($3::date + 2)::timestamp AND ($4::int IS NULL OR id <> $4)`,
    [profileId, from, to, excludeBookingId]),
  ]);
  return {
    profile,
    schedules: schedules.map((s) => ({ weekday: s.weekday, start: toMin(s.start), end: s.untilMidnight ? 1440 : toMin(s.endRaw) })),
    timeOff,
    // minutes relative to `from` midnight
    bookings: bookings.map((b) => ({ id: b.id, s: Number(b.s), e: Number(b.e) })),
    from,
  };
}

function closedReason(ctx, date, rules) {
  const p = ctx.profile;
  const today = phDate();
  if (p.status !== 'Published') return 'This profile isn’t taking bookings.';
  if (!p.bookingEnabled) return 'Online booking is paused for this profile. Send an inquiry instead.';
  if (date < today) return 'This date has passed.';
  if (dayDiff(date, today) > rules.windowDays) return `Bookings open ${rules.windowDays} days ahead.`;
  if (p.awayUntil && date <= p.awayUntil) return 'Away on this date.';
  if (ctx.timeOff.some((o) => date >= o.startDate && date <= o.endDate)) return 'Not available on this date.';
  if (!ctx.schedules.some((s) => s.weekday === weekday(date))) return 'Not available on this day of the week.';
  return null;
}

function slotsFor(ctx, date, durationMinutes, rules) {
  const closed = closedReason(ctx, date, rules);
  if (closed) return { date, closed, slots: [] };
  const offset = dayDiff(date, ctx.from) * 1440; // the day's midnight, relative to ctx.from
  const earliest = phMinutesNow() + rules.leadHours * 60 - dayDiff(date, phDate()) * 1440;
  const grid = rules.slotMinutes;
  const buffer = rules.bufferMinutes;
  const out = new Set();
  for (const block of ctx.schedules.filter((s) => s.weekday === weekday(date))) {
    for (let t = Math.ceil(block.start / grid) * grid; t + durationMinutes <= block.end; t += grid) {
      if (t < earliest) continue;
      const s = offset + t;
      const e = s + durationMinutes;
      if (ctx.bookings.some((b) => b.s < e + buffer && b.e + buffer > s)) continue;
      out.add(t);
    }
  }
  const slots = [...out].sort((a, b) => a - b).map(fromMin);
  return { date, closed: slots.length ? null : 'Fully booked or no times left on this date.', slots };
}

/** Start times ('HH:MM') for one day. */
export async function dayAvailability({ profileId, durationMinutes, date, excludeBookingId, db }) {
  if (!isIsoDate(date) || !(durationMinutes > 0)) return { date, closed: 'Choose a date and session length.', slots: [] };
  const rules = await bookingRules();
  const ctx = await loadContext({ profileId, from: date, to: date, excludeBookingId, db });
  if (!ctx) return { date, closed: 'Profile not found.', slots: [] };
  return slotsFor(ctx, date, durationMinutes, rules);
}

/** Number of open start times per day, for the date strip on the booking page. */
export async function openDays({ profileId, durationMinutes, from, days = 14, excludeBookingId }) {
  const rules = await bookingRules();
  const to = addDays(from, days - 1);
  const ctx = await loadContext({ profileId, from, to, excludeBookingId });
  if (!ctx) return [];
  const out = [];
  for (let i = 0; i < days; i++) {
    const date = addDays(from, i);
    const r = slotsFor(ctx, date, durationMinutes, rules);
    out.push({ date, slots: r.slots.length, closed: r.slots.length ? null : r.closed });
  }
  return out;
}

/**
 * SQL condition: profile `p` has availability hours on day `$n` (and, for today, hours that haven't ended yet).
 * Used by the directory's "available today / on a date" filter; it ignores existing bookings.
 */
export const availableOnSql = (param) => `(
  (p.away_until IS NULL OR p.away_until < ${param}::date)
  AND NOT EXISTS (SELECT 1 FROM profile_time_off o WHERE o.profile_id = p.id AND ${param}::date BETWEEN o.start_date AND o.end_date)
  AND EXISTS (SELECT 1 FROM profile_schedules s WHERE s.profile_id = p.id AND s.weekday = EXTRACT(DOW FROM ${param}::date)
              AND (${param}::date > ph_today() OR s.end_time > ph_now()::time)))`;

/** Hours from now (Manila) until a booking's start. */
export const hoursUntil = (date, time) => (Date.parse(`${date}T${String(time).slice(0, 5)}:00+08:00`) - Date.now()) / 3600000;
