// Staff account rescue from the command line.
//   npm run admin:list                         lists staff accounts
//   npm run admin:reset -- someone@example.com sets a temporary password (must be changed at next sign-in)
import '../env.js';
import crypto from 'node:crypto';
import { closeDb, one, q, run } from './index.js';
import { hashPassword } from '../lib/auth.js';

const [cmd, email] = process.argv.slice(2);
try {
  if (cmd === 'list') {
    const rows = await q('SELECT u.email, u.full_name, r.name AS role, u.status, u.last_login_at FROM admin_users u JOIN admin_roles r ON r.id = u.role_id ORDER BY u.full_name');
    if (!rows.length) console.log('No staff accounts yet — open the CMS to run first-time setup.');
    for (const r of rows) console.log(`${r.email.padEnd(32)} ${r.fullName.padEnd(28)} ${r.role.padEnd(18)} ${r.status}`);
  } else if (cmd === 'reset' && email) {
    const u = await one('SELECT id FROM admin_users WHERE lower(email) = lower($1)', [email]);
    if (!u) throw new Error(`No staff account with email ${email}.`);
    const temp = `Aurelia-${crypto.randomBytes(4).toString('hex')}`;
    await run("UPDATE admin_users SET password_hash = $1, must_change_password = TRUE, status = 'Active', updated_at = now() WHERE id = $2", [await hashPassword(temp), u.id]);
    await run('DELETE FROM admin_sessions WHERE user_id = $1', [u.id]);
    console.log(`Temporary password for ${email}: ${temp}\nThey must choose a new one at the next sign-in.`);
  } else {
    console.log('Usage: npm run admin:list | npm run admin:reset -- someone@example.com');
  }
} catch (err) {
  console.error(err.message);
  process.exitCode = 1;
} finally {
  await closeDb();
}
