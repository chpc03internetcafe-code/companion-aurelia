// Public website API (no staff sign-in): site info, directory, profile pages, availability, booking requests,
// booking self-service, location / category / guide pages, redirects, sitemap and the contact form.
//
// Clients look up a booking with its reference + the email they used (or by being signed in as the member
// who made it). Responses never include staff notes. VIP visibility is decided here from the member session.
import { Router } from 'express';
import { one, params, q, run, tx } from '../db/index.js';
import { clientIp, HttpError, wrap } from '../lib/http.js';
import { validate } from '../lib/validate.js';
import { isIsoDate, phDate } from '../lib/dates.js';
import { rateLimit, sessionMember, throttle } from '../lib/auth.js';
import { logEvent } from '../lib/audit.js';
import { notify } from '../lib/mailer.js';
import { bookingReceived, bookingToDesk, inquiryReceipt, inquiryToDesk, siteUrl } from '../lib/emails.js';
import { themeVars } from '../lib/themes.js';
import { newReference } from '../lib/refs.js';
import { bookingCancelledNote, bookingNote, bookingRescheduledNote, inquiryNote, notifyStaff } from '../lib/notifications.js';
import { bookingRules, idleMinutes, loadSettings } from '../services/settings.js';
import { dayAvailability, hoursUntil, openDays } from '../services/availability.js';
import { CONTACT_METHODS, addEvent, createBooking, loadBooking, loadEvents, moveBooking, publicBooking, quote } from '../services/bookings.js';
import { cardsByIds, profileDetail, searchProfiles, similarProfiles, SORTS } from '../services/profiles.js';
import { INQUIRY_SUBJECTS } from './inquiries.js';
import { emailCompanion } from '../services/companions.js';
import { chatState, messageCounts, readChat, sendChat } from '../services/chat.js';
import { cached, PUBLIC_CDN_CACHE } from '../lib/cache.js';

const router = Router();
const visitor = (name, email) => ({ actorType: 'Visitor', userName: name, userEmail: email });
const rankOf = async (req) => (await sessionMember(req))?.tierRank || 0;

// ---------- Everything the website needs on load ----------
const PUBLIC_SETTINGS = ['siteName', 'logoText', 'logoSubtext', 'tagline', 'about', 'email', 'phone', 'messaging', 'hours', 'instagramUrl', 'xUrl',
  'telegramUrl', 'whatsappUrl', 'announcement1', 'announcement2', 'announcement3', 'heroTitle', 'heroText', 'currency', 'ageGateEnabled', 'ageGateText',
  'bookingPolicy', 'memberPaymentInstructions', 'liveChatEnabled', 'liveChatGreeting', 'seoTitleSuffix', 'seoDefaultDescription', 'seoOgImage', 'structuredData', 'searchIndexing'];

// Same for every visitor, so it's cached on the server and briefly at the CDN.
router.get('/bootstrap', wrap(async (_req, res) => {
  res.set('Cache-Control', PUBLIC_CDN_CACHE);
  res.json(await cached(`bootstrap:${phDate()}`, 60_000, bootstrap));
}));

async function bootstrap() {
  const s = await loadSettings();
  const rules = await bookingRules(s);
  const [categories, locations, tiers, pages, faqs, stats, durations] = await Promise.all([
    q(`SELECT c.id, c.name, c.slug, c.description,
         (SELECT COUNT(*)::int FROM profiles p WHERE p.category_id = c.id AND p.status = 'Published' AND p.vip_tier_id IS NULL) AS profile_count
       FROM categories c WHERE c.is_active ORDER BY c.sort_order, c.name`),
    q(`SELECT l.id, l.parent_id, l.name, l.slug, l.region, l.is_popular, l.image_url, l.image_alt,
         (SELECT COUNT(DISTINCT p.id)::int FROM profiles p LEFT JOIN locations bl ON bl.id = p.base_location_id
            WHERE p.status = 'Published' AND p.vip_tier_id IS NULL AND (p.base_location_id = l.id OR bl.parent_id = l.id
              OR EXISTS (SELECT 1 FROM profile_areas a JOIN locations al ON al.id = a.location_id WHERE a.profile_id = p.id AND (al.id = l.id OR al.parent_id = l.id)))) AS profile_count
       FROM locations l WHERE l.is_published ORDER BY l.sort_order, l.name`),
    q("SELECT id, name, slug, rank, description, price, duration_days, perks, color FROM tiers WHERE is_active AND is_public ORDER BY rank, sort_order"),
    q('SELECT slug, title, kicker, show_in_footer FROM content_pages WHERE is_published ORDER BY sort_order, title'),
    q('SELECT id, group_name, question, answer, show_on_home FROM faqs WHERE is_published ORDER BY sort_order, id'),
    one(`SELECT COUNT(*)::int AS profiles, COUNT(*) FILTER (WHERE is_verified)::int AS verified FROM profiles WHERE status = 'Published' AND vip_tier_id IS NULL`),
    q(`SELECT DISTINCT r.duration_minutes FROM profile_rates r JOIN profiles p ON p.id = r.profile_id WHERE r.is_active AND p.status = 'Published' ORDER BY 1`),
  ]);
  return {
    site: Object.fromEntries(PUBLIC_SETTINGS.map((k) => [k, s[k] || ''])),
    rules: { leadHours: rules.leadHours, windowDays: rules.windowDays, cancelCutoffHours: rules.cancelCutoffHours, rescheduleLimit: rules.rescheduleLimit, membersOnly: rules.membersOnly, autoConfirm: rules.autoConfirm },
    theme: { id: s.theme, vars: themeVars(s.theme) },
    idle: { memberMinutes: idleMinutes(s).member, companionMinutes: idleMinutes(s).companion },
    today: phDate(),
    categories, locations, pages, faqs, stats,
    tiers: tiers.map((t) => ({ ...t, perks: JSON.parse(t.perks || '[]') })),
    durations: durations.map((d) => d.durationMinutes),
    sorts: SORTS, contactMethods: CONTACT_METHODS, inquirySubjects: INQUIRY_SUBJECTS,
  };
}

// Cached per VIP rank (what a visitor may see depends only on it).
router.get('/home', wrap(async (req, res) => {
  const rank = await rankOf(req);
  res.set('Cache-Control', 'no-store');
  res.json(await cached(`home:${rank}`, 30_000, () => homeLists(rank)));
}));

async function homeLists(rank) {
  const [featured, recent, availableToday, posts] = await Promise.all([
    searchProfiles({ featured: '1' }, { memberRank: rank, pageSize: 8 }),
    searchProfiles({ sort: 'updated' }, { memberRank: rank, pageSize: 8 }),
    searchProfiles({ available: 'today', sort: 'active' }, { memberRank: rank, pageSize: 1 }),
    q(`SELECT slug, kind, title, excerpt, cover_url, cover_alt, audience, published_at FROM posts
       WHERE is_published AND audience = 'Public' ORDER BY is_pinned DESC, published_at DESC NULLS LAST LIMIT 3`),
  ]);
  return { featured: featured.items, recent: recent.items, availableTodayCount: availableToday.total, posts };
}

// ---------- Directory ----------
const FILTER_KEYS = ['category', 'location', 'q', 'budgetMin', 'budgetMax', 'duration', 'available', 'verified', 'featured', 'vip', 'sort'];

router.get('/profiles', wrap(async (req, res) => {
  const filters = Object.fromEntries(FILTER_KEYS.filter((k) => req.query[k]).map((k) => [k, String(req.query[k])]));
  const result = await searchProfiles(filters, { memberRank: await rankOf(req), page: Number(req.query.page) || 1, pageSize: Number(req.query.pageSize) || 24 });
  res.set('Cache-Control', 'no-store');
  res.json(result);
}));

// Cards for favourites saved in the browser (guests).
router.post('/profiles/cards', wrap(async (req, res) => {
  const ids = (Array.isArray(req.body.ids) ? req.body.ids : []).map(Number).filter(Number.isInteger).slice(0, 60);
  res.json(await cardsByIds(ids, await rankOf(req)));
}));

router.get('/profiles/:slug', wrap(async (req, res) => {
  const rank = await rankOf(req);
  const slug = String(req.params.slug).slice(0, 120);
  const detail = await profileDetail(slug, rank);
  res.set('Cache-Control', 'no-store');
  if (!detail) throw new HttpError(404, 'Profile not found.');
  if (detail.retired) {
    const redirect = await one('SELECT to_path, status_code FROM redirects WHERE from_path = $1 AND is_active', [`/companions/${slug}`]);
    return res.status(410).json({ retired: true, name: detail.name, redirect: redirect?.toPath || null,
      similar: await similarProfiles({ categoryId: detail.categoryId, locationId: detail.locationId }, rank, 4) });
  }
  if (detail.vipLocked) return res.status(403).json({ vipLocked: true, name: detail.name, vipTierName: detail.vipTierName });
  const similar = await similarProfiles({ excludeId: detail.id, categoryId: detail.categoryId, locationId: detail.baseLocationId }, rank, 4);
  res.json({ ...detail, similar });
}));

// ---------- Availability and quotes ----------
async function visibleProfile(req, profileId) {
  const rank = await rankOf(req);
  const p = await one(`SELECT p.id, p.display_name, p.status, p.booking_enabled, p.vip_tier_id, t.rank AS vip_rank, t.is_active AS vip_active
    FROM profiles p LEFT JOIN tiers t ON t.id = p.vip_tier_id WHERE p.id = $1`, [profileId]);
  if (!p || p.status !== 'Published' || (p.vipTierId && !(p.vipActive && p.vipRank <= rank))) throw new HttpError(404, 'Profile not found.');
  return p;
}

// ?exclude=<reference> leaves the client's own booking out, so rescheduling can move it by a few minutes.
async function excludedId(profileId, reference) {
  if (!reference) return null;
  return (await one('SELECT id FROM bookings WHERE reference = $1 AND profile_id = $2', [String(reference).toUpperCase().slice(0, 24), profileId]))?.id || null;
}

async function rateDuration(profileId, rateId) {
  const r = await one('SELECT duration_minutes FROM profile_rates WHERE id = $1 AND profile_id = $2 AND is_active', [rateId, profileId]);
  if (!r) throw new HttpError(422, 'Choose a session length.', { rateId: 'Choose a session length.' });
  return r.durationMinutes;
}

router.get('/availability', wrap(async (req, res) => {
  const profileId = Number(req.query.profileId);
  await visibleProfile(req, profileId);
  if (!isIsoDate(req.query.date)) throw new HttpError(422, 'Choose a date.');
  const r = await dayAvailability({ profileId, durationMinutes: await rateDuration(profileId, Number(req.query.rateId)), date: req.query.date, excludeBookingId: await excludedId(profileId, req.query.exclude) });
  res.set('Cache-Control', 'no-store');
  res.json(r);
}));

router.get('/availability/days', wrap(async (req, res) => {
  const profileId = Number(req.query.profileId);
  await visibleProfile(req, profileId);
  const from = isIsoDate(req.query.from) && req.query.from >= phDate() ? req.query.from : phDate();
  res.set('Cache-Control', 'no-store');
  res.json(await openDays({ profileId, durationMinutes: await rateDuration(profileId, Number(req.query.rateId)), from, days: Math.min(Number(req.query.days) || 14, 31), excludeBookingId: await excludedId(profileId, req.query.exclude) }));
}));

router.post('/quote', wrap(async (req, res) => {
  const profileId = Number(req.body.profileId);
  await visibleProfile(req, profileId);
  const r = await quote({ one, q }, { profileId, rateId: Number(req.body.rateId), locationId: Number(req.body.locationId) || null });
  res.json({ rateLabel: r.rate.label, durationMinutes: r.rate.durationMinutes, ratePrice: r.ratePrice, fees: r.fees, feesTotal: r.feesTotal, total: r.total });
}));

// ---------- Booking requests and inquiries ----------
const bookingSchema = {
  kind: { type: 'enum', values: ['Booking', 'Inquiry'], default: 'Booking' },
  profileId: { type: 'int', required: true, min: 1, message: 'Choose a companion.' },
  rateId: { type: 'int', min: 1 },
  date: { type: 'date' },
  time: { type: 'time' },
  locationId: { type: 'int', min: 1 },
  meetingPlace: { type: 'string', max: 200 },
  name: { type: 'string', required: true, max: 150, label: 'Name' },
  email: { type: 'email', required: true, label: 'Email' },
  phone: { type: 'phone' },
  preferredContact: { type: 'enum', values: CONTACT_METHODS, default: 'Email' },
  notes: { type: 'string', max: 2000 },
};

router.post('/bookings', wrap(async (req, res) => {
  if (req.body.website) return res.status(201).json({ reference: 'BK-OK' }); // honeypot: bots fill it, people don't see it
  const data = validate(req.body, bookingSchema);
  if (!req.body.consent) throw new HttpError(422, 'Please confirm you are 18 or over and accept the booking policy.', { consent: 'Required.' });
  const booking = data.kind === 'Booking';
  if (booking) {
    const errors = {};
    if (!data.rateId) errors.rateId = 'Choose a session length.';
    if (!data.date) errors.date = 'Choose a date.';
    if (!data.time) errors.time = 'Choose a time.';
    if (!data.phone) errors.phone = 'Enter a mobile number so we can confirm.';
    if (Object.keys(errors).length) throw new HttpError(422, 'Please fix the highlighted fields.', errors);
  } else if ((data.notes || '').length < 10) {
    throw new HttpError(422, 'Tell us a little about your inquiry.', { notes: 'Please tell us a little more.' });
  }
  await rateLimit(`book:${clientIp(req)}`, 6, 3600000);
  const rules = await bookingRules();
  const member = await sessionMember(req);
  if (rules.membersOnly && !member) throw new HttpError(401, 'Please sign in to your member account to send a booking request.', { code: 'members_only' });
  const profile = await visibleProfile(req, data.profileId);
  if (booking && !profile.bookingEnabled) throw new HttpError(409, 'Online booking is paused for this profile. Please send an inquiry instead.');
  const location = data.locationId ? await one('SELECT id FROM locations WHERE id = $1 AND is_published', [data.locationId]) : null;

  let priced = null;
  if (booking) {
    priced = await quote({ one, q }, { profileId: profile.id, rateId: data.rateId, locationId: location?.id });
    const avail = await dayAvailability({ profileId: profile.id, durationMinutes: priced.rate.durationMinutes, date: data.date });
    if (!avail.slots.includes(data.time)) throw new HttpError(409, 'Sorry, that time is no longer available. Please choose another time.', { time: 'No longer available.' });
  }
  const created = await tx((db) => createBooking(db, {
    kind: data.kind, profileId: profile.id, rateId: priced?.rate.id, rateLabel: priced?.rate.label, durationMinutes: priced?.rate.durationMinutes,
    date: data.date, time: booking ? data.time : data.date ? data.time : null, locationId: location?.id, meetingPlace: data.meetingPlace,
    memberId: member?.id, clientName: data.name, clientEmail: data.email, clientPhone: data.phone, preferredContact: data.preferredContact, clientNotes: data.notes,
    ratePrice: priced?.ratePrice, fees: priced?.fees, feesTotal: priced?.feesTotal, total: priced?.total,
    status: booking && rules.autoConfirm ? 'Confirmed' : 'Pending', source: 'Online', bufferMinutes: rules.bufferMinutes,
  }));
  const b = await loadBooking({ one }, 'b.id', created.id);
  const shaped = publicBooking(b, await loadEvents({ q }, b.id, true));
  const site = await loadSettings();
  await notifyStaff(bookingNote({ ...b, profileName: b.profileName }));
  await logEvent({ action: booking ? 'Booking requested' : 'Inquiry sent', module: 'bookings', entityType: data.kind, entityId: b.id, entityLabel: b.reference,
    summary: `${data.name} ${booking ? `requested ${b.rateLabel} with ${b.profileName} on ${b.bookingDate} ${b.startTime}` : `sent an inquiry about ${b.profileName}`}`,
    ...(member ? { actorType: 'Member', userName: member.fullName, userEmail: member.email } : visitor(data.name, data.email)) }, req);
  await notify(bookingReceived(site, shaped, data.email));
  if (site.email || process.env.GMAIL_USER) await notify(bookingToDesk(site, { ...shaped, clientEmail: data.email }, site.email || process.env.GMAIL_USER));
  if (booking && b.status === 'Pending') await emailCompanion(site, b);
  res.status(201).json(shaped);
}));

// Booking lookup: signed-in member who made it, or reference + matching email.
// Reference + email unlock a guest booking. Guessing is limited per IP, checked before the lookup so a
// correct guess after the limit is refused too. The email comes in the body (POST) or the X-Booking-Email
// header (GET), never the URL, so it doesn't end up in server or CDN logs.
const bookingEmail = (req) => req.get('x-booking-email') || '';

async function ownedBooking(req, email) {
  const limiter = await throttle(`lookup:${clientIp(req)}`, { max: 20 });
  const b = await loadBooking({ one }, 'b.reference', String(req.params.ref || '').trim().toUpperCase().slice(0, 24));
  const me = await sessionMember(req);
  const okEmail = email && b && b.clientEmail.toLowerCase() === String(email).trim().toLowerCase();
  if (!b || !(okEmail || (me && me.id === b.memberId))) {
    await limiter.fail();
    throw new HttpError(404, 'We couldn’t find a booking with that reference and email.');
  }
  return b;
}

const selfService = (b, rules) => {
  const open = b.kind === 'Booking' && ['Pending', 'Confirmed'].includes(b.status);
  const hours = b.bookingDate ? hoursUntil(b.bookingDate, b.startTime) : -1;
  const beforeCutoff = open && hours >= rules.cancelCutoffHours;
  return {
    canCancel: beforeCutoff,
    canReschedule: beforeCutoff && b.rescheduleCount < rules.rescheduleLimit,
    cutoffHours: rules.cancelCutoffHours, rescheduleLimit: rules.rescheduleLimit, upcoming: open && hours > 0,
  };
};

async function bookingResponse(b) {
  const chat = chatState(b) && { ...chatState(b), unread: (await messageCounts('Client', 'b.id', b.id))[b.id]?.unread || 0 };
  return { ...publicBooking(b, await loadEvents({ q }, b.id, true)), profileId: b.profileId, rateId: b.rateId, ...selfService(b, await bookingRules()), chat };
}

router.get('/bookings/:ref', wrap(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json(await bookingResponse(await ownedBooking(req, bookingEmail(req))));
}));

router.post('/bookings/:ref/cancel', wrap(async (req, res) => {
  const b = await ownedBooking(req, req.body.email);
  const rules = await bookingRules();
  if (!selfService(b, rules).canCancel) throw new HttpError(409, `Online changes close ${rules.cancelCutoffHours} hours before the booking. Please contact the concierge.`);
  const reason = String(req.body.reason || '').trim().slice(0, 300) || 'Cancelled by the client';
  await tx(async (db) => {
    await db.run("UPDATE bookings SET status = 'Cancelled', cancel_reason = $1, cancelled_by = 'Client', updated_at = now() WHERE id = $2", [reason, b.id]);
    await addEvent(db, b.id, { status: 'Cancelled', title: 'Cancelled by you', note: reason, actor: b.clientName });
  });
  const after = await loadBooking({ one }, 'b.id', b.id);
  await notifyStaff(bookingCancelledNote({ ...after, reason }));
  await logEvent({ action: 'Cancelled by client', module: 'bookings', entityType: 'Booking', entityId: b.id, entityLabel: b.reference,
    summary: `${b.clientName} cancelled ${b.reference} online: ${reason}`, changes: { status: { from: b.status, to: 'Cancelled' } }, ...visitor(b.clientName, b.clientEmail) }, req);
  res.json(await bookingResponse(after));
}));

router.post('/bookings/:ref/reschedule', wrap(async (req, res) => {
  const b = await ownedBooking(req, req.body.email);
  const rules = await bookingRules();
  const ss = selfService(b, rules);
  if (!ss.canReschedule) {
    throw new HttpError(409, ss.canCancel ? `This booking was already rescheduled ${b.rescheduleCount} time(s), the online limit. Please contact the concierge.` : `Online changes close ${rules.cancelCutoffHours} hours before the booking. Please contact the concierge.`);
  }
  const { date, time } = validate(req.body, { date: { type: 'date', required: true, label: 'Date' }, time: { type: 'time', required: true, message: 'Choose a time.' } });
  const avail = await dayAvailability({ profileId: b.profileId, durationMinutes: b.durationMinutes, date, excludeBookingId: b.id });
  if (!avail.slots.includes(time)) throw new HttpError(409, 'That time isn’t available. Please choose another time.', { time: 'Not available.' });
  await tx(async (db) => {
    await moveBooking(db, b, { date, time, bufferMinutes: rules.bufferMinutes });
    await db.run('UPDATE bookings SET status = $1 WHERE id = $2', [rules.autoConfirm ? 'Confirmed' : 'Pending', b.id]);
    await addEvent(db, b.id, { status: rules.autoConfirm ? 'Confirmed' : 'Pending', title: 'Rescheduled by you', note: `From ${b.bookingDate} ${b.startTime} to ${date} ${time}`, actor: b.clientName });
  });
  const after = await loadBooking({ one }, 'b.id', b.id);
  await notifyStaff(bookingRescheduledNote(after));
  await logEvent({ action: 'Rescheduled by client', module: 'bookings', entityType: 'Booking', entityId: b.id, entityLabel: b.reference,
    summary: `${b.clientName} moved ${b.reference} to ${date} ${time}`, changes: { bookingDate: { from: b.bookingDate, to: date }, startTime: { from: b.startTime, to: time } }, ...visitor(b.clientName, b.clientEmail) }, req);
  const shaped = await bookingResponse(after);
  await notify(bookingReceived(await loadSettings(), shaped, b.clientEmail));
  res.json(shaped);
}));

// Chat with the companion (confirmed bookings). `after` = last message id the page already has.
router.get('/bookings/:ref/messages', wrap(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json(await readChat(await ownedBooking(req, bookingEmail(req)), 'Client', req.query.after));
}));

router.post('/bookings/:ref/messages', wrap(async (req, res) => {
  const b = await ownedBooking(req, req.body.email);
  await sendChat(b, 'Client', req.body.body);
  res.status(201).json(await readChat(b, 'Client', req.body.after));
}));

// ---------- Landing pages ----------
const parseSections = (row) => ({ ...row, sections: JSON.parse(row.sections || '[]') });

router.get('/locations/:slug', wrap(async (req, res) => {
  const l = await one(`SELECT l.id, l.parent_id, l.name, l.slug, l.region, l.intro, l.sections, l.image_url, l.image_alt, l.seo_title, l.meta_description, l.updated_at,
      pl.name AS parent_name, pl.slug AS parent_slug
    FROM locations l LEFT JOIN locations pl ON pl.id = l.parent_id WHERE l.slug = $1 AND l.is_published`, [req.params.slug]);
  if (!l) throw new HttpError(404, 'Location not found.');
  const [areas, posts] = await Promise.all([
    q('SELECT id, name, slug FROM locations WHERE parent_id = $1 AND is_published ORDER BY sort_order, name', [l.id]),
    q("SELECT slug, kind, title, excerpt, cover_url, cover_alt, published_at FROM posts WHERE is_published AND audience = 'Public' AND location_id = $1 ORDER BY published_at DESC LIMIT 3", [l.id]),
  ]);
  res.set('Cache-Control', PUBLIC_CDN_CACHE);
  res.json({ ...parseSections(l), areas, posts });
}));

router.get('/categories/:slug', wrap(async (req, res) => {
  const c = await one('SELECT id, name, slug, description, intro, seo_title, meta_description FROM categories WHERE slug = $1 AND is_active', [req.params.slug]);
  if (!c) throw new HttpError(404, 'Category not found.');
  res.set('Cache-Control', PUBLIC_CDN_CACHE);
  res.json(c);
}));

router.get('/pages/:slug', wrap(async (req, res) => {
  const p = await one('SELECT slug, title, kicker, intro, sections, seo_title, meta_description, updated_at FROM content_pages WHERE slug = $1 AND is_published', [req.params.slug]);
  if (!p) throw new HttpError(404, 'Page not found.');
  res.set('Cache-Control', PUBLIC_CDN_CACHE);
  res.json(parseSections(p));
}));

// Guides, announcements and news. Members-only posts are listed with a lock for everyone else; their body is never sent.
// ?page=1&pageSize=12 → { items, total, page, pageSize }
router.get('/posts', wrap(async (req, res) => {
  const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
  const pageSize = Math.min(48, Math.max(1, Number.parseInt(req.query.pageSize, 10) || 12));
  const rank = await rankOf(req);
  const p = params([rank]);
  const where = ['ps.is_published'];
  if (['Guide', 'Announcement', 'News'].includes(req.query.kind)) where.push(`ps.kind = ${p.add(req.query.kind)}`);
  if (req.query.audience === 'Members') where.push("ps.audience = 'Members'");
  const rows = await q(`SELECT COUNT(*) OVER ()::int AS total_count, ps.slug, ps.kind, ps.title, ps.excerpt, ps.cover_url, ps.cover_alt, ps.audience, ps.is_pinned, ps.published_at, t.name AS tier_name, l.name AS location_name,
      NOT (ps.audience = 'Public' OR ($1 > 0 AND (t.id IS NULL OR t.rank <= $1))) AS locked
    FROM posts ps LEFT JOIN tiers t ON t.id = ps.min_tier_id LEFT JOIN locations l ON l.id = ps.location_id
    WHERE ${where.join(' AND ')} ORDER BY ps.is_pinned DESC, ps.published_at DESC NULLS LAST
    LIMIT ${p.add(pageSize)} OFFSET ${p.add((page - 1) * pageSize)}`, p.values);
  res.set('Cache-Control', 'no-store');
  res.json({ items: rows.map(({ totalCount, ...r }) => r), total: rows[0]?.totalCount ?? 0, page, pageSize });
}));

router.get('/posts/:slug', wrap(async (req, res) => {
  const rank = await rankOf(req);
  const ps = await one(`SELECT ps.*, t.name AS tier_name, t.rank AS tier_rank, l.name AS location_name, l.slug AS location_slug
    FROM posts ps LEFT JOIN tiers t ON t.id = ps.min_tier_id LEFT JOIN locations l ON l.id = ps.location_id WHERE ps.slug = $1 AND ps.is_published`, [req.params.slug]);
  if (!ps) throw new HttpError(404, 'Article not found.');
  const locked = ps.audience === 'Members' && !(rank > 0 && (!ps.minTierId || ps.tierRank <= rank));
  const out = { slug: ps.slug, kind: ps.kind, title: ps.title, excerpt: ps.excerpt, coverUrl: ps.coverUrl, coverAlt: ps.coverAlt, audience: ps.audience,
    tierName: ps.tierName, locationName: ps.locationName, locationSlug: ps.locationSlug, publishedAt: ps.publishedAt, updatedAt: ps.updatedAt,
    seoTitle: ps.seoTitle, metaDescription: ps.metaDescription, locked, sections: locked ? [] : JSON.parse(ps.sections || '[]') };
  res.set('Cache-Control', 'no-store');
  res.json(out);
}));

// ---------- Redirects ----------
// The website asks here before showing "not found" (and the profile page for retired profiles).
router.get('/resolve', wrap(async (req, res) => {
  const path = String(req.query.path || '').split('?')[0].replace(/\/+$/, '') || '/';
  const r = await one('SELECT id, to_path, status_code FROM redirects WHERE is_active AND (from_path = $1 OR from_path = $2)', [path, `${path}/`]);
  if (r) run('UPDATE redirects SET hits = hits + 1, last_hit_at = now() WHERE id = $1', [r.id]).catch(() => {});
  res.set('Cache-Control', 'no-store');
  res.json(r ? { to: r.toPath, statusCode: r.statusCode } : { to: null });
}));

// ---------- Sitemap and robots ----------
const xmlEsc = (s) => String(s).replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c]);

router.get('/sitemap.xml', wrap(async (req, res) => {
  const base = siteUrl() || `${req.protocol}://${req.get('host')}`;
  res.type('application/xml').set('Cache-Control', 'public, max-age=3600');
  res.send(await cached(`sitemap:${base}`, 5 * 60_000, () => sitemapXml(base)));
}));

async function sitemapXml(base) {
  const [cats, locs, profiles, posts, pages] = await Promise.all([
    q('SELECT slug, updated_at FROM categories WHERE is_active'),
    q('SELECT slug, updated_at FROM locations WHERE is_published'),
    q("SELECT slug, updated_at FROM profiles WHERE status = 'Published' AND vip_tier_id IS NULL"),
    q("SELECT slug, updated_at FROM posts WHERE is_published AND audience = 'Public'"),
    q('SELECT slug, updated_at FROM content_pages WHERE is_published'),
  ]);
  const urls = [
    ['/', null, '1.0'], ['/companions', null, '0.9'], ['/locations', null, '0.8'], ['/guides', null, '0.6'], ['/faq', null, '0.5'], ['/vip', null, '0.5'], ['/contact', null, '0.4'],
    ...cats.map((c) => [`/${c.slug}`, c.updatedAt, '0.8']),
    ...locs.map((l) => [`/locations/${l.slug}`, l.updatedAt, '0.8']),
    ...profiles.map((p) => [`/companions/${p.slug}`, p.updatedAt, '0.7']),
    ...posts.map((p) => [`/guides/${p.slug}`, p.updatedAt, '0.5']),
    ...pages.map((p) => [`/pages/${p.slug}`, p.updatedAt, '0.3']),
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map(([u, d, pr]) =>
    `  <url><loc>${xmlEsc(base + u)}</loc>${d ? `<lastmod>${new Date(d).toISOString().slice(0, 10)}</lastmod>` : ''}<priority>${pr}</priority></url>`).join('\n')}\n</urlset>\n`;
}

router.get('/robots.txt', wrap(async (req, res) => {
  const s = await loadSettings();
  const base = siteUrl() || `${req.protocol}://${req.get('host')}`;
  res.type('text/plain').set('Cache-Control', 'public, max-age=3600');
  res.send(s.searchIndexing === '0'
    ? 'User-agent: *\nDisallow: /\n'
    : `User-agent: *\nDisallow: /account\nDisallow: /booking-status\nDisallow: /book\nDisallow: /favorites\nDisallow: /api/\n\nSitemap: ${base}/sitemap.xml\n`);
}));

// ---------- Contact form ----------
const inquirySchema = {
  name: { type: 'string', required: true, max: 150, label: 'Name' },
  email: { type: 'email', required: true, label: 'Email' },
  phone: { type: 'phone' },
  subject: { type: 'enum', values: INQUIRY_SUBJECTS, required: true, label: 'Subject' },
  message: { type: 'string', required: true, max: 3000, label: 'Message', check: (v) => (v.length < 10 ? 'Please tell us a little more.' : null) },
};

router.post('/inquiries', wrap(async (req, res) => {
  const data = validate(req.body, inquirySchema);
  if (req.body.website) return res.status(201).json({ reference: 'MSG-OK' }); // honeypot
  await rateLimit(`inquiry:${clientIp(req)}`, 5, 3600000);
  const member = await sessionMember(req);
  const created = await tx(async (db) => {
    const reference = await newReference(db, 'MSG', 'inquiries', 'reference');
    const row = await db.one('INSERT INTO inquiries (reference, member_id, full_name, email, phone, subject, message) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id',
      [reference, member?.id || null, data.name, data.email, data.phone, data.subject, data.message]);
    return { id: row.id, reference };
  });
  const shape = { ...data, reference: created.reference };
  const site = await loadSettings();
  await notifyStaff(inquiryNote(shape));
  await logEvent({ action: 'Message received', module: 'inquiries', entityType: 'Contact message', entityId: created.id, entityLabel: created.reference,
    summary: `${data.name} sent a message: ${data.subject}`, ...visitor(data.name, data.email) }, req);
  await notify(inquiryReceipt(site, shape));
  if (site.email || process.env.GMAIL_USER) await notify(inquiryToDesk(site, shape, site.email || process.env.GMAIL_USER));
  res.status(201).json({ reference: created.reference });
}));

export default router;
