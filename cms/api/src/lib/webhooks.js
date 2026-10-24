// Signature checks for incoming webhooks (payment providers, email delivery reports, etc.).
//
// No webhooks are received yet. When one is added, mount it under /api/webhooks/ (app.js keeps the raw request
// bytes for that path) behind verifyWebhook, with its signing secret in an environment variable:
//
//   import { verifyWebhook } from '../lib/webhooks.js';
//   app.post('/api/webhooks/payments', verifyWebhook({ secretEnv: 'PAYMENTS_WEBHOOK_SECRET' }), handler);
//
// Default scheme (used by Stripe-style providers): header `X-Webhook-Timestamp: <unix seconds>` and
// `X-Webhook-Signature: sha256=<hex HMAC-SHA256 of "<timestamp>.<raw body>">`. Adjust the header names or the
// signed string to what the provider documents; keep the constant-time comparison, the time window and the
// replay check.
import crypto from 'node:crypto';
import { HttpError } from './http.js';

const seen = new Map(); // signature -> expiry, so a captured request can't be replayed within the window

/** True when `signature` is a valid HMAC-SHA256 of `${timestamp}.${rawBody}` with `secret`, made within toleranceSec. */
export function checkSignature({ secret, rawBody, timestamp, signature, toleranceSec = 300, now = Date.now() }) {
  if (!secret || !rawBody || !timestamp || !signature) return false;
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(now / 1000 - ts) > toleranceSec) return false;
  const expected = crypto.createHmac('sha256', secret).update(`${ts}.`).update(rawBody).digest();
  const given = Buffer.from(String(signature).replace(/^sha256=/, ''), 'hex');
  return given.length === expected.length && crypto.timingSafeEqual(given, expected);
}

/** Express middleware: refuses (401) webhooks without a valid, fresh, unused signature. */
export function verifyWebhook({ secretEnv, signatureHeader = 'x-webhook-signature', timestampHeader = 'x-webhook-timestamp', toleranceSec = 300 }) {
  return (req, _res, next) => {
    const secret = process.env[secretEnv];
    if (!secret) return next(new HttpError(503, 'Webhook is not configured.'));
    const signature = req.headers[signatureHeader];
    const ok = checkSignature({ secret, rawBody: req.rawBody, timestamp: req.headers[timestampHeader], signature, toleranceSec });
    if (!ok) return next(new HttpError(401, 'Invalid webhook signature.'));
    const now = Date.now();
    for (const [k, exp] of seen) if (exp < now) seen.delete(k);
    if (seen.has(signature)) return next(new HttpError(409, 'Webhook already received.'));
    seen.set(signature, now + toleranceSec * 2000);
    next();
  };
}
