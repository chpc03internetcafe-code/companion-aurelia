// Creates any missing tables, the starter staff roles and default settings. Safe to run again.
//   npm run db:init
// The API also runs this automatically on first start against an empty embedded database.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { closeDb, dbKind, exec, one, q, run } from './index.js';
import { DEFAULT_ROLES, MODULES } from '../lib/admin-auth.js';
import { defaultSettings } from '../services/settings.js';
import { encryptMessages } from './encrypt-messages.js';

const here = path.dirname(fileURLToPath(import.meta.url));

export async function initDb({ quiet = false } = {}) {
  await exec(fs.readFileSync(path.join(here, 'schema.sql'), 'utf8'));
  for (const r of DEFAULT_ROLES) {
    await run(
      `INSERT INTO admin_roles (name, description, permissions, is_system) VALUES ($1, $2, $3, $4)
       ON CONFLICT (name) DO NOTHING`,
      [r.name, r.description, JSON.stringify(r.permissions), !!r.isSystem]
    );
  }
  // Roles created before a CMS section existed get that section at the starter role's level (or no access).
  for (const role of await q('SELECT id, name, permissions FROM admin_roles WHERE NOT is_system')) {
    let perms;
    try { perms = JSON.parse(role.permissions || '{}'); } catch { perms = {}; }
    const missing = MODULES.filter(([k]) => !(k in perms));
    if (!missing.length) continue;
    const starter = DEFAULT_ROLES.find((r) => r.name === role.name)?.permissions || {};
    for (const [k] of missing) perms[k] = starter[k] || 'none';
    await run('UPDATE admin_roles SET permissions = $1 WHERE id = $2', [JSON.stringify(perms), role.id]);
  }
  for (const [key, value] of Object.entries(defaultSettings)) {
    await run('INSERT INTO site_settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING', [key, value]);
  }
  await encryptMessages({ quiet: true }); // message text still stored in plain text gets encrypted
  if (!quiet) console.log(`✓ Database ready (${await dbKind()})`);
}

/** True when the schema hasn't been created yet. */
export async function needsInit() {
  const row = await one("SELECT to_regclass('public.admin_roles') AS t");
  return !row?.t;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  initDb()
    .then(closeDb)
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
