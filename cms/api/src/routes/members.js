// CMS: members (VIP portal accounts) and their memberships.
import { Router } from 'express';
import { devLinksAllowed } from '../lib/security.js';
import { one, params, q, run, tx } from '../db/index.js';
import { HttpError, idParam, paging, sendCsv, wrap } from '../lib/http.js';
import { validate } from '../lib/validate.js';
import { addDays } from '../lib/dates.js';
import { clearTwoStep, createToken, revokeMemberSessions } from '../lib/auth.js';
import { notify } from '../lib/mailer.js';
import { membershipActivated, membershipRejected, passwordReset, renewalReminder, siteUrl, twoStepChanged } from '../lib/emails.js';
import { logEvent } from '../lib/audit.js';
import { nextMemberNo } from '../lib/refs.js';
import { loadSettings } from '../services/settings.js';
import { activate, createMembership, expireOld, MEMBER_PAYMENT_METHODS, SELECT_MEMBERSHIP } from '../services/members.js';
import { parseFees, SELECT_BOOKING } from '../services/bookings.js';

const router = Router();
// email links are shown on screen only on a developer's machine (see lib/security.js)
const devMode = devLinksAllowed;

const LIST = `SELECT m.id, m.member_no, m.full_name, m.first_name, m.last_name, m.email, m.phone, m.status, m.tier_id, m.membership_expires_on, m.email_verified_at,
    m.last_login_at, m.created_at, t.name AS tier_name, t.color AS tier_color,
    (t.id IS NOT NULL AND m.membership_expires_on >= ph_today()) AS vip_active,
    (SELECT COUNT(*)::int FROM bookings b WHERE b.member_id = m.id) AS booking_count,
    (SELECT COUNT(*)::int FROM memberships ms WHERE ms.member_id = m.id AND ms.status = 'Pending') AS pending_requests
  FROM members m LEFT JOIN tiers t ON t.id = m.tier_id`;

function filters(query) {
  const p = params();
  const where = [];
  if (query.status) where.push(`m.status = ${p.add(query.status)}`);
  if (query.tierId) where.push(`m.tier_id = ${p.add(Number(query.tierId))} AND m.membership_expires_on >= ph_today()`);
  if (query.vip === 'active') where.push('m.tier_id IS NOT NULL AND m.membership_expires_on >= ph_today()');
  if (query.vip === 'none') where.push('(m.tier_id IS NULL OR m.membership_expires_on < ph_today())');
  if (query.vip === 'expiring') where.push("m.tier_id IS NOT NULL AND m.membership_expires_on BETWEEN ph_today() AND ph_today() + 14");
  if (query.vip === 'pending') where.push("EXISTS (SELECT 1 FROM memberships ms WHERE ms.member_id = m.id AND ms.status = 'Pending')");
  if (query.search) {
    const s = p.add(`%${query.search}%`);
    where.push(`(m.full_name ILIKE ${s} OR m.email ILIKE ${s} OR m.member_no ILIKE ${s} OR m.phone ILIKE ${s})`);
  }
  return { p, w: where.length ? `WHERE ${where.join(' AND ')}` : '' };
}

router.get('/', wrap(async (req, res) => {
  await expireOld({ run });
  const { page, pageSize, offset } = paging(req.query);
  const { p, w } = filters(req.query);
  const { total } = await one(`SELECT COUNT(*)::int AS total FROM members m ${w}`, p.values);
  const items = await q(`${LIST} ${w} ORDER BY m.created_at DESC LIMIT ${p.add(pageSize)} OFFSET ${p.add(offset)}`, p.values);
  res.json({ items, total, page, pageSize });
}));

router.get('/export', wrap(async (req, res) => {
  const { p, w } = filters(req.query);
  const rows = await q(`${LIST} ${w} ORDER BY m.created_at DESC LIMIT 10000`, p.values);
  sendCsv(res, `members-${new Date().toISOString().slice(0, 10)}.csv`, ['Member no', 'Name', 'Email', 'Phone', 'Status', 'Tier', 'Expires', 'Bookings', 'Joined', 'Last sign-in'],
    rows.map((m) => [m.memberNo, m.fullName, m.email, m.phone, m.status, m.vipActive ? m.tierName : '', m.membershipExpiresOn, m.bookingCount, m.createdAt, m.lastLoginAt]));
}));

router.get('/stats', wrap(async (_req, res) => {
  await expireOld({ run });
  res.json(await one(`SELECT COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE tier_id IS NOT NULL AND membership_expires_on >= ph_today())::int AS vip_active,
      COUNT(*) FILTER (WHERE tier_id IS NOT NULL AND membership_expires_on BETWEEN ph_today() AND ph_today() + 14)::int AS expiring,
      COUNT(*) FILTER (WHERE created_at >= now() - INTERVAL '30 days')::int AS new_30d,
      (SELECT COUNT(*)::int FROM memberships WHERE status = 'Pending') AS pending
    FROM members`));
}));

// Pending membership requests across all members (approval queue).
router.get('/memberships', wrap(async (req, res) => {
  await expireOld({ run });
  const status = ['Pending', 'Active', 'Expired', 'Rejected', 'Cancelled'].includes(req.query.status) ? req.query.status : 'Pending';
  res.json(await q(`${SELECT_MEMBERSHIP} WHERE ms.status = $1 ORDER BY ms.created_at ${status === 'Pending' ? 'ASC' : 'DESC'} LIMIT 200`, [status]));
}));

async function memberDetail(id) {
  const m = await one(`${LIST} WHERE m.id = $1`, [id]);
  if (!m) throw new HttpError(404, 'Member not found.');
  const full = await one('SELECT birthdate, marketing_opt_in, terms_accepted_at, notes, totp_enabled_at AS two_step_since FROM members WHERE id = $1', [id]);
  const [memberships, bookings, favorites, sessions] = await Promise.all([
    q(`${SELECT_MEMBERSHIP} WHERE ms.member_id = $1 ORDER BY ms.created_at DESC`, [id]),
    q(`${SELECT_BOOKING} WHERE b.member_id = $1 ORDER BY b.created_at DESC LIMIT 50`, [id]),
    q("SELECT p.id, p.display_name, p.slug, p.status FROM member_favorites f JOIN profiles p ON p.id = f.profile_id WHERE f.member_id = $1 ORDER BY f.created_at DESC", [id]),
    q('SELECT id, user_agent, ip_address, created_at, last_seen_at FROM member_sessions WHERE member_id = $1 AND expires_at > now() ORDER BY last_seen_at DESC', [id]),
  ]);
  return { ...m, ...full, memberships, bookings: bookings.map(parseFees), favorites, sessions };
}

router.get('/:id', wrap(async (req, res) => {
  await expireOld({ run });
  res.json(await memberDetail(idParam(req)));
}));

const memberSchema = {
  firstName: { type: 'string', required: true, max: 80, label: 'First name' },
  lastName: { type: 'string', required: true, max: 80, label: 'Last name' },
  email: { type: 'email', required: true, label: 'Email' },
  phone: { type: 'phone' },
  birthdate: { type: 'date' },
  status: { type: 'enum', values: ['Active', 'Suspended'], default: 'Active' },
  marketingOptIn: { type: 'bool' },
  notes: { type: 'string', max: 4000 },
};

// Staff can add a member (e.g. a phone client); they activate the account themselves from the password link.
router.post('/', wrap(async (req, res) => {
  const d = validate(req.body, memberSchema);
  const id = await tx(async (db) => (await db.one(
    `INSERT INTO members (member_no, first_name, last_name, email, phone, birthdate, status, marketing_opt_in, notes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
    [await nextMemberNo(db), d.firstName, d.lastName, d.email, d.phone, d.birthdate, d.status, d.marketingOptIn, d.notes])).id);
  res.status(201).json(await memberDetail(id));
}));

router.put('/:id', wrap(async (req, res) => {
  const id = idParam(req);
  const d = validate(req.body, memberSchema);
  await run('UPDATE members SET first_name = $1, last_name = $2, email = $3, phone = $4, birthdate = $5, status = $6, marketing_opt_in = $7, notes = $8, updated_at = now() WHERE id = $9',
    [d.firstName, d.lastName, d.email, d.phone, d.birthdate, d.status, d.marketingOptIn, d.notes, id]);
  if (d.status === 'Suspended') await revokeMemberSessions(id);
  res.json(await memberDetail(id));
}));

// Emails a link to set a password (also confirms the email address once used).
router.post('/:id/password-reset', wrap(async (req, res) => {
  const m = await memberDetail(idParam(req));
  if (m.status !== 'Active') throw new HttpError(409, 'Reactivate the account first.');
  const token = await createToken('reset', { email: m.email, memberId: m.id });
  const url = `${siteUrl() || 'http://localhost:5173'}/account/reset-password?token=${token}`;
  const sent = await notify(passwordReset(await loadSettings(), { name: m.fullName, email: m.email, url }));
  res.json({ sent, link: !sent && devMode() ? url : undefined });
}));

// For a member who lost their phone and backup codes: turns two-step sign-in off and signs out every device.
router.post('/:id/two-step/reset', wrap(async (req, res) => {
  const m = await memberDetail(idParam(req));
  if (!m.twoStepSince) throw new HttpError(409, 'Two-step sign-in is already off for this member.');
  await clearTwoStep(m.id);
  await revokeMemberSessions(m.id);
  await notify(twoStepChanged(await loadSettings(), { name: m.fullName, email: m.email, enabled: false, byStaff: true }));
  await logEvent({ action: 'Two-step sign-in reset', module: 'members', entityType: 'Member', entityId: m.id, entityLabel: m.fullName,
    summary: `Turned off two-step sign-in for ${m.fullName} and signed out their devices` }, req);
  res.json(await memberDetail(m.id));
}));

router.post('/:id/sessions', wrap(async (req, res) => {
  const id = idParam(req);
  await revokeMemberSessions(id);
  res.json(await memberDetail(id));
}));

// ---------- Memberships ----------
router.post('/memberships/:id/approve', wrap(async (req, res) => {
  const ms = await one(`${SELECT_MEMBERSHIP} WHERE ms.id = $1`, [idParam(req)]);
  if (!ms) throw new HttpError(404, 'Membership request not found.');
  if (ms.status !== 'Pending') throw new HttpError(409, `This request is already ${ms.status.toLowerCase()}.`);
  const { staffNote, startsOn } = validate(req.body, { staffNote: { type: 'string', max: 500 }, startsOn: { type: 'date' } });
  const done = await tx((db) => activate(db, ms, { actor: req.admin.name, staffNote, startsOn }));
  req.auditHandled = true;
  await logEvent({ action: 'Approved', module: 'members', entityType: 'Membership', entityId: ms.id, entityLabel: ms.membershipNo,
    summary: `Approved ${ms.kind.toLowerCase()} ${ms.membershipNo}: ${ms.memberName} → ${ms.tierName} until ${done.endsOn}`, changes: { status: { from: 'Pending', to: 'Active' } } }, req);
  if (req.body.notify !== false) await notify(membershipActivated(await loadSettings(), { fullName: ms.memberName, email: ms.memberEmail }, done));
  res.json(await memberDetail(ms.memberId));
}));

router.post('/memberships/:id/reject', wrap(async (req, res) => {
  const ms = await one(`${SELECT_MEMBERSHIP} WHERE ms.id = $1`, [idParam(req)]);
  if (!ms) throw new HttpError(404, 'Membership request not found.');
  if (ms.status !== 'Pending') throw new HttpError(409, `This request is already ${ms.status.toLowerCase()}.`);
  const { staffNote } = validate(req.body, { staffNote: { type: 'string', required: true, max: 500, label: 'Reason' } });
  await run("UPDATE memberships SET status = 'Rejected', staff_note = $1, decided_by = $2, decided_at = now(), updated_at = now() WHERE id = $3", [staffNote, req.admin.name, ms.id]);
  req.auditHandled = true;
  await logEvent({ action: 'Rejected', module: 'members', entityType: 'Membership', entityId: ms.id, entityLabel: ms.membershipNo,
    summary: `Rejected ${ms.membershipNo} from ${ms.memberName}: ${staffNote}`, changes: { status: { from: 'Pending', to: 'Rejected' } } }, req);
  if (req.body.notify !== false) await notify(membershipRejected(await loadSettings(), { fullName: ms.memberName, email: ms.memberEmail }, { ...ms, staffNote }));
  res.json(await memberDetail(ms.memberId));
}));

// Staff grant (complimentary, paid at the desk…). body: { tierId, startsOn?, days?, amount?, paymentMethod?, paymentReference?, staffNote?, notify? }
router.post('/:id/grant', wrap(async (req, res) => {
  const id = idParam(req);
  const m = await memberDetail(id);
  const d = validate(req.body, {
    tierId: { type: 'int', required: true, min: 1, message: 'Choose a tier.' },
    startsOn: { type: 'date' },
    days: { type: 'int', min: 1, max: 3660 },
    amount: { type: 'decimal', min: 0 },
    paymentMethod: { type: 'enum', values: MEMBER_PAYMENT_METHODS },
    paymentReference: { type: 'string', max: 80 },
    staffNote: { type: 'string', max: 500 },
  });
  const tier = await one('SELECT * FROM tiers WHERE id = $1 AND is_active', [d.tierId]);
  if (!tier) throw new HttpError(422, 'Choose an active tier.', { tierId: 'Choose an active tier.' });
  const done = await tx(async (db) => {
    const ms = await createMembership(db, { memberId: id, tierId: tier.id, kind: m.tierId === tier.id && m.vipActive ? 'Renewal' : 'Manual', amount: d.amount ?? 0,
      paymentMethod: d.paymentMethod, paymentReference: d.paymentReference, staffNote: d.staffNote });
    const activated = await activate(db, ms, { actor: req.admin.name, staffNote: d.staffNote, startsOn: d.startsOn });
    if (d.days && d.days !== tier.durationDays) {
      const end = addDays(activated.startsOn, d.days - 1);
      await db.run('UPDATE memberships SET ends_on = $1 WHERE id = $2', [end, ms.id]);
      await db.run('UPDATE members SET membership_expires_on = $1 WHERE id = $2', [end, id]);
      return { ...activated, endsOn: end };
    }
    return activated;
  });
  req.auditHandled = true;
  await logEvent({ action: 'Membership granted', module: 'members', entityType: 'Member', entityId: id, entityLabel: m.fullName,
    summary: `Granted ${tier.name} to ${m.fullName} (${done.membershipNo}) until ${done.endsOn}` }, req);
  if (req.body.notify) await notify(membershipActivated(await loadSettings(), m, done));
  res.json(await memberDetail(id));
}));

// Ends the current tier today (refund, abuse…).
router.post('/:id/end-membership', wrap(async (req, res) => {
  const id = idParam(req);
  const m = await memberDetail(id);
  if (!m.vipActive) throw new HttpError(409, 'This member has no active membership.');
  const reason = String(req.body.reason || '').slice(0, 500) || null;
  await tx(async (db) => {
    await db.run("UPDATE members SET membership_expires_on = ph_today() - 1, updated_at = now() WHERE id = $1", [id]);
    await db.run("UPDATE memberships SET status = 'Cancelled', ends_on = LEAST(ends_on, ph_today() - 1), staff_note = COALESCE($2::text, staff_note), updated_at = now() WHERE member_id = $1 AND status = 'Active'", [id, reason]);
  });
  res.json(await memberDetail(id));
}));

// Emails everyone whose membership ends within ?days (default 7).
router.post('/remind', wrap(async (req, res) => {
  const days = Math.min(Math.max(Number(req.body.days) || 7, 1), 30);
  const rows = await q(`SELECT m.id, m.full_name, m.email, m.membership_expires_on, t.name AS tier_name FROM members m JOIN tiers t ON t.id = m.tier_id
    WHERE m.status = 'Active' AND m.membership_expires_on BETWEEN ph_today() AND ph_today() + $1::int
      AND NOT EXISTS (SELECT 1 FROM memberships ms WHERE ms.member_id = m.id AND ms.status = 'Pending')`, [days]);
  const site = await loadSettings();
  let sent = 0;
  for (const m of rows) if (await notify(renewalReminder(site, m))) sent++;
  req.auditHandled = true;
  await logEvent({ action: 'Reminders sent', module: 'members', entityType: 'Member', summary: `Emailed renewal reminders to ${sent} of ${rows.length} member(s) expiring within ${days} days` }, req);
  res.json({ due: rows.length, sent });
}));

export default router;
