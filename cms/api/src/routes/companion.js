// Companion portal (/api/companion): the person behind a profile signs in to answer booking requests, keep their
// availability current and send profile updates (wording, photos) that staff approve before they go live.
//
// Accounts are created by staff (CMS → profile → Portal access), who email an invitation link; the companion
// chooses a password from it. Companions never see client contact details — the concierge stays in between.
import crypto from 'node:crypto';
import { devLinksAllowed } from '../lib/security.js';
import { Router } from 'express';
import { one, q, run, tx } from '../db/index.js';
import {
  createMfaChallenge, endSession, hashPassword, passwordProblem, readCookie, REALMS, revokeMemberSessions, SECRET_COLUMNS, sha256, startSession, throttle,
  checkPassword, loginLimiter, upgradeHash,
} from '../lib/auth.js';
import { backupCodesLeft, passSecondStep, securityRoutes } from '../lib/account-security.js';
import { clientIp, HttpError, wrap } from '../lib/http.js';
import { validate } from '../lib/validate.js';
import { fromMin, phDate, phMinutesNow } from '../lib/dates.js';
import { logEvent } from '../lib/audit.js';
import { notify } from '../lib/mailer.js';
import { bookingStatusChanged, passwordChanged, passwordReset } from '../lib/emails.js';
import { companionAnsweredNote, notifyStaff, profileChangeNote } from '../lib/notifications.js';
import { removeImages, saveImage, imageUpload } from '../lib/storage.js';
import { loadSettings } from '../services/settings.js';
import { addEvent, loadBooking, parseFees, publicBooking, SELECT_BOOKING } from '../services/bookings.js';
import { loadSchedule, parseBlocks, parseTimeOff, saveSchedule, saveTimeOff } from '../services/schedule.js';
import { DETAIL_FIELDS, detailsSchema } from '../services/companions.js';
import { chatState, lastMessages, messageCounts, readChat, sendChat } from '../services/chat.js';

const router = Router();
const realm = REALMS.companion;
const upload = imageUpload(6);
// email links are shown on screen only on a developer's machine (see lib/security.js)
const devMode = devLinksAllowed;
const site = () => (process.env.SITE_URL || 'http://localhost:5173').replace(/\/+$/, '');

const ACCOUNT_COLUMNS = `ca.*, p.display_name, p.slug, p.status AS profile_status, p.away_until, p.away_note,
    (SELECT url FROM profile_media pm WHERE pm.profile_id = p.id AND pm.kind = 'photo' AND NOT pm.vip_only ORDER BY pm.is_primary DESC, pm.sort_order, pm.id LIMIT 1) AS photo`;
const SELECT_ACCOUNT = `SELECT ${ACCOUNT_COLUMNS} FROM companion_accounts ca JOIN profiles p ON p.id = ca.profile_id`;

const actor = (a) => ({ actorType: 'Companion', userName: a.displayName, userEmail: a.email });
const log = (req, a, action, summary, extra = {}) => logEvent({ ...actor(a), action, module: 'profiles', entityType: 'Profile', entityId: a.profileId,
  entityLabel: a.displayName, summary: `${a.displayName} ${summary}`, ...extra }, req);

/** The signed-in companion (account + profile basics), or null. Retired profiles can't sign in. */
export async function sessionCompanion(req) {
  const token = readCookie(req, realm.cookie);
  if (!token) return null;
  const row = await one(`SELECT ${ACCOUNT_COLUMNS}, s.id AS session_id
    FROM companion_sessions s JOIN companion_accounts ca ON ca.id = s.account_id JOIN profiles p ON p.id = ca.profile_id
    WHERE s.token_hash = $1 AND s.expires_at > now() AND ca.status = 'Active' AND ca.password_hash IS NOT NULL AND p.status <> 'Retired'`, [sha256(token)]);
  if (!row) return null;
  run("UPDATE companion_sessions SET last_seen_at = now() WHERE id = $1 AND last_seen_at < now() - INTERVAL '10 minutes'", [row.sessionId]).catch(() => {});
  for (const k of SECRET_COLUMNS) delete row[k];
  return { ...row, fullName: row.displayName };
}

const requireCompanion = async (req, _res, next) => {
  try {
    req.companion = await sessionCompanion(req);
    if (!req.companion) throw new HttpError(401, 'Please sign in to continue.');
    next();
  } catch (e) {
    next(e);
  }
};

async function toCompanion(a) {
  const stats = await one(`SELECT
      (SELECT COUNT(*)::int FROM bookings WHERE profile_id = $1 AND kind = 'Booking' AND status = 'Pending' AND starts_at > ph_now()) AS pending_requests,
      (SELECT COUNT(*)::int FROM bookings WHERE profile_id = $1 AND kind = 'Booking' AND status = 'Confirmed' AND starts_at > ph_now()) AS upcoming,
      (SELECT COUNT(*)::int FROM profile_change_requests WHERE profile_id = $1 AND status = 'Pending') AS pending_changes,
      (SELECT COUNT(*)::int FROM booking_messages bm JOIN bookings b ON b.id = bm.booking_id
        WHERE b.profile_id = $1 AND bm.sender <> 'Companion' AND bm.id > b.companion_seen_message_id) AS unread_messages`, [a.profileId]);
  return {
    id: a.id, email: a.email, name: a.displayName, twoStep: !!a.totpEnabledAt, lastLoginAt: a.lastLoginAt,
    profile: { id: a.profileId, slug: a.slug, status: a.profileStatus, photo: a.photo, awayUntil: a.awayUntil, awayNote: a.awayNote },
    stats,
  };
}
const accountById = (id) => one(`${SELECT_ACCOUNT} WHERE ca.id = $1`, [id]);

// ---------- Email links (invitation / password reset) ----------
const TOKEN_HOURS = { invite: 72, reset: 2 };

export async function createCompanionToken(purpose, accountId) {
  const token = crypto.randomBytes(32).toString('base64url');
  await run('DELETE FROM companion_tokens WHERE (purpose = $1 AND account_id = $2) OR expires_at < now()', [purpose, accountId]);
  await run('INSERT INTO companion_tokens (purpose, account_id, token_hash, expires_at) VALUES ($1, $2, $3, $4)', [
    purpose, accountId, sha256(token), new Date(Date.now() + TOKEN_HOURS[purpose] * 3600000),
  ]);
  return token;
}

async function findToken(purpose, token, consume = false) {
  if (typeof token !== 'string' || token.length < 20 || token.length > 100) return null;
  const sql = consume
    ? 'DELETE FROM companion_tokens WHERE purpose = $1 AND token_hash = $2 RETURNING account_id, expires_at'
    : 'SELECT account_id, expires_at FROM companion_tokens WHERE purpose = $1 AND token_hash = $2';
  const row = await one(sql, [purpose, sha256(token)]);
  return row && new Date(row.expiresAt) > new Date() ? row.accountId : null;
}

// ---------- Sign-in ----------
router.post('/login', wrap(async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const limiter = await loginLimiter('clogin', req, email);
  const a = await one(`${SELECT_ACCOUNT} WHERE lower(ca.email) = $1`, [email]);
  if (a?.status === 'Invited') throw new HttpError(401, 'Your access isn’t set up yet — open the invitation link we emailed you to choose a password.');
  const ok = await checkPassword(req.body.password, a?.passwordHash);
  if (!ok) {
    await limiter.fail();
    throw new HttpError(401, 'Incorrect email or password.', { password: 'Incorrect email or password.' });
  }
  if (a.status !== 'Active' || a.profileStatus === 'Retired') throw new HttpError(403, 'Portal access for this profile is paused. Please contact the concierge.');
  await limiter.clear();
  await upgradeHash('companion_accounts', a.id, req.body.password, a.passwordHash);
  const remember = req.body.remember !== false;
  if (a.totpEnabledAt) return res.json({ mfaRequired: true, mfaToken: await createMfaChallenge(a.id, remember, realm) });
  await startSession(req, res, a.id, remember, realm);
  await log(req, a, 'Signed in', 'signed in to the companion portal');
  res.json(await toCompanion(a));
}));

router.post('/login/2fa', wrap(async (req, res) => {
  const { accountId, remember, used } = await passSecondStep(req, realm);
  const a = await accountById(accountId);
  if (!a || a.status !== 'Active' || a.profileStatus === 'Retired') throw new HttpError(403, 'Portal access for this profile is paused. Please contact the concierge.');
  await startSession(req, res, a.id, remember, realm);
  const left = used === 'backup' ? await backupCodesLeft(a.id, realm) : null;
  await log(req, a, 'Signed in', `signed in to the companion portal with ${used === 'app' ? 'an authenticator code' : `a backup code (${left} left)`}`);
  res.json({ ...(await toCompanion(a)), backupCodesLeft: left });
}));

router.post('/logout', wrap(async (req, res) => {
  await endSession(req, res, realm);
  res.status(204).end();
}));

router.get('/session', wrap(async (req, res) => {
  const a = await sessionCompanion(req);
  res.set('Cache-Control', 'no-store');
  res.json({ user: a ? await toCompanion(a) : null });
}));

// ---------- Invitation: choose a password ----------
router.post('/invite/check', wrap(async (req, res) => {
  await (await throttle(`cinvite:${clientIp(req)}`, { max: 20 })).fail();
  const id = await findToken('invite', req.body.token);
  const a = id && (await accountById(id));
  if (!a || a.status !== 'Invited') throw new HttpError(410, 'This invitation has expired or was already used. Ask the concierge for a new one.');
  res.json({ name: a.displayName, email: a.email });
}));

router.post('/invite/accept', wrap(async (req, res) => {
  const pwErr = passwordProblem(req.body.password);
  if (pwErr) throw new HttpError(422, pwErr, { password: pwErr });
  const id = await findToken('invite', req.body.token, true);
  const a = id && (await accountById(id));
  if (!a || a.status !== 'Invited') throw new HttpError(410, 'This invitation has expired or was already used. Ask the concierge for a new one.');
  await run("UPDATE companion_accounts SET password_hash = $1, status = 'Active', activated_at = now(), updated_at = now() WHERE id = $2", [await hashPassword(req.body.password), a.id]);
  await startSession(req, res, a.id, true, realm);
  await log(req, a, 'Portal activated', 'set a password and activated their companion portal');
  res.json(await toCompanion(await accountById(a.id)));
}));

// ---------- Password reset ----------
router.post('/forgot-password', wrap(async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(422, 'Enter a valid email address.', { email: 'Enter a valid email address.' });
  await (await throttle(`cforgot:${clientIp(req)}`, { max: 5, windowMs: 3600000 })).fail();
  await (await throttle(`cforgot:${email}`, { max: 3, windowMs: 3600000 })).fail();
  const a = await one(`${SELECT_ACCOUNT} WHERE lower(ca.email) = $1 AND ca.status = 'Active'`, [email]);
  let devLink;
  if (a) {
    const url = `${site()}/companion/reset-password?token=${await createCompanionToken('reset', a.id)}`;
    const sent = await notify(passwordReset(await loadSettings(), { name: a.displayName, email: a.email, url }));
    if (!sent && devMode()) devLink = url;
  }
  res.json({ ok: true, devLink });
}));

router.post('/reset-password', wrap(async (req, res) => {
  const pwErr = passwordProblem(req.body.password);
  if (pwErr) throw new HttpError(422, pwErr, { password: pwErr });
  const id = await findToken('reset', req.body.token, true);
  const a = id && (await accountById(id));
  if (!a || a.status !== 'Active') throw new HttpError(410, 'This link has expired or was already used. Request a new one from the sign-in page.');
  await run('UPDATE companion_accounts SET password_hash = $1, updated_at = now() WHERE id = $2', [await hashPassword(req.body.password), a.id]);
  await revokeMemberSessions(a.id, null, realm);
  await notify(passwordChanged(await loadSettings(), { name: a.displayName, email: a.email }));
  await log(req, a, 'Password changed', 'set a new password from an email link; other devices signed out');
  if (a.totpEnabledAt) return res.json({ ok: true, mfaRequired: true, mfaToken: await createMfaChallenge(a.id, true, realm) });
  await startSession(req, res, a.id, true, realm);
  res.json({ ok: true });
}));

// ---------- Signed in ----------
router.use('/me', requireCompanion);

router.get('/me', wrap(async (req, res) => res.json(await toCompanion(req.companion))));

securityRoutes(router, realm, { account: (req) => req.companion, log: (req, a, action, summary) => log(req, a, action, summary) });

// ---------- Booking requests ----------
// What a companion sees of a booking: no client email, phone or member details.
const firstName = (n) => String(n || '').trim().split(/\s+/)[0];
const forCompanion = (b, counts = {}) => ({
  reference: b.reference, status: b.status, rateLabel: b.rateLabel, durationMinutes: b.durationMinutes, date: b.bookingDate, time: b.startTime,
  endDate: b.endDate, endTime: b.endTime, locationName: b.locationName, meetingPlace: b.meetingPlace, clientName: firstName(b.clientName),
  clientNotes: b.clientNotes, ratePrice: b.ratePrice, createdAt: b.createdAt, isMember: !!b.memberNo, rescheduleCount: b.rescheduleCount,
  canRespond: b.status === 'Pending' && `${b.bookingDate}T${b.startTime}` > phIsoNow(),
  chat: chatState(b), messageCount: counts[b.id]?.total || 0, unreadMessages: counts[b.id]?.unread || 0,
});
const SELECT_MINE = SELECT_BOOKING;
const phIsoNow = () => `${phDate()}T${fromMin(phMinutesNow())}`;

router.get('/me/bookings', wrap(async (req, res) => {
  const scope = { pending: "b.status = 'Pending' AND b.starts_at > ph_now()", upcoming: "b.status = 'Confirmed' AND b.starts_at > ph_now()", past: "b.starts_at <= ph_now() OR b.status NOT IN ('Pending','Confirmed')" }[req.query.scope] || 'TRUE';
  const order = req.query.scope === 'past' ? 'b.starts_at DESC' : 'b.starts_at ASC';
  const rows = await q(`${SELECT_MINE} WHERE b.profile_id = $1 AND b.kind = 'Booking' AND (${scope}) ORDER BY ${order} LIMIT 200`, [req.companion.profileId]);
  const counts = await messageCounts('Companion', 'b.profile_id', req.companion.profileId);
  res.json(rows.map(parseFees).map((b) => forCompanion(b, counts)));
}));

async function myBooking(req) {
  const b = await one(`${SELECT_MINE} WHERE b.reference = $1 AND b.profile_id = $2 AND b.kind = 'Booking'`, [String(req.params.ref), req.companion.profileId]);
  if (!b) throw new HttpError(404, 'Booking not found.');
  return parseFees(b);
}

/** Accept or decline a pending request; the client is emailed and staff see it in their notifications. */
async function answer(req, res, accept) {
  const a = req.companion;
  const b = await myBooking(req);
  const { reason } = validate(req.body, { reason: { type: 'string', max: 300 } });
  const status = accept ? 'Confirmed' : 'Declined';
  const clientMessage = accept ? null : 'Unfortunately the companion isn’t available at this time. Please choose another time or contact the concierge.';
  await tx(async (db) => {
    const cur = await db.one('SELECT status, starts_at > ph_now() AS future FROM bookings WHERE id = $1 FOR UPDATE', [b.id]);
    if (cur.status !== 'Pending') throw new HttpError(409, `This request is already ${cur.status.toLowerCase()}.`);
    if (!cur.future) throw new HttpError(409, 'This request’s time has passed. Please contact the concierge.');
    await db.run(`UPDATE bookings SET status = $1::text, cancel_reason = CASE WHEN $1::text = 'Declined' THEN $2::text ELSE NULL END,
      cancelled_by = CASE WHEN $1::text = 'Declined' THEN 'Companion' ELSE NULL END, updated_at = now() WHERE id = $3`, [status, clientMessage, b.id]);
    await addEvent(db, b.id, { status, title: accept ? 'Booking confirmed' : 'Request declined', note: clientMessage, actor: a.displayName });
    if (reason) await addEvent(db, b.id, { title: 'Note from the companion', note: reason, actor: a.displayName, visible: false });
  });
  await run('UPDATE profiles SET last_active_at = now() WHERE id = $1', [a.profileId]);
  const after = await loadBooking({ one }, 'b.id', b.id);
  const email = bookingStatusChanged(await loadSettings(), publicBooking(after), after.clientEmail, { status, message: clientMessage });
  if (email) await notify(email);
  await notifyStaff(companionAnsweredNote(after, accept, reason));
  await logEvent({ ...actor(a), action: accept ? 'Accepted' : 'Declined', module: 'bookings', entityType: 'Booking', entityId: b.id, entityLabel: b.reference,
    summary: `${a.displayName} ${accept ? 'accepted' : 'declined'} ${b.reference} (${b.rateLabel}, ${b.bookingDate} ${b.startTime})${reason ? ` — “${reason}”` : ''}` }, req);
  res.json(forCompanion(await myBooking(req)));
}
router.post('/me/bookings/:ref/accept', wrap((req, res) => answer(req, res, true)));
router.post('/me/bookings/:ref/decline', wrap((req, res) => answer(req, res, false)));

// Inbox: every booking with messages, plus confirmed upcoming ones where a chat can be started. Unread first,
// then the most recent conversation. The portal polls this for new-message alerts, so it stays one light query.
router.get('/me/messages', wrap(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const pid = req.companion.profileId;
  const rows = (await q(`${SELECT_MINE} WHERE b.profile_id = $1 AND b.kind = 'Booking'
      AND (EXISTS (SELECT 1 FROM booking_messages bm WHERE bm.booking_id = b.id) OR (b.status = 'Confirmed' AND b.starts_at > ph_now()))
    ORDER BY b.starts_at LIMIT 100`, [pid])).map(parseFees);
  const [counts, last] = await Promise.all([messageCounts('Companion', 'b.profile_id', pid), lastMessages(rows.map((b) => b.id))]);
  const threads = rows.map((b) => {
    const m = last[b.id];
    return {
      reference: b.reference, status: b.status, clientName: firstName(b.clientName), rateLabel: b.rateLabel, date: b.bookingDate, time: b.startTime,
      open: !!chatState(b)?.open, unread: counts[b.id]?.unread || 0, total: counts[b.id]?.total || 0,
      last: m ? { id: m.id, from: m.sender === 'Companion' ? 'me' : m.sender === 'Concierge' ? 'concierge' : 'them', preview: m.preview, at: m.at } : null,
    };
  });
  const when = (t) => (t.last ? Date.parse(t.last.at) : 0);
  threads.sort((a, b) => (b.unread > 0) - (a.unread > 0) || when(b) - when(a));
  res.json({ unread: threads.reduce((n, t) => n + t.unread, 0), threads });
}));

// Chat with the client (confirmed bookings). `after` = last message id the portal already has.
router.get('/me/bookings/:ref/messages', wrap(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json(await readChat(await myBooking(req), 'Companion', req.query.after));
}));

router.post('/me/bookings/:ref/messages', wrap(async (req, res) => {
  const b = await myBooking(req);
  await sendChat(b, 'Companion', req.body.body);
  run('UPDATE profiles SET last_active_at = now() WHERE id = $1', [req.companion.profileId]).catch(() => {});
  res.status(201).json(await readChat(b, 'Companion', req.body.after));
}));

// ---------- Availability (goes live straight away) ----------
const availability = async (profileId) => {
  const p = await one('SELECT away_until, away_note FROM profiles WHERE id = $1', [profileId]);
  return {
    schedule: await loadSchedule({ q }, profileId),
    timeOff: await q('SELECT start_date, end_date, note FROM profile_time_off WHERE profile_id = $1 AND end_date >= ph_today() ORDER BY start_date', [profileId]),
    awayUntil: p.awayUntil, awayNote: p.awayNote,
  };
};

router.get('/me/availability', wrap(async (req, res) => res.json(await availability(req.companion.profileId))));

router.put('/me/schedule', wrap(async (req, res) => {
  const blocks = parseBlocks(req.body.blocks);
  await tx((db) => saveSchedule(db, req.companion.profileId, blocks));
  await log(req, req.companion, 'Availability updated', `updated their weekly availability (${blocks.length} block${blocks.length === 1 ? '' : 's'})`);
  res.json(await availability(req.companion.profileId));
}));

router.put('/me/time-off', wrap(async (req, res) => {
  const items = parseTimeOff(req.body.items);
  // past time off isn't shown in the portal, so keep it as it was
  await tx(async (db) => {
    const past = await db.q('SELECT start_date, end_date, note FROM profile_time_off WHERE profile_id = $1 AND end_date < ph_today()', [req.companion.profileId]);
    await saveTimeOff(db, req.companion.profileId, [...past, ...items]);
  });
  await log(req, req.companion, 'Time off updated', `updated their time off (${items.length} period${items.length === 1 ? '' : 's'})`);
  res.json(await availability(req.companion.profileId));
}));

router.put('/me/away', wrap(async (req, res) => {
  const d = validate(req.body, { awayUntil: { type: 'date' }, awayNote: { type: 'string', max: 200 } });
  await run('UPDATE profiles SET away_until = $1, away_note = $2, updated_at = now() WHERE id = $3', [d.awayUntil, d.awayUntil ? d.awayNote : null, req.companion.profileId]);
  await log(req, req.companion, 'Away updated', d.awayUntil ? `marked themselves away until ${d.awayUntil}` : 'marked themselves as back');
  res.json(await availability(req.companion.profileId));
}));

// ---------- Profile updates (staff approve them first) ----------
const parseRequest = (r) => ({ id: r.id, kind: r.kind, status: r.status, data: r.data ? JSON.parse(r.data) : null, photoUrl: r.photoUrl, staffNote: r.staffNote,
  createdAt: r.createdAt, decidedAt: r.decidedAt });

async function myProfile(profileId) {
  const p = await one(`SELECT ${DETAIL_FIELDS.map(([, col]) => col).join(', ')} FROM profiles WHERE id = $1`, [profileId]);
  const [media, requests] = await Promise.all([
    q("SELECT id, kind, url, poster_url, alt_text, is_primary, vip_only FROM profile_media WHERE profile_id = $1 ORDER BY is_primary DESC, sort_order, id", [profileId]),
    q("SELECT * FROM profile_change_requests WHERE profile_id = $1 AND (status = 'Pending' OR decided_at > now() - INTERVAL '30 days') ORDER BY created_at DESC LIMIT 40", [profileId]),
  ]);
  return { fields: Object.fromEntries(DETAIL_FIELDS.map(([k]) => [k, p[k] ?? null])), media, requests: requests.map(parseRequest) };
}

router.get('/me/profile', wrap(async (req, res) => res.json(await myProfile(req.companion.profileId))));

router.post('/me/profile/details', wrap(async (req, res) => {
  const a = req.companion;
  const d = validate(req.body, detailsSchema);
  const cur = (await myProfile(a.profileId)).fields;
  const changed = Object.fromEntries(DETAIL_FIELDS.map(([k]) => k).filter((k) => (d[k] ?? null) !== (cur[k] ?? null)).map((k) => [k, d[k] ?? null]));
  if (!Object.keys(changed).length) throw new HttpError(422, 'Nothing has changed yet.');
  // one pending wording update at a time: a new one replaces the previous one
  const pending = await one("SELECT id FROM profile_change_requests WHERE profile_id = $1 AND kind = 'details' AND status = 'Pending'", [a.profileId]);
  if (pending) await run('UPDATE profile_change_requests SET data = $1, created_at = now() WHERE id = $2', [JSON.stringify(changed), pending.id]);
  else await run("INSERT INTO profile_change_requests (profile_id, kind, data) VALUES ($1, 'details', $2)", [a.profileId, JSON.stringify(changed)]);
  await notifyStaff(profileChangeNote(a, 'a profile update'));
  await log(req, a, 'Update sent', `sent a profile update for review (${Object.keys(changed).join(', ')})`);
  res.status(201).json(await myProfile(a.profileId));
}));

router.post('/me/photos', upload.array('photos', 6), wrap(async (req, res) => {
  const a = req.companion;
  if (!req.files?.length) throw new HttpError(422, 'Choose one or more photos (JPG, PNG or WEBP, up to 4 MB each).');
  const { n } = await one("SELECT COUNT(*)::int AS n FROM profile_change_requests WHERE profile_id = $1 AND kind = 'photo' AND status = 'Pending'", [a.profileId]);
  if (n + req.files.length > 12) throw new HttpError(422, `Up to 12 photos can wait for review at a time (${n} already waiting).`);
  for (const f of req.files) {
    const saved = await saveImage(f.buffer, `profiles/${a.profileId}/pending`);
    await run("INSERT INTO profile_change_requests (profile_id, kind, photo_url, file_name) VALUES ($1, 'photo', $2, $3)", [a.profileId, saved.url, saved.fileName]);
  }
  await notifyStaff(profileChangeNote(a, req.files.length === 1 ? 'a new photo' : `${req.files.length} new photos`));
  await log(req, a, 'Photos sent', `sent ${req.files.length} photo${req.files.length === 1 ? '' : 's'} for review`);
  res.status(201).json(await myProfile(a.profileId));
}));

router.delete('/me/changes/:id', wrap(async (req, res) => {
  const r = await one("UPDATE profile_change_requests SET status = 'Withdrawn', decided_at = now() WHERE id = $1 AND profile_id = $2 AND status = 'Pending' RETURNING photo_url, file_name",
    [Number(req.params.id) || 0, req.companion.profileId]);
  if (!r) throw new HttpError(404, 'No pending update with that id.');
  if (r.fileName) await removeImages([{ url: r.photoUrl, fileName: r.fileName }]);
  res.json(await myProfile(req.companion.profileId));
}));

export default router;
