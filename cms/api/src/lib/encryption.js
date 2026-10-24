// Encryption at rest for private conversations: the booking chat between client, companion and concierge
// (booking_messages.body), messages and notes on a booking's timeline (booking_events.note) and the client's
// note on a booking request (bookings.client_notes).
//
// - AES-256-GCM (authenticated: a changed byte makes decryption fail instead of returning altered text),
//   with a fresh random 12-byte IV for every message.
// - Stored as "enc:v1:<key id>:<base64url(iv | auth tag | ciphertext)>". The key id says which key was used,
//   so keys can be rotated: put the new key in MESSAGE_ENCRYPTION_KEY and the old one(s) in
//   MESSAGE_ENCRYPTION_KEYS_OLD (comma separated), then run `npm run db:encrypt-messages` to re-encrypt.
// - Encrypted values are recognised by their prefix and decrypted in the database layer (db/index.js), so
//   every reader (CMS, portals, exports) gets plain text; rows written before encryption still read as-is.
//
// The key (32 random bytes, base64) lives only in the server environment, never in the database or browser:
//   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
// Without it, only a developer's machine on the embedded database works: a key is generated in cms/api/data/.
// Losing the key means losing the messages, so keep a copy somewhere safe (a password manager).
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { HttpError } from './http.js';

const PREFIX = 'enc:v1:';
const AAD = Buffer.from('aurelia:messages:v1');
// next to the embedded database it belongs to (deleting that database folder doesn't leave a stale key behind)
const DEV_KEY_FILE = `${process.env.PGLITE_DIR || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../data/pglite')}.message-key`;
export const UNREADABLE = '[This message can’t be shown: the encryption key is missing or has changed.]';

const keyId = (key) => crypto.createHash('sha256').update(key).digest('hex').slice(0, 8);

function parseKey(value, name) {
  const key = Buffer.from(String(value).trim(), 'base64');
  if (key.length !== 32) throw new Error(`${name} must be 32 random bytes in base64 (44 characters). Generate one with: node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`);
  return key;
}

// A key file next to the embedded database, created on first use; only when there's no hosted database.
function devKey() {
  if (process.env.DATABASE_URL || process.env.VERCEL || process.env.NODE_ENV === 'production') return null;
  try {
    return parseKey(fs.readFileSync(DEV_KEY_FILE, 'utf8'), DEV_KEY_FILE);
  } catch {
    const key = crypto.randomBytes(32);
    fs.mkdirSync(path.dirname(DEV_KEY_FILE), { recursive: true });
    fs.writeFileSync(DEV_KEY_FILE, key.toString('base64'), { mode: 0o600 });
    return key;
  }
}

let keys; // { current: { id, key } | null, byId: Map }
function loadKeys() {
  if (keys) return keys;
  const byId = new Map();
  let current = null;
  const main = process.env.MESSAGE_ENCRYPTION_KEY ? parseKey(process.env.MESSAGE_ENCRYPTION_KEY, 'MESSAGE_ENCRYPTION_KEY') : devKey();
  if (main) {
    current = { id: keyId(main), key: main };
    byId.set(current.id, main);
  }
  for (const old of (process.env.MESSAGE_ENCRYPTION_KEYS_OLD || '').split(',').map((s) => s.trim()).filter(Boolean)) {
    const k = parseKey(old, 'MESSAGE_ENCRYPTION_KEYS_OLD');
    byId.set(keyId(k), k);
  }
  keys = { current, byId };
  return keys;
}

/** For tests and key rotation scripts: forget the loaded keys so the environment is read again. */
export const resetKeys = () => { keys = undefined; };

export const encryptionConfigured = () => !!loadKeys().current;
export const isEncrypted = (v) => typeof v === 'string' && v.startsWith(PREFIX);
/** The key id an encrypted value was written with (null for plain text). */
export const encryptedWith = (v) => (isEncrypted(v) ? v.slice(PREFIX.length).split(':')[0] : null);
export const currentKeyId = () => loadKeys().current?.id || null;

/** Encrypts a message for storage. null/empty stays as is. Refuses (503) when no key is configured. */
export function encryptText(plain) {
  if (plain == null || plain === '') return plain ?? null;
  const { current } = loadKeys();
  if (!current) {
    console.error('[encryption] MESSAGE_ENCRYPTION_KEY is not set: messages can’t be saved.');
    throw new HttpError(503, 'Messages can’t be saved right now. Please try again later.');
  }
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', current.key, iv);
  cipher.setAAD(AAD);
  const data = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  return `${PREFIX}${current.id}:${Buffer.concat([iv, cipher.getAuthTag(), data]).toString('base64url')}`;
}

/** Decrypts a stored value. Plain text (older rows) is returned unchanged; an unreadable value becomes a notice. */
export function decryptText(stored) {
  if (!isEncrypted(stored)) return stored;
  const [id, payload] = stored.slice(PREFIX.length).split(':');
  const key = loadKeys().byId.get(id);
  if (!key || !payload) return UNREADABLE;
  try {
    const raw = Buffer.from(payload, 'base64url');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, raw.subarray(0, 12));
    decipher.setAAD(AAD);
    decipher.setAuthTag(raw.subarray(12, 28));
    return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8');
  } catch {
    return UNREADABLE;
  }
}

/** The encrypted columns, as [table, column]; used by the re-encryption script. */
export const ENCRYPTED_COLUMNS = [['booking_messages', 'body'], ['booking_events', 'note'], ['bookings', 'client_notes']];
