// Website sign-in for members (VIP portal) and companions (companion portal): scrypt password hashes + opaque
// session tokens in an httpOnly cookie. Only the SHA-256 of a session token or email-link token is stored.
// Session, device and two-step helpers take a realm (REALMS.member by default) naming that kind of account's tables.
import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { one, q, run } from '../db/index.js';
import { clientIp, HttpError } from './http.js';
import { normalizeBackupCode, verifyTotp } from './totp.js';

const scrypt = promisify(crypto.scrypt);
const SESSION_DAYS = 30;

// Table names are fixed here (never from input), so they can be interpolated into SQL.
export const REALMS = {
  member: { cookie: 'aurelia_member', accounts: 'members', sessions: 'member_sessions', challenges: 'member_mfa_challenges', fk: 'member_id' },
  companion: { cookie: 'aurelia_companion', accounts: 'companion_accounts', sessions: 'companion_sessions', challenges: 'companion_mfa_challenges', fk: 'account_id' },
};
const COOKIE = REALMS.member.cookie;

export async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password, salt, 64);
  return `scrypt$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(password, stored) {
  if (typeof password !== 'string' || !stored?.startsWith('scrypt$')) return false;
  const [, salt, hash] = stored.split('$');
  const expected = Buffer.from(hash, 'base64');
  const actual = await scrypt(password, Buffer.from(salt, 'base64'), expected.length);
  return crypto.timingSafeEqual(expected, actual);
}

export function passwordProblem(password) {
  if (typeof password !== 'string' || password.length < 8) return 'Use at least 8 characters.';
  if (password.length > 128) return 'Use 128 characters or fewer.';
  return null;
}

export const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

export function readCookie(req, name) {
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

export function writeCookie(req, res, name, value, maxAgeSeconds) {
  const secure = req.secure || req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
  const age = maxAgeSeconds == null ? '' : `; Max-Age=${maxAgeSeconds}`; // no Max-Age = ends with the browser session
  res.append('Set-Cookie', `${name}=${encodeURIComponent(value)}; HttpOnly; Path=/; SameSite=Lax${age}${secure}`);
}

export async function startSession(req, res, accountId, remember = true, realm = REALMS.member) {
  const token = crypto.randomBytes(32).toString('base64url');
  const days = remember ? SESSION_DAYS : 1;
  await run(`INSERT INTO ${realm.sessions} (${realm.fk}, token_hash, user_agent, ip_address, expires_at) VALUES ($1, $2, $3, $4, $5)`, [
    accountId, sha256(token), (req.headers['user-agent'] || '').slice(0, 200), clientIp(req)?.slice(0, 64) ?? null, new Date(Date.now() + days * 86400000),
  ]);
  await run(`UPDATE ${realm.accounts} SET last_login_at = now() WHERE id = $1`, [accountId]);
  await run(`DELETE FROM ${realm.sessions} WHERE expires_at < now()`);
  writeCookie(req, res, realm.cookie, token, remember ? days * 86400 : null);
}

export async function endSession(req, res, realm = REALMS.member) {
  const token = readCookie(req, realm.cookie);
  if (token) await run(`DELETE FROM ${realm.sessions} WHERE token_hash = $1`, [sha256(token)]);
  writeCookie(req, res, realm.cookie, '', 0);
}

/** Signs out every session of an account, optionally keeping the current one. */
export async function revokeMemberSessions(accountId, keepReq, realm = REALMS.member) {
  const keep = keepReq ? readCookie(keepReq, realm.cookie) : null;
  await run(`DELETE FROM ${realm.sessions} WHERE ${realm.fk} = $1 AND token_hash <> $2`, [accountId, keep ? sha256(keep) : '']);
}

/** The account's active sessions (devices), newest first; `current` marks this browser. */
export async function listSessions(req, accountId, realm = REALMS.member) {
  const token = readCookie(req, realm.cookie);
  const mine = token ? sha256(token) : '';
  const rows = await q(`SELECT id, token_hash, user_agent, ip_address, created_at, last_seen_at FROM ${realm.sessions} WHERE ${realm.fk} = $1 AND expires_at > now() ORDER BY last_seen_at DESC`, [accountId]);
  return rows.map(({ tokenHash, ...r }) => ({ ...r, current: tokenHash === mine }));
}

/** Two-step and password columns that never leave the server. */
export const SECRET_COLUMNS = ['passwordHash', 'sessionId', 'totpSecret', 'totpPendingSecret', 'totpLastStep', 'totpBackupCodes'];

/** The signed-in member (without the password hash) with their effective tier, or null. */
export async function sessionMember(req) {
  const token = readCookie(req, COOKIE);
  if (!token) return null;
  const row = await one(
    `SELECT m.*, s.id AS session_id,
            t.name AS tier_name, t.slug AS tier_slug, t.color AS tier_color,
            CASE WHEN t.id IS NOT NULL AND t.is_active AND m.membership_expires_on >= ph_today() THEN t.rank ELSE 0 END AS tier_rank
     FROM member_sessions s JOIN members m ON m.id = s.member_id LEFT JOIN tiers t ON t.id = m.tier_id
     WHERE s.token_hash = $1 AND s.expires_at > now() AND m.status = 'Active'
       AND m.password_hash IS NOT NULL AND m.email_verified_at IS NOT NULL`,
    [sha256(token)]
  );
  if (!row) return null;
  run("UPDATE member_sessions SET last_seen_at = now() WHERE id = $1 AND last_seen_at < now() - INTERVAL '10 minutes'", [row.sessionId]).catch(() => {});
  for (const k of SECRET_COLUMNS) delete row[k];
  return row;
}

export const requireMember = async (req, _res, next) => {
  try {
    req.member = await sessionMember(req);
    if (!req.member) throw new HttpError(401, 'Please sign in to continue.');
    next();
  } catch (e) {
    next(e);
  }
};

// ---------- Two-step sign-in (authenticator app) ----------
const CHALLENGE_MINUTES = 10;
export const MAX_MFA_ATTEMPTS = 5;

/** After a correct password: a short-lived token the browser sends back with the authenticator code. */
export async function createMfaChallenge(accountId, remember = true, realm = REALMS.member) {
  const token = crypto.randomBytes(32).toString('base64url');
  await run(`DELETE FROM ${realm.challenges} WHERE expires_at < now()`);
  await run(`INSERT INTO ${realm.challenges} (${realm.fk}, token_hash, remember, expires_at) VALUES ($1, $2, $3, $4)`, [
    accountId, sha256(token), !!remember, new Date(Date.now() + CHALLENGE_MINUTES * 60000),
  ]);
  return token;
}

/** The pending challenge as { id, accountId, remember, attempts }, or null. */
export async function findMfaChallenge(token, realm = REALMS.member) {
  if (typeof token !== 'string' || token.length < 20 || token.length > 100) return null;
  return one(`SELECT id, ${realm.fk} AS account_id, remember, attempts FROM ${realm.challenges} WHERE token_hash = $1 AND expires_at > now()`, [sha256(token)]);
}

/**
 * Checks an authenticator code or an unused backup code against the member's confirmed secret and uses it up.
 * Returns 'app', 'backup' or null.
 */
export async function consumeSecondFactor(accountId, code, realm = REALMS.member) {
  const t = realm.accounts;
  const m = await one(`SELECT totp_secret, totp_last_step, totp_backup_codes FROM ${t} WHERE id = $1`, [accountId]);
  if (!m?.totpSecret) return null;
  const step = verifyTotp(m.totpSecret, code, m.totpLastStep == null ? -1 : Number(m.totpLastStep));
  if (step != null) {
    // conditional, so two requests racing with the same code can't both succeed
    const n = await run(`UPDATE ${t} SET totp_last_step = $1::bigint WHERE id = $2 AND (totp_last_step IS NULL OR totp_last_step < $1::bigint)`, [step, accountId]);
    return n ? 'app' : null;
  }
  const backup = normalizeBackupCode(code);
  const hashes = JSON.parse(m.totpBackupCodes || '[]');
  if (backup.length !== 8 || !hashes.includes(sha256(backup))) return null;
  const n = await run(`UPDATE ${t} SET totp_backup_codes = $1 WHERE id = $2 AND totp_backup_codes = $3`, [
    JSON.stringify(hashes.filter((h) => h !== sha256(backup))), accountId, m.totpBackupCodes,
  ]);
  return n ? 'backup' : null;
}

export const hashBackupCodes = (codes) => JSON.stringify(codes.map((c) => sha256(normalizeBackupCode(c))));

/** Turns two-step sign-in off (also used by staff when someone lost their phone and backup codes). */
export async function clearTwoStep(accountId, realm = REALMS.member) {
  await run(`UPDATE ${realm.accounts} SET totp_secret = NULL, totp_pending_secret = NULL, totp_enabled_at = NULL, totp_last_step = NULL, totp_backup_codes = NULL,
      updated_at = now() WHERE id = $1`, [accountId]);
  await run(`DELETE FROM ${realm.challenges} WHERE ${realm.fk} = $1`, [accountId]);
}

// ---------- One-time email links (verify email / reset password) ----------
const TOKEN_HOURS = { verify: 24, reset: 2 };

/**
 * Creates a link token and returns the raw value. A new reset link cancels earlier ones.
 * Sign-up links don't cancel each other, so someone signing up with another person's email
 * can't knock out the owner's own link; confirming any of them removes the rest.
 */
export async function createToken(purpose, { email, memberId = null, data = null }) {
  const token = crypto.randomBytes(32).toString('base64url');
  if (purpose === 'reset') await run("DELETE FROM member_tokens WHERE purpose = 'reset' AND email = $1", [email]);
  await run("DELETE FROM member_tokens WHERE expires_at < now() - INTERVAL '7 days'");
  await run('INSERT INTO member_tokens (purpose, email, member_id, data, token_hash, expires_at) VALUES ($1, $2, $3, $4, $5, $6)', [
    purpose, email, memberId, data == null ? null : JSON.stringify(data), sha256(token), new Date(Date.now() + TOKEN_HOURS[purpose] * 3600000),
  ]);
  return token;
}

/** Uses up a link token. Returns { email, memberId, data } or null when unknown, used or expired. */
export async function consumeToken(purpose, token) {
  if (typeof token !== 'string' || token.length < 20 || token.length > 100) return null;
  const row = await one('DELETE FROM member_tokens WHERE purpose = $1 AND token_hash = $2 RETURNING email, member_id, data, expires_at', [purpose, sha256(token)]);
  if (!row || new Date(row.expiresAt) < new Date()) return null;
  return { email: row.email, memberId: row.memberId, data: row.data ? JSON.parse(row.data) : null };
}

export async function pendingSignups(email) {
  const rows = await q("SELECT data FROM member_tokens WHERE purpose = 'verify' AND email = $1 AND expires_at > now() ORDER BY created_at DESC LIMIT 5", [email]);
  return rows.filter((r) => r.data).map((r) => JSON.parse(r.data));
}

// ---------- Throttle (in memory, per serverless instance) ----------
const attempts = new Map();
export function throttle(key, { max = 8, windowMs = 15 * 60000 } = {}) {
  const now = Date.now();
  const a = attempts.get(key);
  if (a && a.until > now && a.count >= max) {
    throw new HttpError(429, `Too many attempts. Please try again in ${Math.ceil((a.until - now) / 60000)} minute(s).`);
  }
  return {
    fail: () => {
      const cur = attempts.get(key);
      attempts.set(key, cur && cur.until > now ? { ...cur, count: cur.count + 1 } : { count: 1, until: now + windowMs });
    },
    clear: () => attempts.delete(key),
  };
}

/** Counts an action against a limit, failing once it's exceeded (e.g. 6 bookings per hour per IP). */
export function rateLimit(key, max, windowMs) {
  const t = throttle(key, { max, windowMs });
  t.fail();
}
