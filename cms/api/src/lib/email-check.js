// Can this email address receive mail? Checks the domain has mail servers (MX records, or an address
// record as the standard fallback) and isn't a throwaway inbox. Used at sign-up, before the confirmation
// email is sent, so typos like "gmial.com" are caught on the form. The confirmation link still proves
// the person owns the address.
//
// On by default in production; EMAIL_DNS_CHECK=0 turns it off, EMAIL_DNS_CHECK=1 turns it on in development.
// A slow or failing DNS lookup never blocks a sign-up.
import dns from 'node:dns/promises';
import { isProduction } from './security.js';

const DISPOSABLE = new Set(['mailinator.com', 'guerrillamail.com', 'guerrillamail.net', 'sharklasers.com', '10minutemail.com', 'tempmail.com', 'temp-mail.org',
  'yopmail.com', 'trashmail.com', 'getnada.com', 'dispostable.com', 'maildrop.cc', 'throwawaymail.com', 'fakeinbox.com', 'mintemail.com', 'mohmal.com', 'emailondeck.com']);
const TIMEOUT_MS = 3000;

export const emailCheckEnabled = () => (process.env.EMAIL_DNS_CHECK ? process.env.EMAIL_DNS_CHECK === '1' : isProduction());

const withTimeout = (p) => Promise.race([p, new Promise((_, reject) => setTimeout(() => reject(Object.assign(new Error('timeout'), { code: 'ETIMEOUT' })), TIMEOUT_MS))]);
const NO_SUCH_DOMAIN = new Set(['ENOTFOUND', 'ENODATA', 'NXDOMAIN']);

/** Why the address can't receive mail, or null when it looks deliverable (or the check is off / inconclusive). */
export async function emailDeliveryProblem(email) {
  if (!emailCheckEnabled()) return null;
  const domain = String(email).split('@')[1]?.toLowerCase();
  if (!domain) return 'Enter a valid email address.';
  if (DISPOSABLE.has(domain)) return 'Please use a permanent email address, not a temporary inbox.';
  try {
    const mx = await withTimeout(dns.resolveMx(domain));
    // "MX 0 ." (RFC 7505) means the domain explicitly accepts no mail
    if (mx.length && mx.every((r) => !r.exchange || r.exchange === '.')) return `${domain} doesn’t accept email. Check the address for typos.`;
    if (mx.length) return null;
  } catch (err) {
    if (!NO_SUCH_DOMAIN.has(err.code)) return null; // DNS trouble: don't block the person
  }
  try {
    await withTimeout(dns.resolve(domain)); // no MX: mail falls back to the domain's own address
    return null;
  } catch (err) {
    return NO_SUCH_DOMAIN.has(err.code) ? `We couldn’t find ${domain}. Check the email address for typos.` : null;
  }
}
