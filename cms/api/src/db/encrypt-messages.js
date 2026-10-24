// Encrypts message text that is still stored in plain text, and re-encrypts text written with an older key
// (after rotating MESSAGE_ENCRYPTION_KEY): npm run db:encrypt-messages
// Safe to run again. Also runs as part of db:init and after loading demo data.
// Uses DATABASE_URL and MESSAGE_ENCRYPTION_KEY from cms/api/.env: point it at the database whose messages you
// want encrypted, with the same key the deployed API uses.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { closeDb, driver } from './index.js';
import { currentKeyId, decryptText, encryptedWith, encryptionConfigured, encryptText, ENCRYPTED_COLUMNS, UNREADABLE } from '../lib/encryption.js';

const BATCH = 500;

/** Returns { encrypted, unreadable } counts. Without a key it does nothing (and says so unless quiet). */
export async function encryptMessages({ quiet = false } = {}) {
  if (!encryptionConfigured()) {
    if (!quiet) console.warn('… Messages not encrypted: set MESSAGE_ENCRYPTION_KEY (see cms/api/.env.example).');
    return { encrypted: 0, unreadable: 0, skipped: true };
  }
  const d = await driver(); // raw rows: the normal query helpers would decrypt the values
  const current = currentKeyId();
  let encrypted = 0;
  let unreadable = 0;
  for (const [table, column] of ENCRYPTED_COLUMNS) {
    let lastId = 0;
    for (;;) {
      const { rows } = await d.query(
        `SELECT id, ${column} AS value FROM ${table} WHERE id > $1 AND ${column} IS NOT NULL AND ${column} <> '' ORDER BY id LIMIT ${BATCH}`, [lastId]);
      if (!rows.length) break;
      lastId = rows[rows.length - 1].id;
      for (const r of rows) {
        if (encryptedWith(r.value) === current) continue;
        const plain = decryptText(r.value);
        if (plain === UNREADABLE) { unreadable += 1; continue; } // written with a key we don't have: leave it alone
        // only replace the value if nobody changed it meanwhile
        await d.query(`UPDATE ${table} SET ${column} = $1 WHERE id = $2 AND ${column} = $3`, [encryptText(plain), r.id, r.value]);
        encrypted += 1;
      }
    }
  }
  if (!quiet || encrypted || unreadable) {
    console.log(`✓ Messages encrypted: ${encrypted} updated${unreadable ? `, ${unreadable} written with a key that isn’t configured (add it to MESSAGE_ENCRYPTION_KEYS_OLD)` : ''}`);
  }
  return { encrypted, unreadable, skipped: false };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  encryptMessages()
    .then(closeDb)
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
