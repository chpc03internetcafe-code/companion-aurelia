// CMS: companion portal access per profile (invite, suspend, reset two-step, remove) and the review queue for
// profile updates companions send from the portal (new wording or photos go live only once approved here).
import { Router } from 'express';
import { devLinksAllowed } from '../lib/security.js';
import { one, q, run, tx } from '../db/index.js';
import { HttpError, idParam, wrap } from '../lib/http.js';
import { validate } from '../lib/validate.js';
import { clearTwoStep, REALMS, revokeMemberSessions } from '../lib/auth.js';
import { logEvent } from '../lib/audit.js';
import { notify } from '../lib/mailer.js';
import { companionChangeDecided, companionInvite, passwordReset, siteUrl, twoStepChanged } from '../lib/emails.js';
import { removeImages } from '../lib/storage.js';
import { loadSettings } from '../services/settings.js';
import { DETAIL_FIELDS } from '../services/companions.js';
import { createCompanionToken } from './companion.js';

const router = Router();
const realm = REALMS.companion;
// email links are shown on screen only on a developer's machine (see lib/security.js)
const devMode = devLinksAllowed;

const ACCOUNT = `SELECT ca.id, ca.profile_id, ca.email, ca.status, ca.invited_by, ca.invited_at, ca.activated_at, ca.last_login_at, ca.totp_enabled_at AS two_step_since,
    p.display_name, (SELECT COUNT(*)::int FROM companion_sessions s WHERE s.account_id = ca.id AND s.expires_at > now()) AS devices
  FROM companion_accounts ca JOIN profiles p ON p.id = ca.profile_id`;

async function account(id) {
  const a = await one(`${ACCOUNT} WHERE ca.id = $1`, [id]);
  if (!a) throw new HttpError(404, 'Portal account not found.');
  return a;
}

function audit(req, a, action, summary) {
  req.auditHandled = true;
  return logEvent({ action, module: 'profiles', entityType: 'Profile', entityId: a.profileId, entityLabel: a.displayName, summary }, req);
}

// ---------- Profile updates waiting for review ----------
const CURRENT = `SELECT ${DETAIL_FIELDS.map(([, col]) => col).join(', ')} FROM profiles WHERE id = $1`;

router.get('/changes', wrap(async (req, res) => {
  const status = ['Pending', 'Approved', 'Rejected', 'Withdrawn'].includes(req.query.status) ? req.query.status : 'Pending';
  const rows = await q(`SELECT r.*, p.display_name, p.slug, p.status AS profile_status FROM profile_change_requests r JOIN profiles p ON p.id = r.profile_id
    WHERE r.status = $1 ${req.query.profileId ? 'AND r.profile_id = $2' : ''} ORDER BY ${status === 'Pending' ? 'r.created_at' : 'r.decided_at DESC'} LIMIT 200`,
  req.query.profileId ? [status, Number(req.query.profileId)] : [status]);
  // current values next to the proposed ones, so staff can compare
  const current = {};
  for (const id of [...new Set(rows.filter((r) => r.kind === 'details').map((r) => r.profileId))]) current[id] = await one(CURRENT, [id]);
  res.json({
    fields: DETAIL_FIELDS.map(([key, , label]) => ({ key, label })),
    items: rows.map((r) => ({ ...r, data: r.data ? JSON.parse(r.data) : null, current: current[r.profileId] || null })),
  });
}));

router.get('/changes/stats', wrap(async (_req, res) => res.json(await one("SELECT COUNT(*)::int AS pending FROM profile_change_requests WHERE status = 'Pending'"))));

async function pendingChange(req) {
  const r = await one(`SELECT r.*, p.display_name FROM profile_change_requests r JOIN profiles p ON p.id = r.profile_id WHERE r.id = $1`, [idParam(req)]);
  if (!r) throw new HttpError(404, 'Update not found.');
  if (r.status !== 'Pending') throw new HttpError(409, `This update is already ${r.status.toLowerCase()}.`);
  return r;
}

async function tellCompanion(r, approved, note) {
  const a = await one("SELECT email FROM companion_accounts WHERE profile_id = $1 AND status = 'Active'", [r.profileId]);
  if (a) await notify(companionChangeDecided(await loadSettings(), { name: r.displayName, email: a.email }, { kind: r.kind, approved, note }));
}

// body: { note? }  Details are copied onto the profile; a photo is added to the profile's photos (main photo if it has none).
router.post('/changes/:id/approve', wrap(async (req, res) => {
  const r = await pendingChange(req);
  const { note } = validate(req.body, { note: { type: 'string', max: 500 } });
  await tx(async (db) => {
    if (r.kind === 'details') {
      const data = JSON.parse(r.data || '{}');
      const cols = DETAIL_FIELDS.filter(([k]) => k in data);
      if (cols.length) {
        await db.run(`UPDATE profiles SET ${cols.map(([, col], i) => `${col} = $${i + 1}`).join(', ')}, updated_at = now(), last_active_at = now() WHERE id = $${cols.length + 1}`,
          [...cols.map(([k]) => data[k]), r.profileId]);
      }
    } else {
      const m = await db.one(`SELECT COUNT(*)::int AS n, COUNT(*) FILTER (WHERE is_primary AND kind = 'photo' AND NOT vip_only)::int AS primaries
        FROM profile_media WHERE profile_id = $1`, [r.profileId]);
      if (m.n >= 40) throw new HttpError(422, 'This profile already has 40 photos and videos. Remove some first.');
      await db.run('INSERT INTO profile_media (profile_id, kind, url, file_name, alt_text, is_primary, sort_order) VALUES ($1, $2, $3, $4, $5, $6, $7)',
        [r.profileId, 'photo', r.photoUrl, r.fileName, `${r.displayName} — photo ${m.n + 1}`, m.primaries === 0, m.n]);
      await db.run('UPDATE profiles SET updated_at = now(), last_active_at = now() WHERE id = $1', [r.profileId]);
    }
    await db.run("UPDATE profile_change_requests SET status = 'Approved', staff_note = $1, decided_by = $2, decided_at = now() WHERE id = $3", [note, req.admin.name, r.id]);
  });
  await tellCompanion(r, true, note);
  await audit(req, { profileId: r.profileId, displayName: r.displayName }, 'Update approved',
    `Approved ${r.displayName}’s ${r.kind === 'photo' ? 'new photo' : `profile update (${Object.keys(JSON.parse(r.data || '{}')).join(', ')})`}`);
  res.json({ ok: true });
}));

router.post('/changes/:id/reject', wrap(async (req, res) => {
  const r = await pendingChange(req);
  const { note } = validate(req.body, { note: { type: 'string', required: true, max: 500, label: 'Reason' } });
  await run("UPDATE profile_change_requests SET status = 'Rejected', staff_note = $1, decided_by = $2, decided_at = now() WHERE id = $3", [note, req.admin.name, r.id]);
  if (r.fileName) await removeImages([{ url: r.photoUrl, fileName: r.fileName }]);
  await tellCompanion(r, false, note);
  await audit(req, { profileId: r.profileId, displayName: r.displayName }, 'Update rejected', `Rejected ${r.displayName}’s ${r.kind === 'photo' ? 'new photo' : 'profile update'}: ${note}`);
  res.json({ ok: true });
}));

// ---------- Portal access for one profile ----------
router.get('/profile/:profileId', wrap(async (req, res) => {
  res.json({ account: await one(`${ACCOUNT} WHERE ca.profile_id = $1`, [idParam(req, 'profileId')]) });
}));

// body: { email }  Creates the account (or updates a not-yet-accepted one) and emails a link to choose a password.
router.post('/profile/:profileId/invite', wrap(async (req, res) => {
  const profileId = idParam(req, 'profileId');
  const { email } = validate(req.body, { email: { type: 'email', required: true, label: 'Email' } });
  const p = await one('SELECT id, display_name, status FROM profiles WHERE id = $1', [profileId]);
  if (!p) throw new HttpError(404, 'Profile not found.');
  if (p.status === 'Retired') throw new HttpError(409, 'Restore the profile before giving portal access.');
  const existing = await one('SELECT id, status FROM companion_accounts WHERE profile_id = $1', [profileId]);
  if (existing && existing.status !== 'Invited') throw new HttpError(409, 'This profile already has portal access. Use “Send password link” instead.');
  const taken = await one('SELECT 1 AS x FROM companion_accounts WHERE lower(email) = lower($1) AND profile_id <> $2', [email, profileId]);
  if (taken) throw new HttpError(409, 'That email is already used by another profile’s portal account.', { email: 'Already used for another profile.' });
  const id = existing
    ? (await one('UPDATE companion_accounts SET email = $1, invited_by = $2, invited_at = now(), updated_at = now() WHERE id = $3 RETURNING id', [email, req.admin.name, existing.id])).id
    : (await one("INSERT INTO companion_accounts (profile_id, email, status, invited_by, invited_at) VALUES ($1, $2, 'Invited', $3, now()) RETURNING id", [profileId, email, req.admin.name])).id;
  const url = `${siteUrl() || 'http://localhost:5173'}/companion/invite?token=${await createCompanionToken('invite', id)}`;
  const sent = await notify(companionInvite(await loadSettings(), { name: p.displayName, email, url }));
  const a = await account(id);
  await audit(req, a, existing ? 'Invite resent' : 'Portal invited', `${existing ? 'Resent the' : 'Sent a'} companion portal invitation for ${p.displayName} to ${email}`);
  res.status(existing ? 200 : 201).json({ account: a, sent, link: !sent && devMode() ? url : undefined });
}));

// Emails an active account a link to choose a new password.
router.post('/:id/password-link', wrap(async (req, res) => {
  const a = await account(idParam(req));
  if (a.status !== 'Active') throw new HttpError(409, a.status === 'Invited' ? 'They haven’t accepted the invitation yet — resend it instead.' : 'Reactivate the account first.');
  const url = `${siteUrl() || 'http://localhost:5173'}/companion/reset-password?token=${await createCompanionToken('reset', a.id)}`;
  const sent = await notify(passwordReset(await loadSettings(), { name: a.displayName, email: a.email, url }));
  await audit(req, a, 'Password link sent', `Sent ${a.displayName} a companion portal password link`);
  res.json({ sent, link: !sent && devMode() ? url : undefined });
}));

router.post('/:id/status', wrap(async (req, res) => {
  const a = await account(idParam(req));
  const { status } = validate(req.body, { status: { type: 'enum', values: ['Active', 'Suspended'], required: true } });
  if (a.status === 'Invited') throw new HttpError(409, 'They haven’t accepted the invitation yet.');
  await run('UPDATE companion_accounts SET status = $1, updated_at = now() WHERE id = $2', [status, a.id]);
  if (status === 'Suspended') await revokeMemberSessions(a.id, null, realm);
  await audit(req, a, status === 'Suspended' ? 'Portal suspended' : 'Portal reactivated', `${status === 'Suspended' ? 'Paused' : 'Reactivated'} ${a.displayName}’s companion portal access`);
  res.json({ account: await account(a.id) });
}));

router.post('/:id/two-step/reset', wrap(async (req, res) => {
  const a = await account(idParam(req));
  if (!a.twoStepSince) throw new HttpError(409, 'Two-step sign-in is already off for this account.');
  await clearTwoStep(a.id, realm);
  await revokeMemberSessions(a.id, null, realm);
  await notify(twoStepChanged(await loadSettings(), { name: a.displayName, email: a.email, enabled: false, byStaff: true }));
  await audit(req, a, 'Two-step sign-in reset', `Turned off two-step sign-in for ${a.displayName}’s companion portal and signed out their devices`);
  res.json({ account: await account(a.id) });
}));

router.post('/:id/sessions', wrap(async (req, res) => {
  const a = await account(idParam(req));
  await revokeMemberSessions(a.id, null, realm);
  await audit(req, a, 'Sessions revoked', `Signed ${a.displayName} out of the companion portal on every device`);
  res.json({ account: await account(a.id) });
}));

router.delete('/:id', wrap(async (req, res) => {
  const a = await account(idParam(req));
  await run('DELETE FROM companion_accounts WHERE id = $1', [a.id]);
  await audit(req, a, 'Portal removed', `Removed ${a.displayName}’s companion portal access (${a.email})`);
  res.status(204).end();
}));

export default router;
