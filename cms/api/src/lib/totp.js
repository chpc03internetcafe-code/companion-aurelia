// Authenticator-app codes (TOTP, RFC 6238): 6 digits, 30-second steps, HMAC-SHA1 — what Google Authenticator,
// Microsoft Authenticator, Authy, 1Password etc. expect. Plus one-time backup codes for a lost phone.
import crypto from 'node:crypto';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const STEP_MS = 30000;

export function base32Encode(buf) {
  let bits = 0, value = 0, out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

function base32Decode(s) {
  let bits = 0, value = 0;
  const out = [];
  for (const ch of s.toUpperCase().replace(/=+$/, '')) {
    const i = ALPHABET.indexOf(ch);
    if (i < 0) continue;
    value = (value << 5) | i;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** A new 160-bit secret, base32 (what the app's "enter a setup key" screen takes). */
export const newSecret = () => base32Encode(crypto.randomBytes(20));

function hotp(secret, counter) {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const h = crypto.createHmac('sha1', base32Decode(secret)).update(msg).digest();
  const o = h[h.length - 1] & 15;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1000000).padStart(6, '0');
}

/** The code an authenticator app shows right now (used by the smoke test). */
export const totpCode = (secret, now = Date.now()) => hotp(secret, Math.floor(now / STEP_MS));

/**
 * Checks a 6-digit code, allowing one step of clock drift either way. Returns the matched step, or null.
 * Steps at or before `afterStep` are refused, so a code that was already used can't be replayed.
 */
export function verifyTotp(secret, code, afterStep = -1, now = Date.now()) {
  const c = String(code || '').replace(/[\s-]/g, '');
  if (!secret || !/^\d{6}$/.test(c)) return null;
  const step = Math.floor(now / STEP_MS);
  for (const s of [step - 1, step, step + 1]) {
    if (s > afterStep && crypto.timingSafeEqual(Buffer.from(hotp(secret, s)), Buffer.from(c))) return s;
  }
  return null;
}

export const otpauthUrl = ({ secret, issuer, account }) =>
  `otpauth://totp/${encodeURIComponent(`${issuer}:${account}`)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;

// ---------- Backup codes: 10 × "ABCD-EFGH", stored only as SHA-256 hashes ----------
export const normalizeBackupCode = (c) => String(c || '').toUpperCase().replace(/[^A-Z2-7]/g, '');

export function newBackupCodes(n = 10) {
  return Array.from({ length: n }, () => {
    const c = base32Encode(crypto.randomBytes(5));
    return `${c.slice(0, 4)}-${c.slice(4, 8)}`;
  });
}
