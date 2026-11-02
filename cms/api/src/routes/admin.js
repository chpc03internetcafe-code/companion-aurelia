// CMS staff: sign-in (/api/admin/auth/*), user management (/api/admin/users) and roles (/api/admin/roles).
import { Router } from 'express';
import { one, q, run } from '../db/index.js';
import { validate } from '../lib/validate.js';
import QRCode from 'qrcode';
import { checkPassword, hashPassword, loginLimiter, passwordProblem, throttle, upgradeHash, verifyPassword } from '../lib/auth.js';
import {
  adminFromToken, checkSetupKey, clearTwoStep, consumeSecondFactor, createMfaChallenge, currentAdmin, effectivePermissions, endAdminSession,
  findMfaChallenge, hashBackupCodes, LEVELS, MAX_MFA_ATTEMPTS, MODULES, normalizePermissions, requirePermission, revokeSessions, setupKeyRequired,
  startAdminSession, twoStepStatus, withinPermissions,
} from '../lib/admin-auth.js';
import { newBackupCodes, newSecret, otpauthUrl, verifyTotp } from '../lib/totp.js';
import { clientIp, HttpError, idParam, wrap } from '../lib/http.js';
import { loadSettings } from '../services/settings.js';
import { logEvent } from '../lib/audit.js';
import { notify } from '../lib/mailer.js';
import { twoStepChanged } from '../lib/emails.js';

const router = Router();
const userCount = async () => (await one('SELECT COUNT(*)::int AS n FROM admin_users')).n;
const modulesList = () => MODULES.map(([key, label]) => ({ key, label }));
const asActor = (u) => ({ userId: u.id, userName: u.name, userEmail: u.email });

// ---------- Sign-in ----------
// Public: whether first-run setup is needed, plus the site name for the sign-in screen.
router.get('/auth/setup', wrap(async (_req, res) => {
  const s = await loadSettings();
  res.json({ needed: (await userCount()) === 0, keyRequired: setupKeyRequired(), site: { siteName: s.siteName, logoText: s.logoText } });
}));

const userSchema = {
  fullName: { type: 'string', required: true, max: 150, label: 'Full name' },
  email: { type: 'email', required: true, label: 'Email' },
  roleId: { type: 'int', required: true, min: 1, message: 'Choose a role.' },
  status: { type: 'enum', values: ['Active', 'Disabled'], default: 'Active' },
};

// Creates the first administrator. Only works while there are no staff accounts at all.
router.post('/auth/setup', wrap(async (req, res) => {
  await (await throttle(`admin-setup:${clientIp(req)}`, { max: 10 })).fail();
  checkSetupKey(req.body.setupKey);
  const pwErr = passwordProblem(req.body.password, req.body.email);
  const data = validate(req.body, { fullName: userSchema.fullName, email: userSchema.email, ...(pwErr ? { password: { type: 'string', check: () => pwErr } } : {}) });
  const created = await one(
    `INSERT INTO admin_users (full_name, email, password_hash, role_id)
     SELECT $1, $2, $3, (SELECT id FROM admin_roles WHERE is_system ORDER BY id LIMIT 1)
     WHERE NOT EXISTS (SELECT 1 FROM admin_users) RETURNING id`,
    [data.fullName, data.email, await hashPassword(req.body.password)]
  );
  if (!created) throw new HttpError(409, 'The CMS has already been set up. Please sign in.');
  const user = await adminFromToken(await startAdminSession(req, res, created.id, false));
  await logEvent({ action: 'Setup completed', module: 'auth', entityType: 'Staff user', entityId: user.id, entityLabel: user.email, summary: `Created the first administrator account (${user.email})`, ...asActor(user) }, req);
  res.status(201).json({ user });
}));

router.post('/auth/login', wrap(async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const limiter = await loginLimiter('admin-login', req, email, 6);
  const u = await one('SELECT id, password_hash, status, totp_enabled_at FROM admin_users WHERE email = $1', [email]);
  const ok = await checkPassword(req.body.password, u?.passwordHash);
  if (!ok) {
    await limiter.fail();
    await logEvent({ action: 'Sign-in failed', module: 'auth', entityType: 'Staff user', entityId: u?.id ?? null, entityLabel: email || null,
      summary: `Failed sign-in attempt for ${email || '(no email)'}${u ? '' : ' (no such account)'}`, actorType: 'System', userEmail: email || null }, req);
    throw new HttpError(401, 'Incorrect email or password.', { password: 'Incorrect email or password.' });
  }
  if (u.status !== 'Active') {
    await logEvent({ action: 'Sign-in blocked', module: 'auth', entityType: 'Staff user', entityId: u.id, entityLabel: email, summary: `Disabled account ${email} tried to sign in`, actorType: 'System', userEmail: email }, req);
    throw new HttpError(403, 'This account has been disabled. Please contact an administrator.');
  }
  await limiter.clear();
  await upgradeHash('admin_users', u.id, req.body.password, u.passwordHash);
  // two-step sign-in on: no session yet, only a challenge for the authenticator code
  if (u.totpEnabledAt) return res.json({ mfaRequired: true, mfaToken: await createMfaChallenge(u.id, !!req.body.remember) });
  const user = await adminFromToken(await startAdminSession(req, res, u.id, !!req.body.remember));
  await logEvent({ action: 'Signed in', module: 'auth', entityType: 'Staff user', entityId: user.id, entityLabel: user.email,
    summary: `${user.name} signed in${req.body.remember ? ' (kept signed in for 30 days)' : ''}`, ...asActor(user) }, req);
  res.json({ user });
}));

// Second step: the code from the authenticator app (or a backup code) for a password that was already accepted.
router.post('/auth/login/2fa', wrap(async (req, res) => {
  const c = await findMfaChallenge(req.body.token);
  if (!c) throw new HttpError(410, 'This sign-in has timed out. Please enter your password again.', { code: 'mfa_expired' });
  const limiter = await throttle(`admin-mfa:${c.userId}`, { max: 10 });
  const used = await consumeSecondFactor(c.userId, req.body.code);
  if (!used) {
    await limiter.fail();
    await run('UPDATE admin_mfa_challenges SET attempts = attempts + 1 WHERE id = $1', [c.id]);
    const { email } = await one('SELECT email FROM admin_users WHERE id = $1', [c.userId]);
    await logEvent({ action: 'Sign-in failed', module: 'auth', entityType: 'Staff user', entityId: c.userId, entityLabel: email,
      summary: `Wrong two-step code for ${email} (the password was correct)`, actorType: 'System', userEmail: email }, req);
    if (c.attempts + 1 >= MAX_MFA_ATTEMPTS) {
      await run('DELETE FROM admin_mfa_challenges WHERE id = $1', [c.id]);
      throw new HttpError(410, 'Too many incorrect codes. Please enter your password again.', { code: 'mfa_expired' });
    }
    throw new HttpError(422, 'That code isn’t right. Check the time on your phone, or use a backup code.', { code: 'That code isn’t right.' });
  }
  await run('DELETE FROM admin_mfa_challenges WHERE id = $1', [c.id]);
  await limiter.clear();
  const user = await adminFromToken(await startAdminSession(req, res, c.userId, c.remember));
  if (!user) throw new HttpError(403, 'This account has been disabled. Please contact an administrator.');
  const left = used === 'backup' ? (await twoStepStatus(user.id)).backupCodesLeft : null;
  await logEvent({ action: 'Signed in', module: 'auth', entityType: 'Staff user', entityId: user.id, entityLabel: user.email,
    summary: `${user.name} signed in with ${used === 'backup' ? `a backup code (${left} left)` : 'an authenticator code'}${c.remember ? ' (kept signed in for 30 days)' : ''}`, ...asActor(user) }, req);
  res.json({ user, backupCodesLeft: left });
}));

router.post('/auth/logout', wrap(async (req, res) => {
  const me = await currentAdmin(req);
  if (me) await logEvent({ action: 'Signed out', module: 'auth', entityType: 'Staff user', entityId: me.id, entityLabel: me.email, summary: `${me.name} signed out`, ...asActor(me) }, req);
  await endAdminSession(req, res);
  res.status(204).end();
}));

// The signed-in staff member, or { user: null } (so the admin app can check without a 401).
router.get('/auth/me', wrap(async (req, res) => {
  res.json({ user: await currentAdmin(req), modules: modulesList() });
}));

// Own password; also clears the "must change password" flag and signs out other devices.
router.post('/auth/password', wrap(async (req, res) => {
  const me = await currentAdmin(req);
  if (!me) throw new HttpError(401, 'Please sign in to the CMS.');
  const { passwordHash } = await one('SELECT password_hash FROM admin_users WHERE id = $1', [me.id]);
  if (!(await verifyPassword(String(req.body.currentPassword || ''), passwordHash))) {
    throw new HttpError(422, 'Current password is incorrect.', { currentPassword: 'Current password is incorrect.' });
  }
  const pwErr = passwordProblem(req.body.newPassword, me.email);
  if (pwErr) throw new HttpError(422, pwErr, { newPassword: pwErr });
  if (req.body.newPassword === req.body.currentPassword) throw new HttpError(422, 'Choose a different password.', { newPassword: 'Use a different password.' });
  await run('UPDATE admin_users SET password_hash = $1, must_change_password = FALSE, updated_at = now() WHERE id = $2', [await hashPassword(req.body.newPassword), me.id]);
  await revokeSessions(me.id, req);
  await logEvent({ action: 'Password changed', module: 'auth', entityType: 'Staff user', entityId: me.id, entityLabel: me.email,
    summary: `${me.name} changed their password${me.mustChangePassword ? ' (replacing a temporary password)' : ''}; other devices signed out`, ...asActor(me) }, req);
  res.json({ user: await currentAdmin(req) });
}));

// ---------- Own two-step sign-in (authenticator app) ----------
// Open while setup is required (that's how someone completes it), but not before a temporary password is replaced.
async function signedInStaff(req) {
  const me = await currentAdmin(req);
  if (!me) throw new HttpError(401, 'Please sign in to the CMS.');
  if (me.mustChangePassword) throw new HttpError(403, 'Please set a new password before continuing.', { code: 'password_change_required' });
  return me;
}

async function confirmPassword(me, given) {
  const limiter = await throttle(`admin-pw:${me.id}`, { max: 8 });
  const { passwordHash } = await one('SELECT password_hash FROM admin_users WHERE id = $1', [me.id]);
  if (!(await verifyPassword(String(given || ''), passwordHash))) {
    await limiter.fail();
    throw new HttpError(422, 'Password is incorrect.', { password: 'Password is incorrect.' });
  }
  await limiter.clear();
}

const twoStepLog = (me, action, summary, req) =>
  logEvent({ action, module: 'auth', entityType: 'Staff user', entityId: me.id, entityLabel: me.email, summary: `${me.name} ${summary}`, ...asActor(me) }, req);

router.get('/auth/2fa', wrap(async (req, res) => res.json(await twoStepStatus((await signedInStaff(req)).id))));

// Step 1: a new secret, shown as a QR code and as a setup key. Nothing changes until a code from it is confirmed.
router.post('/auth/2fa/setup', wrap(async (req, res) => {
  const me = await signedInStaff(req);
  await confirmPassword(me, req.body.password);
  if (me.twoStepEnabled) throw new HttpError(409, 'Two-step sign-in is already on.');
  const secret = newSecret();
  await run('UPDATE admin_users SET totp_pending_secret = $1 WHERE id = $2', [secret, me.id]);
  const url = otpauthUrl({ secret, issuer: `${(await loadSettings()).siteName || 'Aurelia'} CMS`, account: me.email });
  res.set('Cache-Control', 'no-store');
  res.json({ secret, otpauthUrl: url, qr: await QRCode.toDataURL(url, { margin: 1, width: 220, errorCorrectionLevel: 'M' }) });
}));

// Step 2: the first code from the app turns it on and returns the backup codes (shown only this once).
router.post('/auth/2fa/enable', wrap(async (req, res) => {
  const me = await signedInStaff(req);
  const limiter = await throttle(`admin-mfa-setup:${me.id}`, { max: 10 });
  const u = await one('SELECT totp_pending_secret, totp_enabled_at FROM admin_users WHERE id = $1', [me.id]);
  if (u.totpEnabledAt) throw new HttpError(409, 'Two-step sign-in is already on.');
  if (!u.totpPendingSecret) throw new HttpError(409, 'Start the setup again.');
  const step = verifyTotp(u.totpPendingSecret, req.body.code);
  if (step == null) {
    await limiter.fail();
    throw new HttpError(422, 'That code isn’t right. Make sure the time on your phone is set automatically.', { code: 'That code isn’t right.' });
  }
  await limiter.clear();
  const codes = newBackupCodes();
  await run(`UPDATE admin_users SET totp_secret = totp_pending_secret, totp_pending_secret = NULL, totp_enabled_at = now(), totp_last_step = $1::bigint,
      totp_backup_codes = $2, updated_at = now() WHERE id = $3`, [step, hashBackupCodes(codes), me.id]);
  if (req.body.signOutOthers) await revokeSessions(me.id, req);
  await notify(twoStepChanged(await loadSettings(), { name: me.name, email: me.email, enabled: true }));
  await twoStepLog(me, 'Two-step sign-in on', `turned on two-step sign-in with an authenticator app${req.body.signOutOthers ? '; other devices signed out' : ''}`, req);
  res.json({ ...(await twoStepStatus(me.id)), backupCodes: codes, user: await currentAdmin(req) });
}));

router.post('/auth/2fa/backup-codes', wrap(async (req, res) => {
  const me = await signedInStaff(req);
  await confirmPassword(me, req.body.password);
  if (!me.twoStepEnabled) throw new HttpError(409, 'Two-step sign-in is off.');
  const codes = newBackupCodes();
  await run('UPDATE admin_users SET totp_backup_codes = $1 WHERE id = $2', [hashBackupCodes(codes), me.id]);
  await twoStepLog(me, 'Backup codes replaced', 'created new two-step backup codes (the old ones no longer work)', req);
  res.json({ ...(await twoStepStatus(me.id)), backupCodes: codes });
}));

// Turning it off needs the password and a current code (or a backup code), and isn't allowed while Settings require it.
router.post('/auth/2fa/disable', wrap(async (req, res) => {
  const me = await signedInStaff(req);
  if ((await twoStepStatus(me.id)).required) throw new HttpError(409, 'Two-step sign-in is required for all staff accounts (Site Settings → Security).');
  await confirmPassword(me, req.body.password);
  const limiter = await throttle(`admin-mfa:${me.id}`, { max: 10 });
  if (!(await consumeSecondFactor(me.id, req.body.code))) {
    await limiter.fail();
    throw new HttpError(422, 'That code isn’t right.', { code: 'That code isn’t right.' });
  }
  await limiter.clear();
  await clearTwoStep(me.id);
  await notify(twoStepChanged(await loadSettings(), { name: me.name, email: me.email, enabled: false }));
  await twoStepLog(me, 'Two-step sign-in off', 'turned off two-step sign-in', req);
  res.json({ ...(await twoStepStatus(me.id)), user: await currentAdmin(req) });
}));

// ---------- Users ----------
const USER_SELECT = `
  SELECT u.id, u.full_name, u.email, u.role_id, u.status, u.must_change_password, u.last_login_at, u.created_at, u.updated_at,
         u.totp_enabled_at AS two_step_since, r.name AS role_name, r.is_system AS is_administrator
  FROM admin_users u JOIN admin_roles r ON r.id = u.role_id`;

async function loadUser(id) {
  const u = await one(`${USER_SELECT} WHERE u.id = $1`, [id]);
  if (!u) throw new HttpError(404, 'User not found.');
  return u;
}
const loadRole = (id) => one('SELECT * FROM admin_roles WHERE id = $1', [id]);

// Only administrators can grant or touch administrator accounts, and nobody can hand out more access than they have.
async function assertCanAssign(me, roleId) {
  const role = await loadRole(roleId);
  if (!role) throw new HttpError(422, 'Choose a role.', { roleId: 'Choose a role.' });
  if (me.isAdministrator) return role;
  if (role.isSystem || !withinPermissions(effectivePermissions(role), me.permissions)) {
    throw new HttpError(403, `Only an administrator can give someone the “${role.name}” role.`, { roleId: 'This role has more access than yours.' });
  }
  return role;
}

// At least one active administrator must remain, so the CMS can't be locked out.
async function assertAdminRemains(excludingUserId) {
  const { n } = await one(
    `SELECT COUNT(*)::int AS n FROM admin_users u JOIN admin_roles r ON r.id = u.role_id
     WHERE r.is_system AND u.status = 'Active' AND u.id <> $1`,
    [excludingUserId]
  );
  if (!n) throw new HttpError(409, 'There must always be at least one active administrator.');
}

const users = Router();
users.use(requirePermission('users'));

users.get('/', wrap(async (_req, res) => res.json(await q(`${USER_SELECT} ORDER BY u.full_name`))));

users.post('/', wrap(async (req, res) => {
  const pwErr = passwordProblem(req.body.password, req.body.email);
  const data = validate(req.body, { ...userSchema, ...(pwErr ? { password: { type: 'string', check: () => pwErr } } : {}) });
  await assertCanAssign(req.admin, data.roleId);
  const row = await one(
    'INSERT INTO admin_users (full_name, email, password_hash, role_id, status, must_change_password) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id',
    [data.fullName, data.email, await hashPassword(req.body.password), data.roleId, data.status, req.body.mustChangePassword !== false]
  );
  res.status(201).json(await loadUser(row.id));
}));

users.put('/:id', wrap(async (req, res) => {
  const id = idParam(req);
  const data = validate(req.body, userSchema);
  const before = await loadUser(id);
  const self = id === req.admin.id;
  if (self && data.roleId !== before.roleId) throw new HttpError(409, 'You can’t change your own role. Ask another administrator.', { roleId: 'You can’t change your own role.' });
  if (self && data.status !== 'Active') throw new HttpError(409, 'You can’t disable your own account.', { status: 'You can’t disable yourself.' });
  if (before.isAdministrator && !req.admin.isAdministrator) throw new HttpError(403, 'Only an administrator can edit an administrator’s account.');
  if (data.roleId !== before.roleId) await assertCanAssign(req.admin, data.roleId);
  const newRole = await loadRole(data.roleId);
  if (before.isAdministrator && before.status === 'Active' && (!newRole.isSystem || data.status !== 'Active')) await assertAdminRemains(id);
  await run('UPDATE admin_users SET full_name = $1, email = $2, role_id = $3, status = $4, updated_at = now() WHERE id = $5',
    [data.fullName, data.email, data.roleId, data.status, id]);
  if (data.status === 'Disabled') await revokeSessions(id);
  res.json(await loadUser(id));
}));

// Sets a temporary password; the user must choose a new one at next sign-in.
users.post('/:id/password', wrap(async (req, res) => {
  const id = idParam(req);
  const pwErr = passwordProblem(req.body.password);
  if (pwErr) throw new HttpError(422, pwErr, { password: pwErr });
  const u = await loadUser(id);
  if (id === req.admin.id) throw new HttpError(409, 'Use “Change password” in your account menu to change your own password.');
  if (u.isAdministrator && !req.admin.isAdministrator) throw new HttpError(403, 'Only an administrator can reset an administrator’s password.');
  await run('UPDATE admin_users SET password_hash = $1, must_change_password = TRUE, updated_at = now() WHERE id = $2', [await hashPassword(req.body.password), id]);
  await revokeSessions(id);
  res.json(await loadUser(id));
}));

// For someone who lost their phone and their backup codes: turns two-step sign-in off and signs them out everywhere.
// Confirm who you're talking to first. If Settings require two-step, they must set it up again at next sign-in.
users.post('/:id/two-step/reset', wrap(async (req, res) => {
  const id = idParam(req);
  const u = await loadUser(id);
  if (id === req.admin.id) throw new HttpError(409, 'Use “Two-step sign-in” in your account menu to change your own.');
  if (u.isAdministrator && !req.admin.isAdministrator) throw new HttpError(403, 'Only an administrator can reset an administrator’s two-step sign-in.');
  if (!u.twoStepSince) throw new HttpError(409, `${u.fullName} doesn’t have two-step sign-in on.`);
  await clearTwoStep(id);
  await revokeSessions(id);
  await notify(twoStepChanged(await loadSettings(), { name: u.fullName, email: u.email, enabled: false, resetBy: req.admin.name }));
  req.auditHandled = true;
  await logEvent({ action: 'Two-step sign-in reset', module: 'users', entityType: 'Staff user', entityId: id, entityLabel: u.email,
    summary: `Reset two-step sign-in for ${u.fullName} (${u.email}); they were signed out everywhere`, ...asActor(req.admin) }, req);
  res.json(await loadUser(id));
}));

users.delete('/:id', wrap(async (req, res) => {
  const id = idParam(req);
  const u = await loadUser(id);
  if (id === req.admin.id) throw new HttpError(409, 'You can’t delete your own account.');
  if (u.isAdministrator && !req.admin.isAdministrator) throw new HttpError(403, 'Only an administrator can delete an administrator.');
  if (u.isAdministrator && u.status === 'Active') await assertAdminRemains(id);
  await run('DELETE FROM admin_users WHERE id = $1', [id]);
  res.status(204).end();
}));

router.use('/users', users);

// ---------- Roles ----------
const roleSchema = {
  name: { type: 'string', required: true, max: 60, label: 'Role name' },
  description: { type: 'string', max: 250 },
};

const listRoles = async () =>
  (await q('SELECT r.*, (SELECT COUNT(*)::int FROM admin_users u WHERE u.role_id = r.id) AS user_count FROM admin_roles r ORDER BY r.is_system DESC, r.name'))
    .map((r) => ({ ...r, permissions: effectivePermissions(r) }));

const roles = Router();
roles.use(requirePermission('users'));
// Changing what roles can do is reserved for administrators (otherwise a role editor could grant itself anything).
const administratorsOnly = (req, _res, next) => next(req.admin.isAdministrator ? undefined : new HttpError(403, 'Only an administrator can create or change roles.'));

roles.get('/', wrap(async (_req, res) => res.json({ roles: await listRoles(), modules: modulesList(), levels: LEVELS })));

roles.post('/', administratorsOnly, wrap(async (req, res) => {
  const data = validate(req.body, roleSchema);
  const row = await one('INSERT INTO admin_roles (name, description, permissions) VALUES ($1, $2, $3) RETURNING id', [data.name, data.description, JSON.stringify(normalizePermissions(req.body.permissions))]);
  res.status(201).json({ id: row.id, roles: await listRoles() });
}));

roles.put('/:id', administratorsOnly, wrap(async (req, res) => {
  const id = idParam(req);
  const data = validate(req.body, roleSchema);
  const role = await loadRole(id);
  if (!role) throw new HttpError(404, 'Role not found.');
  if (role.isSystem) {
    // the Administrator role keeps full access; only its description can change
    await run('UPDATE admin_roles SET description = $1, updated_at = now() WHERE id = $2', [data.description, id]);
  } else {
    await run('UPDATE admin_roles SET name = $1, description = $2, permissions = $3, updated_at = now() WHERE id = $4', [data.name, data.description, JSON.stringify(normalizePermissions(req.body.permissions)), id]);
  }
  res.json({ roles: await listRoles() });
}));

roles.delete('/:id', administratorsOnly, wrap(async (req, res) => {
  const id = idParam(req);
  const role = await loadRole(id);
  if (!role) throw new HttpError(404, 'Role not found.');
  if (role.isSystem) throw new HttpError(409, 'The Administrator role can’t be deleted.');
  const { n } = await one('SELECT COUNT(*)::int AS n FROM admin_users WHERE role_id = $1', [id]);
  if (n) throw new HttpError(409, `${n} user(s) still have the “${role.name}” role. Give them another role first.`);
  await run('DELETE FROM admin_roles WHERE id = $1', [id]);
  res.status(204).end();
}));

router.use('/roles', roles);

export default router;
