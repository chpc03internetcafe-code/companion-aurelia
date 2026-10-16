// CMS dashboard: today's bookings, work queues and the last 30 days at a glance.
import { Router } from 'express';
import { one, q, run } from '../db/index.js';
import { wrap } from '../lib/http.js';
import { can } from '../lib/admin-auth.js';
import { expireOld } from '../services/members.js';
import { parseFees, SELECT_BOOKING } from '../services/bookings.js';

const router = Router();

router.get('/', wrap(async (req, res) => {
  const see = (m) => can(req.admin.permissions, m, 'view');
  const out = {};
  if (see('bookings')) {
    const [counts, today, queue, byDay, topProfiles] = await Promise.all([
      one(`SELECT
          COUNT(*) FILTER (WHERE status = 'Pending' AND kind = 'Booking')::int AS pending,
          COUNT(*) FILTER (WHERE status = 'Pending' AND kind = 'Inquiry')::int AS inquiries,
          COUNT(*) FILTER (WHERE status = 'Confirmed' AND booking_date = ph_today())::int AS today,
          COUNT(*) FILTER (WHERE status = 'Confirmed' AND booking_date BETWEEN ph_today() + 1 AND ph_today() + 7)::int AS next7,
          COUNT(*) FILTER (WHERE kind = 'Booking' AND created_at >= now() - INTERVAL '30 days')::int AS requests30,
          COUNT(*) FILTER (WHERE status = 'Completed' AND booking_date >= ph_today() - 30)::int AS completed30,
          COALESCE(SUM(total) FILTER (WHERE status = 'Completed' AND booking_date >= ph_today() - 30), 0) AS value30,
          COUNT(*) FILTER (WHERE status IN ('Cancelled','Declined','No-Show') AND booking_date >= ph_today() - 30)::int AS lost30
        FROM bookings`),
      q(`${SELECT_BOOKING} WHERE b.booking_date = ph_today() AND b.status IN ('Pending','Confirmed','Completed') ORDER BY b.starts_at`),
      q(`${SELECT_BOOKING} WHERE b.status = 'Pending' ORDER BY b.created_at LIMIT 8`),
      q(`SELECT d::date AS day, COUNT(b.id)::int AS n
         FROM generate_series(ph_today() - 13, ph_today(), INTERVAL '1 day') d
         LEFT JOIN bookings b ON b.kind = 'Booking' AND (b.created_at AT TIME ZONE 'Asia/Manila')::date = d::date
         GROUP BY d ORDER BY d`),
      q(`SELECT p.id, p.display_name, COUNT(b.id)::int AS n FROM bookings b JOIN profiles p ON p.id = b.profile_id
         WHERE b.kind = 'Booking' AND b.created_at >= now() - INTERVAL '30 days' AND b.status NOT IN ('Declined')
         GROUP BY p.id, p.display_name ORDER BY n DESC LIMIT 6`),
    ]);
    Object.assign(out, { bookings: counts, today: today.map(parseFees), queue: queue.map(parseFees), byDay: byDay.map((r) => ({ day: String(r.day).slice(0, 10), n: r.n })), topProfiles });
  }
  if (see('profiles')) {
    out.profiles = await one(`SELECT COUNT(*) FILTER (WHERE status = 'Published')::int AS published, COUNT(*) FILTER (WHERE status = 'Draft')::int AS drafts,
        COUNT(*) FILTER (WHERE status = 'Published' AND NOT is_verified)::int AS unverified,
        COUNT(*) FILTER (WHERE status = 'Published' AND updated_at < now() - INTERVAL '30 days')::int AS stale,
        COUNT(*) FILTER (WHERE status = 'Published' AND NOT EXISTS (SELECT 1 FROM profile_schedules s WHERE s.profile_id = profiles.id))::int AS no_availability
      FROM profiles`);
  }
  if (see('members')) {
    await expireOld({ run });
    out.members = await one(`SELECT COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE tier_id IS NOT NULL AND membership_expires_on >= ph_today())::int AS vip_active,
        COUNT(*) FILTER (WHERE tier_id IS NOT NULL AND membership_expires_on BETWEEN ph_today() AND ph_today() + 14)::int AS expiring,
        COUNT(*) FILTER (WHERE created_at >= now() - INTERVAL '30 days')::int AS new30,
        (SELECT COUNT(*)::int FROM memberships WHERE status = 'Pending') AS pending
      FROM members`);
  }
  if (see('inquiries')) out.inquiries = await one("SELECT COUNT(*) FILTER (WHERE status = 'New')::int AS new, COUNT(*) FILTER (WHERE status = 'In Progress')::int AS in_progress FROM inquiries");
  res.set('Cache-Control', 'no-store');
  res.json(out);
}));

export default router;
