// Security routes shared by the member portal (/api/account) and the companion portal (/api/companion):
// the second sign-in step, password change, signed-in devices and two-step sign-in with an authenticator app.
//
// opts.account(req)  → { id, fullName, email } of the signed-in account (set by the router's require middleware)
// opts.log(req, account, action, summary) → audit entry
import QRCode from 'qrcode';
import { one, run } from '../db/index.js';
import {
  clearTwoStep, findMfaChallenge, hashBackupCodes, hashPassword, listSessions, MAX_MFA_ATTEMPTS, passwordProblem, revokeMemberSessions, throttle,
  consumeSecondFactor, verifyPassword,
} from './auth.js';
import { HttpError, idParam, wrap } from './http.js';
import { notify } from './mailer.js';
import { passwordChanged, twoStepChanged } from './emails.js';
import { newBackupCodes, newSecret, otpauthUrl, verifyTotp } from './totp.js';
import { loadSettings } from '../services/settings.js';

/**
 * Checks the code for a password that was already accepted. Returns { accountId, remember, used: 'app' | 'backup' }
 * and removes the challenge; throws 422 for a wrong code and 410 once the challenge is gone.
 */
export async function passSecondStep(req, realm) {
  const c = await findMfaChallenge(req.body.token, realm);
  if (!c) throw new HttpError(410, 'This sign-in has timed out. Please enter your password again.', { code: 'mfa_expired' });
  const limiter = throttle(`mfa:${realm.accounts}:${c.accountId}`, { max: 10 });
  const used = await consumeSecondFactor(c.accountId, req.body.code, realm);
  if (!used) {
    limiter.fail();
    await run(`UPDATE ${realm.challenges} SET attempts = attempts + 1 WHERE id = $1`, [c.id]);
    if (c.attempts + 1 >= MAX_MFA_ATTEMPTS) {
      await run(`DELETE FROM ${realm.challenges} WHERE id = $1`, [c.id]);
      throw new HttpError(410, 'Too many incorrect codes. Please enter your password again.', { code: 'mfa_expired' });
    }
    throw new HttpError(422, 'That code isn’t right. Check the time on your phone, or use a backup code.', { code: 'That code isn’t right.' });
  }
  await run(`DELETE FROM ${realm.challenges} WHERE id = $1`, [c.id]);
  limiter.clear();
  return { accountId: c.accountId, remember: c.remember, used };
}

export const backupCodesLeft = async (accountId, realm) =>
  JSON.parse((await one(`SELECT totp_backup_codes FROM ${realm.accounts} WHERE id = $1`, [accountId]))?.totpBackupCodes || '[]').length;

/** Adds /me/password, /me/sessions… and /me/2fa… to a router whose /me routes already require a signed-in account. */
export function securityRoutes(router, realm, { account, log }) {
  const T = realm.accounts;

  const twoStepStatus = async (id) => {
    const m = await one(`SELECT totp_enabled_at, totp_backup_codes FROM ${T} WHERE id = $1`, [id]);
    return { enabled: !!m.totpEnabledAt, enabledAt: m.totpEnabledAt, backupCodesLeft: m.totpEnabledAt ? JSON.parse(m.totpBackupCodes || '[]').length : 0 };
  };

  async function checkPassword(req, field = 'password') {
    const a = account(req);
    const limiter = throttle(`pw:${T}:${a.id}`, { max: 8 });
    const { passwordHash } = await one(`SELECT password_hash FROM ${T} WHERE id = $1`, [a.id]);
    if (!(await verifyPassword(String(req.body[field] || ''), passwordHash))) {
      limiter.fail();
      const msg = field === 'password' ? 'Password is incorrect.' : 'Current password is incorrect.';
      throw new HttpError(422, msg, { [field]: msg });
    }
    limiter.clear();
  }

  // ---------- Password ----------
  router.post('/me/password', wrap(async (req, res) => {
    const a = account(req);
    await checkPassword(req, 'currentPassword');
    const pwErr = passwordProblem(req.body.newPassword);
    if (pwErr) throw new HttpError(422, pwErr, { newPassword: pwErr });
    await run(`UPDATE ${T} SET password_hash = $1, updated_at = now() WHERE id = $2`, [await hashPassword(req.body.newPassword), a.id]);
    await revokeMemberSessions(a.id, req, realm);
    await notify(passwordChanged(await loadSettings(), { name: a.fullName, email: a.email }));
    await log(req, a, 'Password changed', 'changed their password; other devices signed out');
    res.json({ ok: true });
  }));

  // ---------- Devices signed in to this account ----------
  router.get('/me/sessions', wrap(async (req, res) => res.json(await listSessions(req, account(req).id, realm))));

  router.delete('/me/sessions/:id', wrap(async (req, res) => {
    const a = account(req);
    const mine = (await listSessions(req, a.id, realm)).find((s) => s.id === idParam(req));
    if (!mine) throw new HttpError(404, 'Session not found.');
    if (mine.current) throw new HttpError(409, 'Use “Sign out” to end the session on this device.');
    await run(`DELETE FROM ${realm.sessions} WHERE id = $1 AND ${realm.fk} = $2`, [mine.id, a.id]);
    res.json(await listSessions(req, a.id, realm));
  }));

  router.post('/me/sessions/revoke-others', wrap(async (req, res) => {
    const a = account(req);
    await revokeMemberSessions(a.id, req, realm);
    await log(req, a, 'Sessions revoked', 'signed out all other devices');
    res.json(await listSessions(req, a.id, realm));
  }));

  // ---------- Two-step sign-in (authenticator app) ----------
  router.get('/me/2fa', wrap(async (req, res) => res.json(await twoStepStatus(account(req).id))));

  // Step 1: a new secret, shown as a QR code and as a setup key. Nothing changes until a code from it is confirmed.
  router.post('/me/2fa/setup', wrap(async (req, res) => {
    const a = account(req);
    await checkPassword(req);
    if ((await twoStepStatus(a.id)).enabled) throw new HttpError(409, 'Two-step sign-in is already on.');
    const secret = newSecret();
    await run(`UPDATE ${T} SET totp_pending_secret = $1 WHERE id = $2`, [secret, a.id]);
    const url = otpauthUrl({ secret, issuer: (await loadSettings()).siteName || 'Aurelia', account: a.email });
    res.set('Cache-Control', 'no-store');
    res.json({ secret, otpauthUrl: url, qr: await QRCode.toDataURL(url, { margin: 1, width: 220, errorCorrectionLevel: 'M' }) });
  }));

  // Step 2: the first code from the app turns it on and returns the backup codes (shown only this once).
  router.post('/me/2fa/enable', wrap(async (req, res) => {
    const a = account(req);
    const limiter = throttle(`mfa-setup:${T}:${a.id}`, { max: 10 });
    const m = await one(`SELECT totp_pending_secret, totp_enabled_at FROM ${T} WHERE id = $1`, [a.id]);
    if (m.totpEnabledAt) throw new HttpError(409, 'Two-step sign-in is already on.');
    if (!m.totpPendingSecret) throw new HttpError(409, 'Start the setup again.');
    const step = verifyTotp(m.totpPendingSecret, req.body.code);
    if (step == null) {
      limiter.fail();
      throw new HttpError(422, 'That code isn’t right. Make sure the time on your phone is set automatically.', { code: 'That code isn’t right.' });
    }
    limiter.clear();
    const codes = newBackupCodes();
    await run(`UPDATE ${T} SET totp_secret = totp_pending_secret, totp_pending_secret = NULL, totp_enabled_at = now(), totp_last_step = $1::bigint,
        totp_backup_codes = $2, updated_at = now() WHERE id = $3`, [step, hashBackupCodes(codes), a.id]);
    if (req.body.signOutOthers) await revokeMemberSessions(a.id, req, realm);
    await notify(twoStepChanged(await loadSettings(), { name: a.fullName, email: a.email, enabled: true }));
    await log(req, a, 'Two-step sign-in on', `turned on two-step sign-in with an authenticator app${req.body.signOutOthers ? '; other devices signed out' : ''}`);
    res.json({ ...(await twoStepStatus(a.id)), backupCodes: codes });
  }));

  router.post('/me/2fa/backup-codes', wrap(async (req, res) => {
    const a = account(req);
    await checkPassword(req);
    if (!(await twoStepStatus(a.id)).enabled) throw new HttpError(409, 'Two-step sign-in is off.');
    const codes = newBackupCodes();
    await run(`UPDATE ${T} SET totp_backup_codes = $1 WHERE id = $2`, [hashBackupCodes(codes), a.id]);
    await log(req, a, 'Backup codes replaced', 'created new two-step backup codes (the old ones no longer work)');
    res.json({ ...(await twoStepStatus(a.id)), backupCodes: codes });
  }));

  // Turning it off needs the password and a current code (or a backup code).
  router.post('/me/2fa/disable', wrap(async (req, res) => {
    const a = account(req);
    await checkPassword(req);
    const limiter = throttle(`mfa:${T}:${a.id}`, { max: 10 });
    if (!(await consumeSecondFactor(a.id, req.body.code, realm))) {
      limiter.fail();
      throw new HttpError(422, 'That code isn’t right.', { code: 'That code isn’t right.' });
    }
    limiter.clear();
    await clearTwoStep(a.id, realm);
    await notify(twoStepChanged(await loadSettings(), { name: a.fullName, email: a.email, enabled: false }));
    await log(req, a, 'Two-step sign-in off', 'turned off two-step sign-in');
    res.json(await twoStepStatus(a.id));
  }));
}
