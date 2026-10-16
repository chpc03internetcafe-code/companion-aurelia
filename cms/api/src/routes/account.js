// Member portal (VIP) accounts. Everything under /me requires a session cookie.
//
// Sign-up only records a pending account and emails a confirmation link; the account is created when the
// link is opened, so nobody can claim an email they don't own. Members must be 18 or over.
import { Router } from 'express';
import { one, q, run, tx } from '../db/index.js';
import { validate } from '../lib/validate.js';
import {
  consumeToken, createMfaChallenge, createToken, endSession, hashPassword, passwordProblem, pendingSignups, REALMS, requireMember, revokeMemberSessions,
  sessionMember, startSession, throttle, verifyPassword,
} from '../lib/auth.js';
import { passSecondStep, securityRoutes } from '../lib/account-security.js';
import { clientIp, HttpError, idParam, wrap } from '../lib/http.js';
import { logEvent } from '../lib/audit.js';
import { notify } from '../lib/mailer.js';
import { membershipRequested, passwordChanged, passwordReset, siteUrl, verifyEmail } from '../lib/emails.js';
import { nextMemberNo } from '../lib/refs.js';
import { memberRegisteredNote, membershipRequestNote, notifyStaff } from '../lib/notifications.js';
import { loadSettings } from '../services/settings.js';
import { loadEvents, parseFees, publicBooking, SELECT_BOOKING } from '../services/bookings.js';
import { cardsByIds } from '../services/profiles.js';
import { createMembership, expireOld, MEMBER_PAYMENT_METHODS, requestKind, SELECT_MEMBERSHIP } from '../services/members.js';
import { phDate } from '../lib/dates.js';

const router = Router();
const devMode = () => !process.env.VERCEL && process.env.NODE_ENV !== 'production';
const site = () => siteUrl() || 'http://localhost:5173';
const actor = (m) => ({ actorType: 'Member', userName: m.fullName, userEmail: m.email });

// 18th birthday on or before today
const adult = (v) => {
  const [y, mo, d] = v.split('-').map(Number);
  return `${y + 18}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}` <= phDate();
};

const registerSchema = {
  firstName: { type: 'string', required: true, max: 80, label: 'First name' },
  lastName: { type: 'string', required: true, max: 80, label: 'Last name' },
  email: { type: 'email', required: true, label: 'Email' },
  phone: { type: 'phone' },
  birthdate: { type: 'date', required: true, label: 'Date of birth', check: (v) => (adult(v) ? null : 'Members must be 18 or over.') },
  marketingOptIn: { type: 'bool' },
};
const profileSchema = {
  firstName: registerSchema.firstName,
  lastName: registerSchema.lastName,
  phone: registerSchema.phone,
  marketingOptIn: registerSchema.marketingOptIn,
};

async function toMember(m) {
  const stats = await one(`SELECT
      (SELECT COUNT(*)::int FROM bookings WHERE member_id = $1 AND status IN ('Pending','Confirmed') AND (booking_date IS NULL OR booking_date >= ph_today())) AS open_bookings,
      (SELECT COUNT(*)::int FROM member_favorites WHERE member_id = $1) AS favorites,
      (SELECT COUNT(*)::int FROM memberships WHERE member_id = $1 AND status = 'Pending') AS pending_requests`, [m.id]);
  const rank = m.tierRank ?? 0;
  return {
    id: m.id, memberNo: m.memberNo, firstName: m.firstName, lastName: m.lastName, fullName: m.fullName, email: m.email, phone: m.phone,
    birthdate: m.birthdate, marketingOptIn: m.marketingOptIn, createdAt: m.createdAt,
    tier: m.tierId ? { id: m.tierId, name: m.tierName, slug: m.tierSlug, color: m.tierColor } : null,
    membershipExpiresOn: m.membershipExpiresOn, vipActive: rank > 0, tierRank: rank, stats,
  };
}
const fresh = async (req) => toMember(await sessionMember(req));
const withTier = (id) => one(`SELECT m.*, t.name AS tier_name, t.slug AS tier_slug, t.color AS tier_color,
    CASE WHEN t.id IS NOT NULL AND t.is_active AND m.membership_expires_on >= ph_today() THEN t.rank ELSE 0 END AS tier_rank
    FROM members m LEFT JOIN tiers t ON t.id = m.tier_id WHERE m.id = $1`, [id]);

// ---------- Sign-up and email confirmation ----------
async function sendVerification(email, pending) {
  const token = await createToken('verify', { email, data: pending });
  const url = `${site()}/account/verify-email?token=${token}`;
  const sent = await notify(verifyEmail(await loadSettings(), { name: pending.firstName, email, url }));
  return { sent, devLink: !sent && devMode() ? url : undefined };
}

router.post('/register', wrap(async (req, res) => {
  const limiter = throttle(`reg:${clientIp(req)}`, { max: 10 });
  const pwErr = passwordProblem(req.body.password);
  const data = validate(req.body, { ...registerSchema, ...(pwErr ? { password: { type: 'string', check: () => pwErr } } : {}) });
  if (!req.body.terms) throw new HttpError(422, 'Please confirm you are 18+ and accept the terms.', { terms: 'Required.' });
  const existing = await one('SELECT id, email_verified_at, status FROM members WHERE lower(email) = lower($1)', [data.email]);
  if (existing?.emailVerifiedAt) {
    limiter.fail();
    throw new HttpError(409, 'An account with this email already exists. Please sign in instead.', { email: 'Already registered — sign in instead.' });
  }
  if (existing?.status === 'Suspended') throw new HttpError(403, 'This email can’t be used to register. Please contact us.');
  limiter.fail(); // every sign-up sends an email, so count them all
  const pending = { ...data, passwordHash: await hashPassword(req.body.password) };
  const r = await sendVerification(data.email, pending);
  await logEvent({ ...actor({ fullName: `${data.firstName} ${data.lastName}`, email: data.email }), action: 'Signed up', module: 'members', entityType: 'Member',
    entityLabel: `${data.firstName} ${data.lastName}`, summary: `${data.firstName} ${data.lastName} signed up — waiting for email confirmation` }, req);
  res.status(201).json({ verificationSent: r.sent, email: data.email, devLink: r.devLink });
}));

// Always answers the same way, so it can't reveal which emails have signed up.
router.post('/verify-email/resend', wrap(async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  throttle(`resend:${clientIp(req)}`, { max: 5 }).fail();
  const [pending] = email ? await pendingSignups(email) : [];
  const active = await one('SELECT 1 AS x FROM members WHERE lower(email) = $1 AND email_verified_at IS NOT NULL', [email]);
  let devLink;
  if (pending && !active) devLink = (await sendVerification(email, pending)).devLink;
  res.json({ ok: true, devLink });
}));

router.post('/verify-email', wrap(async (req, res) => {
  const t = await consumeToken('verify', req.body.token);
  if (!t) throw new HttpError(410, 'This confirmation link has expired or was already used. Sign in, or request a new link.');
  const { email, data } = t;
  const existing = await one('SELECT id, email_verified_at, status FROM members WHERE lower(email) = lower($1)', [email]);
  if (existing?.emailVerifiedAt) throw new HttpError(409, 'This email is already confirmed. Please sign in.');
  if (existing?.status === 'Suspended') throw new HttpError(403, 'This account is suspended. Please contact us.');
  const id = await tx(async (db) => {
    if (existing) {
      // a member record staff created earlier with this email
      await db.run(`UPDATE members SET password_hash = $1, email_verified_at = now(), phone = COALESCE(phone, $2), birthdate = COALESCE(birthdate, $3),
          marketing_opt_in = $4, terms_accepted_at = now(), updated_at = now() WHERE id = $5`,
      [data.passwordHash, data.phone, data.birthdate, !!data.marketingOptIn, existing.id]);
      return existing.id;
    }
    const row = await db.one(
      `INSERT INTO members (member_no, first_name, last_name, email, phone, birthdate, marketing_opt_in, password_hash, email_verified_at, terms_accepted_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now(), now()) RETURNING id`,
      [await nextMemberNo(db), data.firstName, data.lastName, email, data.phone, data.birthdate, !!data.marketingOptIn, data.passwordHash]
    );
    return row.id;
  });
  await run("DELETE FROM member_tokens WHERE purpose = 'verify' AND email = $1", [email]);
  await startSession(req, res, id);
  const m = await one('SELECT * FROM members WHERE id = $1', [id]);
  await notifyStaff(memberRegisteredNote(m));
  await logEvent({ ...actor(m), action: 'Created', module: 'members', entityType: 'Member', entityId: id, entityLabel: m.fullName,
    summary: `${m.fullName} confirmed their email — member account ${m.memberNo} created` }, req);
  res.json(await toMember({ ...m, tierRank: 0 }));
}));

// ---------- Password reset ----------
router.post('/forgot-password', wrap(async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(422, 'Enter a valid email address.', { email: 'Enter a valid email address.' });
  throttle(`forgot:${clientIp(req)}`, { max: 5, windowMs: 3600000 }).fail();
  throttle(`forgot:${email}`, { max: 3, windowMs: 3600000 }).fail();
  const m = await one("SELECT id, full_name, email FROM members WHERE lower(email) = $1 AND status = 'Active' AND password_hash IS NOT NULL", [email]);
  let devLink;
  if (m) {
    const token = await createToken('reset', { email: m.email, memberId: m.id });
    const url = `${site()}/account/reset-password?token=${token}`;
    const sent = await notify(passwordReset(await loadSettings(), { name: m.fullName, email: m.email, url }));
    if (!sent && devMode()) devLink = url;
    await logEvent({ ...actor(m), action: 'Password reset sent', module: 'members', entityType: 'Member', entityId: m.id, entityLabel: m.fullName, summary: `${m.fullName} asked for a password reset link` }, req);
  }
  res.json({ ok: true, devLink });
}));

router.post('/reset-password', wrap(async (req, res) => {
  const pwErr = passwordProblem(req.body.password);
  if (pwErr) throw new HttpError(422, pwErr, { password: pwErr });
  const t = await consumeToken('reset', req.body.token);
  if (!t) throw new HttpError(410, 'This link has expired or was already used. Request a new one from the sign-in page.');
  const m = await one("SELECT * FROM members WHERE id = $1 AND lower(email) = lower($2) AND status = 'Active'", [t.memberId, t.email]);
  if (!m) throw new HttpError(410, 'This link is no longer valid. Please contact us.');
  await run('UPDATE members SET password_hash = $1, email_verified_at = COALESCE(email_verified_at, now()), updated_at = now() WHERE id = $2', [await hashPassword(req.body.password), m.id]);
  await revokeMemberSessions(m.id);
  await notify(passwordChanged(await loadSettings(), { name: m.fullName, email: m.email }));
  await logEvent({ ...actor(m), action: 'Password changed', module: 'members', entityType: 'Member', entityId: m.id, entityLabel: m.fullName, summary: `${m.fullName} set a new password from an email link; other devices signed out` }, req);
  // an email link alone doesn't get past two-step sign-in
  if (m.totpEnabledAt) return res.json({ ok: true, mfaRequired: true, mfaToken: await createMfaChallenge(m.id) });
  await startSession(req, res, m.id);
  res.json({ ok: true });
}));

// ---------- Sign-in ----------
router.post('/login', wrap(async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const limiter = throttle(`login:${clientIp(req)}:${email}`, { max: 8 });
  const m = await one('SELECT * FROM members WHERE lower(email) = $1', [email]);
  const ok = m?.passwordHash && (await verifyPassword(String(req.body.password || ''), m.passwordHash));
  if (!ok) {
    limiter.fail();
    const pending = !m && email ? (await pendingSignups(email)).length > 0 : false;
    throw new HttpError(401, pending ? 'Please confirm your email first — check your inbox for our link.' : 'Incorrect email or password.', { password: 'Incorrect email or password.', code: pending ? 'unverified' : undefined });
  }
  if (!m.emailVerifiedAt) throw new HttpError(401, 'Please confirm your email first — check your inbox for our link.', { code: 'unverified' });
  if (m.status !== 'Active') throw new HttpError(403, 'This account is suspended. Please contact us.');
  limiter.clear();
  const remember = req.body.remember !== false;
  if (m.totpEnabledAt) return res.json({ mfaRequired: true, mfaToken: await createMfaChallenge(m.id, remember) });
  await startSession(req, res, m.id, remember);
  await logEvent({ ...actor(m), action: 'Signed in', module: 'members', entityType: 'Member', entityId: m.id, entityLabel: m.fullName, summary: `${m.fullName} signed in to the member portal` }, req);
  res.json(await toMember(await withTier(m.id)));
}));

// Second step: the code from the authenticator app (or a backup code) for a password that was already accepted.
router.post('/login/2fa', wrap(async (req, res) => {
  const { accountId, remember, used } = await passSecondStep(req, REALMS.member);
  const m = await withTier(accountId);
  if (!m || m.status !== 'Active') throw new HttpError(403, 'This account is suspended. Please contact us.');
  await startSession(req, res, m.id, remember);
  const left = used === 'backup' ? JSON.parse(m.totpBackupCodes || '[]').length : null;
  await logEvent({ ...actor(m), action: 'Signed in', module: 'members', entityType: 'Member', entityId: m.id, entityLabel: m.fullName,
    summary: `${m.fullName} signed in to the member portal with ${used === 'app' ? 'an authenticator code' : `a backup code (${left} left)`}` }, req);
  res.json({ ...(await toMember(m)), backupCodesLeft: left });
}));

router.post('/logout', wrap(async (req, res) => {
  await endSession(req, res);
  res.status(204).end();
}));

router.get('/session', wrap(async (req, res) => {
  const m = await sessionMember(req);
  res.set('Cache-Control', 'no-store');
  res.json({ user: m ? await toMember(m) : null });
}));

// ---------- My account ----------
router.use('/me', requireMember);

router.get('/me', wrap(async (req, res) => res.json(await toMember(req.member))));

router.put('/me', wrap(async (req, res) => {
  const data = validate(req.body, profileSchema);
  await run('UPDATE members SET first_name = $1, last_name = $2, phone = $3, marketing_opt_in = $4, updated_at = now() WHERE id = $5',
    [data.firstName, data.lastName, data.phone, data.marketingOptIn, req.member.id]);
  await logEvent({ ...actor(req.member), action: 'Updated', module: 'members', entityType: 'Member', entityId: req.member.id, entityLabel: req.member.fullName, summary: `${req.member.fullName} updated their details in the portal` }, req);
  res.json(await fresh(req));
}));

// Password, signed-in devices and two-step sign-in.
securityRoutes(router, REALMS.member, {
  account: (req) => req.member,
  log: (req, m, action, summary) => logEvent({ ...actor(m), action, module: 'members', entityType: 'Member', entityId: m.id, entityLabel: m.fullName, summary: `${m.fullName} ${summary}` }, req),
});

// ---------- Bookings ----------
router.get('/me/bookings', wrap(async (req, res) => {
  const rows = (await q(`${SELECT_BOOKING} WHERE b.member_id = $1 ORDER BY COALESCE(b.starts_at, b.created_at::timestamp) DESC`, [req.member.id])).map(parseFees);
  res.json(await Promise.all(rows.map(async (b) => publicBooking(b, await loadEvents({ q }, b.id, true)))));
}));

// ---------- Favourites ----------
const favoriteIds = async (memberId) => (await q('SELECT profile_id FROM member_favorites WHERE member_id = $1 ORDER BY created_at DESC', [memberId])).map((r) => r.profileId);

router.get('/me/favorites', wrap(async (req, res) => {
  const ids = await favoriteIds(req.member.id);
  res.json({ ids, items: await cardsByIds(ids, req.member.tierRank) });
}));

router.put('/me/favorites/:profileId', wrap(async (req, res) => {
  const p = await one("SELECT id FROM profiles WHERE id = $1 AND status = 'Published'", [idParam(req, 'profileId')]);
  if (!p) throw new HttpError(404, 'Profile not found.');
  await run('INSERT INTO member_favorites (member_id, profile_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [req.member.id, p.id]);
  res.json({ ids: await favoriteIds(req.member.id) });
}));

router.delete('/me/favorites/:profileId', wrap(async (req, res) => {
  await run('DELETE FROM member_favorites WHERE member_id = $1 AND profile_id = $2', [req.member.id, idParam(req, 'profileId')]);
  res.json({ ids: await favoriteIds(req.member.id) });
}));

// Favourites saved in the browser before signing in are added to the account.
router.post('/me/favorites/merge', wrap(async (req, res) => {
  const ids = (Array.isArray(req.body.ids) ? req.body.ids : []).map(Number).filter(Number.isInteger).slice(0, 100);
  if (ids.length) {
    await run(`INSERT INTO member_favorites (member_id, profile_id)
      SELECT $1, id FROM profiles WHERE id = ANY($2::int[]) AND status = 'Published' ON CONFLICT DO NOTHING`, [req.member.id, ids]);
  }
  res.json({ ids: await favoriteIds(req.member.id) });
}));

// ---------- Membership ----------
router.get('/me/membership', wrap(async (req, res) => {
  await expireOld({ run });
  const s = await loadSettings();
  const [history, tiers] = await Promise.all([
    q(`${SELECT_MEMBERSHIP} WHERE ms.member_id = $1 ORDER BY ms.created_at DESC`, [req.member.id]),
    q('SELECT id, name, slug, rank, description, price, duration_days, perks, color FROM tiers WHERE is_active AND is_public ORDER BY rank, sort_order'),
  ]);
  const m = req.member;
  const daysLeft = m.tierRank > 0 ? Math.round((Date.parse(m.membershipExpiresOn) - Date.parse(phDate())) / 86400000) + 1 : 0;
  res.json({
    current: m.tierId ? { tierId: m.tierId, tierName: m.tierName, color: m.tierColor, expiresOn: m.membershipExpiresOn, active: m.tierRank > 0, daysLeft } : null,
    history: history.map((h) => ({ membershipNo: h.membershipNo, tierName: h.tierName, kind: h.kind, status: h.status, startsOn: h.startsOn, endsOn: h.endsOn, amount: h.amount,
      paymentMethod: h.paymentMethod, paymentReference: h.paymentReference, memberNote: h.memberNote, staffNote: h.status === 'Rejected' ? h.staffNote : null, createdAt: h.createdAt })),
    tiers: tiers.map((t) => ({ ...t, perks: JSON.parse(t.perks || '[]'), kind: requestKind({ ...m, currentRank: m.tierRank }, t) })),
    paymentMethods: MEMBER_PAYMENT_METHODS,
    instructions: s.memberPaymentInstructions,
  });
}));

router.post('/me/membership', wrap(async (req, res) => {
  const data = validate(req.body, {
    tierId: { type: 'int', required: true, min: 1, message: 'Choose a tier.' },
    paymentMethod: { type: 'enum', values: MEMBER_PAYMENT_METHODS, required: true, label: 'Payment method' },
    paymentReference: { type: 'string', required: true, max: 80, label: 'Payment reference' },
    note: { type: 'string', max: 500 },
  });
  throttle(`ms:${req.member.id}`, { max: 5, windowMs: 3600000 }).fail();
  const tier = await one('SELECT * FROM tiers WHERE id = $1 AND is_active AND is_public', [data.tierId]);
  if (!tier) throw new HttpError(422, 'Choose one of the available tiers.', { tierId: 'Choose a tier.' });
  if (await one("SELECT 1 AS x FROM memberships WHERE member_id = $1 AND status = 'Pending'", [req.member.id])) {
    throw new HttpError(409, 'You already have a request waiting for approval. We’ll email you once it’s checked.');
  }
  const kind = requestKind({ ...req.member, currentRank: req.member.tierRank }, tier);
  const ms = await tx((db) => createMembership(db, {
    memberId: req.member.id, tierId: tier.id, kind, amount: tier.price, paymentMethod: data.paymentMethod, paymentReference: data.paymentReference, memberNote: data.note,
  }));
  await notifyStaff(membershipRequestNote(ms));
  await logEvent({ ...actor(req.member), action: 'Membership requested', module: 'members', entityType: 'Membership', entityId: ms.id, entityLabel: ms.membershipNo,
    summary: `${req.member.fullName} requested ${kind.toLowerCase()} of ${tier.name} (payment ref ${data.paymentReference})` }, req);
  await notify(membershipRequested(await loadSettings(), req.member, ms));
  res.status(201).json({ membershipNo: ms.membershipNo, status: ms.status, kind });
}));

router.delete('/me/membership/:no', wrap(async (req, res) => {
  const n = await run("UPDATE memberships SET status = 'Cancelled', updated_at = now() WHERE membership_no = $1 AND member_id = $2 AND status = 'Pending'", [String(req.params.no), req.member.id]);
  if (!n) throw new HttpError(404, 'No pending request with that number.');
  res.status(204).end();
}));

// ---------- VIP collections ----------
router.get('/me/collections', wrap(async (req, res) => {
  const rank = req.member.tierRank;
  const rows = await q(`SELECT c.id, c.title, c.slug, c.description, t.name AS tier_name, COALESCE(t.rank, 1) AS min_rank,
      (SELECT COUNT(*)::int FROM collection_profiles cp JOIN profiles p ON p.id = cp.profile_id WHERE cp.collection_id = c.id AND p.status = 'Published') AS profile_count
    FROM collections c LEFT JOIN tiers t ON t.id = c.min_tier_id WHERE c.is_published ORDER BY c.sort_order, c.title`);
  res.json(rows.map((c) => ({ ...c, locked: rank < c.minRank })));
}));

router.get('/me/collections/:slug', wrap(async (req, res) => {
  const c = await one(`SELECT c.id, c.title, c.slug, c.description, t.name AS tier_name, COALESCE(t.rank, 1) AS min_rank FROM collections c LEFT JOIN tiers t ON t.id = c.min_tier_id
    WHERE c.slug = $1 AND c.is_published`, [req.params.slug]);
  if (!c) throw new HttpError(404, 'Collection not found.');
  if (req.member.tierRank < c.minRank) throw new HttpError(403, `This collection is for ${c.tierName || 'VIP'} members.`, { code: 'tier_required' });
  const ids = (await q('SELECT profile_id FROM collection_profiles WHERE collection_id = $1 ORDER BY sort_order', [c.id])).map((r) => r.profileId);
  res.json({ ...c, items: await cardsByIds(ids, req.member.tierRank) });
}));

export default router;
