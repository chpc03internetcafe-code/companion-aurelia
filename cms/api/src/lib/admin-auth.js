// CMS staff sign-in and permissions.
//
// - Staff sign in with email + password; the session is a random token in an httpOnly cookie,
//   stored as a SHA-256 hash in admin_sessions.
// - Each user has one role; a role grants, per CMS module, "none", "view" or "manage".
//   Reading (GET) needs view, any change needs manage. The system Administrator role always has
//   full access. Permissions are read from the database on every request, so role changes and
//   disabled accounts take effect immediately.
import crypto from 'node:crypto';
import { one, run } from '../db/index.js';
import { HttpError } from './http.js';
import { readCookie, sha256, writeCookie } from './auth.js';

// CMS modules that a role can be given access to, in menu order.
export const MODULES = [
  ['bookings', 'Bookings & Inquiries'],
  ['profiles', 'Profiles'],
  ['locations', 'Locations & Categories'],
  ['content', 'Content & FAQs'],
  ['seo', 'SEO & Redirects'],
  ['inquiries', 'Contact Messages & Live Chat'],
  ['settings', 'Site Settings'],
  ['users', 'Users & Roles'],
  ['audit', 'Audit Trail'],
];
export const LEVELS = ['none', 'view', 'manage'];
const RANK = { none: 0, view: 1, manage: 2 };

const all = (level) => Object.fromEntries(MODULES.map(([k]) => [k, level]));
const only = (grants) => ({ ...all('none'), ...grants });

// Inserted once by db:init; staff can edit or delete them (except Administrator).
export const DEFAULT_ROLES = [
  { name: 'Administrator', description: 'Full access to everything, including staff accounts and roles.', permissions: all('manage'), isSystem: true },
  {
    name: 'Manager',
    description: 'Runs the agency day to day. Everything except staff accounts.',
    permissions: { ...all('manage'), users: 'none', audit: 'view' },
  },
  {
    name: 'Booking Coordinator',
    description: 'Handles booking requests, profile inquiries, contact messages and live chat; keeps availability up to date.',
    permissions: only({ bookings: 'manage', inquiries: 'manage', profiles: 'view', locations: 'view' }),
  },
  {
    name: 'Profile Editor',
    description: 'Creates and updates profiles: photos, videos, rates, availability and verification.',
    permissions: only({ profiles: 'manage', locations: 'view', bookings: 'view' }),
  },
  {
    name: 'Content Editor',
    description: 'Looks after the website: location pages, guides, announcements, FAQs, SEO and redirects.',
    permissions: only({ content: 'manage', seo: 'manage', locations: 'manage', profiles: 'view' }),
  },
];

export function normalizePermissions(value) {
  let p = value;
  if (typeof p === 'string') {
    try { p = JSON.parse(p); } catch { p = {}; }
  }
  return Object.fromEntries(MODULES.map(([k]) => [k, LEVELS.includes(p?.[k]) ? p[k] : 'none']));
}

export const effectivePermissions = (role) => (role.isSystem ? all('manage') : normalizePermissions(role.permissions));
export const can = (permissions, module, level) => RANK[permissions[module] || 'none'] >= RANK[level];
// True when every module in `role` is at or below the level in `mine` (no privilege escalation).
export const withinPermissions = (role, mine) => MODULES.every(([k]) => RANK[role[k]] <= RANK[mine[k]]);

// ---------- Sessions ----------
const COOKIE = 'aurelia_admin_session';

export async function startAdminSession(req, res, userId, remember) {
  const token = crypto.randomBytes(32).toString('base64url');
  const hours = remember ? 24 * 30 : 12;
  await run('INSERT INTO admin_sessions (user_id, token_hash, user_agent, expires_at) VALUES ($1, $2, $3, $4)', [
    userId, sha256(token), (req.headers['user-agent'] || '').slice(0, 200), new Date(Date.now() + hours * 3600000),
  ]);
  await run('UPDATE admin_users SET last_login_at = now() WHERE id = $1', [userId]);
  await run('DELETE FROM admin_sessions WHERE expires_at < now()');
  writeCookie(req, res, COOKIE, token, remember ? hours * 3600 : null);
  return token;
}

export async function endAdminSession(req, res) {
  const token = readCookie(req, COOKIE);
  if (token) await run('DELETE FROM admin_sessions WHERE token_hash = $1', [sha256(token)]);
  writeCookie(req, res, COOKIE, '', 0);
}

/** Signs out every session of a staff user, optionally keeping the current one. */
export async function revokeSessions(userId, keepReq) {
  const keep = keepReq ? readCookie(keepReq, COOKIE) : null;
  await run('DELETE FROM admin_sessions WHERE user_id = $1 AND token_hash <> $2', [userId, keep ? sha256(keep) : '']);
}

/** The signed-in staff member with role and effective permissions, or null. */
export const currentAdmin = (req) => adminFromToken(readCookie(req, COOKIE));

export async function adminFromToken(token) {
  if (!token) return null;
  const row = await one(
    `SELECT u.id, u.full_name, u.email, u.must_change_password, u.role_id,
            r.name AS role_name, r.permissions, r.is_system, s.id AS session_id
     FROM admin_sessions s
     JOIN admin_users u ON u.id = s.user_id
     JOIN admin_roles r ON r.id = u.role_id
     WHERE s.token_hash = $1 AND s.expires_at > now() AND u.status = 'Active'`,
    [sha256(token)]
  );
  if (!row) return null;
  run("UPDATE admin_sessions SET last_seen_at = now() WHERE id = $1 AND last_seen_at < now() - INTERVAL '5 minutes'", [row.sessionId]).catch(() => {});
  return {
    id: row.id,
    name: row.fullName,
    email: row.email,
    roleId: row.roleId,
    role: row.roleName,
    isAdministrator: row.isSystem,
    mustChangePassword: row.mustChangePassword,
    permissions: effectivePermissions(row),
  };
}

// ---------- Middleware ----------
async function resolve(req) {
  req.admin = await currentAdmin(req);
  if (!req.admin) throw new HttpError(401, 'Please sign in to the CMS.');
  if (req.admin.mustChangePassword) throw new HttpError(403, 'Please set a new password before continuing.', { code: 'password_change_required' });
}

export const requireAdmin = async (req, _res, next) => {
  try {
    await resolve(req);
    next();
  } catch (e) {
    next(e);
  }
};

const label = (module) => MODULES.find(([k]) => k === module)?.[1] || module;

/** Access to one module: GET/HEAD need "view", anything else needs "manage". */
export const requirePermission = (module) => async (req, _res, next) => {
  try {
    await resolve(req);
    const level = req.method === 'GET' || req.method === 'HEAD' ? 'view' : 'manage';
    if (!can(req.admin.permissions, module, level)) {
      throw new HttpError(403, level === 'view' ? `You don't have access to ${label(module)}.` : `Your role can view ${label(module)} but not change it.`);
    }
    next();
  } catch (e) {
    next(e);
  }
};

/** For routes inside one module that need another module too (e.g. a booking from a profile). */
export function assertCan(req, module, level = 'view') {
  if (!can(req.admin.permissions, module, level)) {
    throw new HttpError(403, level === 'view' ? `This needs access to ${label(module)}.` : `This needs permission to change ${label(module)}.`);
  }
}

// ---------- First-run setup ----------
// The first administrator can be created only while no staff accounts exist. On a hosted
// deployment that also needs ADMIN_SETUP_KEY so a stranger can't claim the CMS first.
export const setupKey = () => process.env.ADMIN_SETUP_KEY || '';
export const setupKeyRequired = () => !!setupKey() || !!process.env.VERCEL;
export function checkSetupKey(given) {
  const key = setupKey();
  if (!key) {
    if (process.env.VERCEL) throw new HttpError(503, 'Set ADMIN_SETUP_KEY in the hosting environment to create the first administrator.');
    return;
  }
  const a = crypto.createHash('sha256').update(String(given || '')).digest();
  const b = crypto.createHash('sha256').update(key).digest();
  if (!crypto.timingSafeEqual(a, b)) throw new HttpError(403, 'The setup key is incorrect.', { setupKey: 'Incorrect setup key.' });
}
