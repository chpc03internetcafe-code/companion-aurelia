// App-wide protections: production mode, the client's real IP, security headers, cross-site request checks,
// a per-IP request limit, CORS and log redaction. Wired up in app.js.
import { HttpError } from './http.js';

/** Production = deployed (Vercel) or NODE_ENV=production. Debug helpers are off in production. */
export const isProduction = () => !!process.env.VERCEL || process.env.NODE_ENV === 'production';

/**
 * "Open the link directly" shortcuts for email links when email isn't configured. Only on a developer's
 * machine: never in production, and with a hosted database only when SHOW_DEV_LINKS=1 is set explicitly.
 * (Returning a password-reset link to whoever asked would let anyone take over any account.)
 */
export const devLinksAllowed = () => !isProduction() && (!process.env.DATABASE_URL || process.env.SHOW_DEV_LINKS === '1');

// ---------- Client IP ----------
// X-Forwarded-For can be typed by anyone, so it's only believed as far as a known proxy vouches for it:
// - Vercel replaces the header with the real client address (and sets X-Real-IP).
// - Self-hosted behind N proxies (nginx, a load balancer): TRUST_PROXY=N reads the address N hops from the right.
// - Otherwise the socket address is used.
const proxyHops = () => (process.env.VERCEL ? 1 : Math.max(0, Number.parseInt(process.env.TRUST_PROXY, 10) || 0));
export const trustProxySetting = () => (process.env.VERCEL ? true : proxyHops() || false);

export function clientIp(req) {
  if (process.env.VERCEL) return req.headers['x-real-ip'] || req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket?.remoteAddress || null;
  const hops = proxyHops();
  if (hops) {
    const chain = String(req.headers['x-forwarded-for'] || '').split(',').map((s) => s.trim()).filter(Boolean);
    if (chain.length) return chain[Math.max(0, chain.length - hops)];
  }
  return req.socket?.remoteAddress || null;
}

// ---------- Security headers ----------
/** Headers for every API response: nothing here is meant to be framed, sniffed or run as a page. */
export function securityHeaders(req, res, next) {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Resource-Policy': 'same-site',
    'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
  });
  if (isProduction()) res.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  // Personal data must never be stored by a browser or CDN cache; public routes opt in to caching themselves.
  res.set('Cache-Control', 'no-store');
  next();
}

// ---------- CORS and cross-site requests ----------
// The website and the CMS call the API on their own domain, so no other site needs access. Extra origins
// (e.g. a separately hosted CMS) can be allowed with CORS_ORIGIN=https://cms.example.com,https://other.example.
const DEV_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;
const allowedOrigins = () => (process.env.CORS_ORIGIN || '').split(',').map((s) => s.trim().replace(/\/$/, '')).filter(Boolean);
const sameHost = (origin, req) => {
  try { return new URL(origin).host === (req.headers['x-forwarded-host'] || req.headers.host); } catch { return false; }
};
const originAllowed = (origin, req) => sameHost(origin, req) || allowedOrigins().includes(origin) || (!isProduction() && DEV_ORIGIN.test(origin));

/** Options for the cors() middleware: only listed origins (and localhost in development) get credentialed access. */
export const corsOptions = {
  credentials: true,
  origin: (origin, cb) => cb(null, !origin || allowedOrigins().includes(origin) || (!isProduction() && DEV_ORIGIN.test(origin))),
};

/**
 * Blocks cross-site form posts and fetches (CSRF): a change (POST/PUT/PATCH/DELETE) is accepted only from the
 * site itself, an allowed origin, or a non-browser client (no Origin header and no cross-site fetch metadata).
 * Session cookies are also SameSite=Lax, so this is a second layer.
 */
export function blockCrossSite(req, _res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const origin = req.headers.origin;
  if (origin && origin !== 'null' && originAllowed(origin, req)) return next();
  if (!origin && req.headers['sec-fetch-site'] !== 'cross-site') return next();
  next(new HttpError(403, 'This request came from another website and was blocked.'));
}

// ---------- Request limit ----------
// A broad per-IP ceiling against floods and scraping (in memory, per server instance). Sign-in, sign-up,
// booking and contact forms have their own, much lower limits stored in the database (lib/auth.js).
const WINDOW_MS = 60_000;
const LIMITS = { read: Number(process.env.RATE_LIMIT_READS) || 300, write: Number(process.env.RATE_LIMIT_WRITES) || 60 };
const hits = new Map();
let lastSweep = Date.now();

// Long-poll requests stay open ~20 s each, so they're cheap and never counted.
export const LONG_POLL_PATHS = new Set(['/api/notifications/wait', '/api/live-chat/wait', '/api/site/chat/wait']);

export function requestLimit(req, res, next) {
  if (req.path === '/api/health' || LONG_POLL_PATHS.has(req.path)) return next();
  const now = Date.now();
  if (now - lastSweep > WINDOW_MS) {
    for (const [k, v] of hits) if (v.reset <= now) hits.delete(k);
    lastSweep = now;
  }
  const kind = ['GET', 'HEAD', 'OPTIONS'].includes(req.method) ? 'read' : 'write';
  const key = `${kind}:${clientIp(req)}`;
  let h = hits.get(key);
  if (!h || h.reset <= now) hits.set(key, (h = { count: 0, reset: now + WINDOW_MS }));
  h.count += 1;
  res.set('RateLimit-Limit', String(LIMITS[kind]));
  res.set('RateLimit-Remaining', String(Math.max(0, LIMITS[kind] - h.count)));
  if (h.count > LIMITS[kind]) {
    res.set('Retry-After', String(Math.ceil((h.reset - now) / 1000)));
    return next(new HttpError(429, 'Too many requests. Please wait a minute and try again.'));
  }
  next();
}

// ---------- Request bodies ----------
/** JSON reviver that drops keys used for prototype pollution. */
export const safeJsonReviver = (key, value) => (key === '__proto__' || key === 'constructor' || key === 'prototype' ? undefined : value);

// ---------- Configuration ----------
/** Warns (once, at start-up) about production settings that weaken security. Secrets stay in environment variables, never in code or the browser. */
export function checkProductionConfig() {
  if (!isProduction()) return [];
  const problems = [];
  const setup = process.env.ADMIN_SETUP_KEY || '';
  if (setup && setup.length < 16) problems.push('ADMIN_SETUP_KEY is shorter than 16 characters; use a long random value.');
  if (process.env.SITE_URL && !process.env.SITE_URL.startsWith('https://')) problems.push('SITE_URL should start with https:// in production.');
  if (process.env.SHOW_DEV_LINKS === '1') problems.push('SHOW_DEV_LINKS is ignored in production.');
  if (!process.env.MESSAGE_ENCRYPTION_KEY) problems.push('MESSAGE_ENCRYPTION_KEY is not set: booking chats and notes can’t be saved.');
  if ((process.env.CORS_ORIGIN || '').includes('*')) problems.push('CORS_ORIGIN must list exact origins; "*" is not supported.');
  for (const p of problems) console.warn(`[security] ${p}`);
  return problems;
}

// ---------- Logs ----------
/** a***@example.com: enough to recognise in a log without keeping the address. */
export const maskEmail = (email) => String(email || '').replace(/^(.)[^@]*(@.*)$/, '$1***$2');

/** An error as it's safe to log: message, code and stack, without SQL parameters or row values (err.detail). */
export function loggableError(err) {
  if (!isProduction()) return err;
  return { message: err.message, code: err.code, status: err.status, stack: err.stack?.split('\n').slice(0, 6).join('\n') };
}
