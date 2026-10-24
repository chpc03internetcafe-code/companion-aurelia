// Shared security helpers: scrypt password hashes (staff accounts), cookies, and rate limits stored in the
// database (sign-in, booking, contact and chat forms).
import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { one, run } from '../db/index.js';
import { clientIp, HttpError } from './http.js';

const scrypt = promisify(crypto.scrypt);

// Password hashing: scrypt with OWASP's recommended cost (N=2^16, r=8, p=2, 64 MiB per hash) and a random
// 16-byte salt. The cost is stored in the hash ("scrypt$N$r$p$salt$key"), so it can be raised later: older,
// cheaper hashes (including the original "scrypt$salt$key" format) are upgraded when the person next signs in.
const COST = { N: 65536, r: 8, p: 2 };
const LEGACY_COST = { N: 16384, r: 8, p: 1 };
const KEY_LENGTH = 64;
const maxmem = ({ N, r, p }) => 128 * N * r * p + 32 * 1024 * 1024;

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
  if (!['admin_users'].includes(table)) throw new Error(`upgradeHash: unknown table ${table}`);
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
