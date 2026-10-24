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

// Password hashing: scrypt with OWASP's recommended cost (N=2^16, r=8, p=2, 64 MiB per hash) and a random
// 16-byte salt. The cost is stored in the hash ("scrypt$N$r$p$salt$key"), so it can be raised later: older,
// cheaper hashes (including the original "scrypt$salt$key" format) are upgraded when the person next signs in.
const COST = { N: 65536, r: 8, p: 2 };
const LEGACY_COST = { N: 16384, r: 8, p: 1 };
const KEY_LENGTH = 64;
const maxmem = ({ N, r, p }) => 128 * N * r * p + 32 * 1024 * 1024;

// Table names are fixed here (never from input), so they can be interpolated into SQL.
export const REALMS = {
  member: { cookie: 'aurelia_member', accounts: 'members', sessions: 'member_sessions', challenges: 'member_mfa_challenges', fk: 'member_id' },
  companion: { cookie: 'aurelia_companion', accounts: 'companion_accounts', sessions: 'companion_sessions', challenges: 'companion_mfa_challenges', fk: 'account_id' },
};
const COOKIE = REALMS.member.cookie;

export async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password.normalize('NFKC'), salt, KEY_LENGTH, { ...COST, maxmem: maxmem(COST) });
  return `scrypt$${COST.N}$${COST.r}$${COST.p}$${salt.toString('base64')}$${key.toString('base64')}`;
}

function parseHash(stored) {
  const parts = typeof stored === 'string' ? stored.split('$') : [];
  if (parts[0] !== 'scrypt') return null;
  if (parts.length === 3) return { cost: LEGACY_COST, salt: parts[1], key: parts[2], legacy: true };
  if (parts.length !== 6) return null;
  const [N, r, p] = parts.slice(1, 4).map(Number);
  if (![N, r, p].every(Number.isInteger) || N > 2 ** 20 || r > 32 || p > 16) return null;
  return { cost: { N, r, p }, salt: parts[4], key: parts[5], legacy: false };
}

export async function verifyPassword(password, stored) {
  const h = parseHash(stored);
  if (typeof password !== 'string' || !h || password.length > 1024) return false;
  const expected = Buffer.from(h.key, 'base64');
  // the original format hashed the password as typed; new hashes normalise Unicode first
  const input = h.legacy ? password : password.normalize('NFKC');
  const actual = await scrypt(input, Buffer.from(h.salt, 'base64'), expected.length, { ...h.cost, maxmem: maxmem(h.cost) });
  return crypto.timingSafeEqual(expected, actual);
}

/** True when a stored hash is weaker than the current cost and should be replaced after a successful sign-in. */
export function needsRehash(stored) {
  const h = parseHash(stored);
  return !h || h.legacy || h.cost.N < COST.N || h.cost.r < COST.r || h.cost.p < COST.p;
}

// A real hash to check against when the account doesn't exist, so "no such email" takes as long as
// "wrong password" and response times don't reveal which emails have accounts.
let dummyHash;
/** Sign-in password check. stored may be null/undefined (unknown account): still costs one hash, returns false. */
export async function checkPassword(password, stored) {
  dummyHash ||= hashPassword(crypto.randomBytes(16).toString('hex'));
  const ok = await verifyPassword(String(password ?? ''), stored || (await dummyHash));
  return !!stored && ok;
}

/** After a successful sign-in: re-hashes the password at the current cost if its stored hash is older/cheaper. */
export async function upgradeHash(table, id, password, stored) {
  if (!needsRehash(stored)) return;
  if (!['members', 'companion_accounts', 'admin_users'].includes(table)) throw new Error(`upgradeHash: unknown table ${table}`);
  await run(`UPDATE ${table} SET password_hash = $1 WHERE id = $2 AND password_hash = $3`, [await hashPassword(String(password)), id, stored]);
}

// Passwords people pick first; refused when setting a new password (existing ones keep working).
const COMMON_PASSWORDS = new Set(['password', 'password1', 'password12', 'password123', 'password1234', 'passw0rd', 'p@ssw0rd', 'p@ssword', '12345678', '123456789',
  '1234567890', '11111111', '00000000', '87654321', 'qwertyui', 'qwertyuiop', 'qwerty123', 'qwerty12', 'asdfghjk', 'abcd1234', 'abc12345', 'iloveyou', 'iloveyou1',
  'sunshine', 'princess', 'football', 'baseball', 'welcome1', 'welcome123', 'letmein1', 'admin123', 'administrator', 'changeme', 'trustno1', 'superman', 'whatever1',
  'aurelia1', 'aurelia123', 'companion', 'companions']);

/** Why a new password can't be used, or null. `email` (optional) stops the address itself being the password. */
export function passwordProblem(password, email) {
  if (typeof password !== 'string' || password.length < 8) return 'Use at least 8 characters.';
  if (password.length > 128) return 'Use 128 characters or fewer.';
  const lower = password.toLowerCase();
  if (COMMON_PASSWORDS.has(lower) || /^(.)\1+$/.test(password)) return 'This password is too common. Choose something harder to guess.';
  const local = String(email || '').toLowerCase().split('@')[0];
  if (local.length >= 4 && lower.includes(local)) return 'Don’t use your email address in your password.';
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

// ---------- Throttle (stored in the database, so every server instance shares the counts) ----------
// Keys are hashed before they're stored, so the emails and IP addresses in them aren't kept in plain text.
const limitKey = (key) => sha256(`rl:${key}`);

/**
 * Refuses (429) once `key` has failed `max` times in the window. Returns { fail, clear }:
 * await fail() for each failed attempt and clear() after a success.
 */
export async function throttle(key, { max = 8, windowMs = 15 * 60000 } = {}) {
  const k = limitKey(key);
  const row = await one('SELECT count, reset_at FROM rate_limits WHERE key = $1 AND reset_at > now()', [k]);
  if (row && row.count >= max) {
    const minutes = Math.max(1, Math.ceil((new Date(row.resetAt) - Date.now()) / 60000));
    throw new HttpError(429, `Too many attempts. Please try again in ${minutes} minute(s).`);
  }
  return {
    fail: async () => {
      await run(`INSERT INTO rate_limits (key, count, reset_at) VALUES ($1, 1, now() + make_interval(secs => $2::int))
        ON CONFLICT (key) DO UPDATE SET
          count = CASE WHEN rate_limits.reset_at > now() THEN rate_limits.count + 1 ELSE 1 END,
          reset_at = CASE WHEN rate_limits.reset_at > now() THEN rate_limits.reset_at ELSE EXCLUDED.reset_at END`, [k, Math.ceil(windowMs / 1000)]);
      if (Math.random() < 0.02) run('DELETE FROM rate_limits WHERE reset_at < now()').catch(() => {});
    },
    clear: () => run('DELETE FROM rate_limits WHERE key = $1', [k]),
  };
}

/**
 * Sign-in limits: per IP + email (stops one source guessing), and per email from anywhere (stops guessing one
 * account from many IP addresses). The per-account limit is higher so a stranger can't easily lock someone out.
 */
export async function loginLimiter(scope, req, email, max = 8) {
  const perIp = await throttle(`${scope}:${clientIp(req)}:${email}`, { max });
  const perAccount = await throttle(`${scope}-account:${email}`, { max: max * 4 });
  return {
    fail: async () => { await perIp.fail(); await perAccount.fail(); },
    clear: async () => { await perIp.clear(); await perAccount.clear(); },
  };
}

/** Counts an action against a limit, failing once it's exceeded (e.g. 6 bookings per hour per IP). */
export async function rateLimit(key, max, windowMs) {
  await (await throttle(key, { max, windowMs })).fail();
}
