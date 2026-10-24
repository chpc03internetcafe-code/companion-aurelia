// Audit trail.
//
// - logEvent() writes one entry (sign-ins, website events, and routes that describe their own changes).
// - auditWrites(module) is mounted in front of every CMS router. For each successful
//   POST/PUT/PATCH/DELETE it works out the action and the record from the URL, snapshots the record
//   before and after the change, and logs the field-by-field difference.
//   A route that logs its own, more specific entry sets `req.auditHandled = true` to skip this.
//
// Entries are written before the response is sent, so they aren't lost when a serverless function
// is frozen. Logging never fails a request. Passwords, hashes and tokens are never stored.
import { q, run } from '../db/index.js';
import { clientIp } from './http.js';

// fields that are never written to the audit trail (credentials, two-step secrets and backup codes, ID-check notes)
const SECRET = /password|token|hash|secret|totp|backup|mfa|otp|apikey|api_key|cookie|verification_?notes/i;
const SKIP_FIELDS = new Set(['id', 'createdAt', 'updatedAt', 'lastLoginAt', 'lastSeenAt', 'fullName']);
const MAX_TEXT = 500;

// Records and how to load them, per CMS section and sub-resource (e.g. promotions/codes).
const RESOURCES = {
  bookings: { '': ['bookings', 'Booking'] },
  profiles: { '': ['profiles', 'Profile'] },
  locations: { '': ['locations', 'Location'], categories: ['categories', 'Category'] },
  content: { pages: ['content_pages', 'Content page'], posts: ['posts', 'Post'], faqs: ['faqs', 'FAQ'] },
  seo: { redirects: ['redirects', 'Redirect'], settings: ['site_settings', 'SEO settings'] },
  settings: { '': ['site_settings', 'Site settings'], fees: ['fees', 'Fee'] },
  inquiries: { '': ['inquiries', 'Contact message'] },
  users: { users: ['admin_users', 'Staff user'], roles: ['admin_roles', 'Role'] },
};
const SUFFIX_ACTIONS = {
  status: 'Status changed', notes: 'Note added', media: 'Media uploaded', video: 'Video added', password: 'Password reset',
  'password-reset': 'Password reset sent', reschedule: 'Rescheduled', schedule: 'Availability updated', rates: 'Rates updated',
  'time-off': 'Time off updated', retire: 'Retired',
  sessions: 'Sessions revoked', profiles: 'Profiles updated', image: 'Image uploaded', cover: 'Cover uploaded',
};
// Writes that don't change anything (previews, test emails) aren't logged.
const READ_ONLY = new Set(['settings POST email', 'bookings POST quote']);

const LABEL_FIELDS = ['reference', 'displayName', 'fullName', 'name', 'title', 'clientName', 'question', 'fromPath', 'email', 'key'];
export const labelOf = (row) => (row ? LABEL_FIELDS.map((f) => row[f]).find((v) => v != null && v !== '') : null) ?? null;

// Message text is stored encrypted (lib/encryption.js); the audit trail records that it changed, not what it says.
const PRIVATE_TEXT = new Set(['clientNotes', 'note', 'body']);
const HIDDEN = '(private message)';

const clip = (v, k) => {
  if (PRIVATE_TEXT.has(k) && v != null && v !== '') return HIDDEN;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'string' && v.length > MAX_TEXT) return `${v.slice(0, MAX_TEXT)}…`;
  return v;
};
export const clean = (row) =>
  row ? Object.fromEntries(Object.entries(row).filter(([k, v]) => !SKIP_FIELDS.has(k) && !SECRET.test(k) && v != null && v !== '').map(([k, v]) => [k, clip(v, k)])) : null;

/** { field: { from, to } } for every field whose value changed. */
export function diff(before, after) {
  const out = {};
  for (const k of new Set([...Object.keys(before || {}), ...Object.keys(after || {})])) {
    if (SKIP_FIELDS.has(k) || SECRET.test(k)) continue;
    const a = clip(before?.[k] ?? null);
    const b = clip(after?.[k] ?? null);
    if (JSON.stringify(a) !== JSON.stringify(b)) out[k] = PRIVATE_TEXT.has(k) ? { from: a == null ? null : HIDDEN, to: b == null ? null : HIDDEN } : { from: a, to: b };
  }
  return out;
}

export const human = (field) => field.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase()).replace(/\bId\b/, 'ID');

/**
 * @param {{ action: string, module: string, entityType?: string, entityId?: any, entityLabel?: string,
 *           summary: string, changes?: object, actorType?: 'Staff'|'Member'|'Companion'|'Visitor'|'System', userName?: string, userEmail?: string }} entry
 */
export async function logEvent(entry, req) {
  try {
    const actor = req?.admin;
    const actorType = entry.actorType || (actor ? 'Staff' : 'System');
    await run(
      `INSERT INTO audit_log (actor_type, user_id, user_name, user_email, action, module, entity_type, entity_id, entity_label, summary, changes, ip_address, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [
        actorType,
        actorType === 'Staff' ? entry.userId ?? actor?.id ?? null : null,
        (entry.userName ?? actor?.name ?? null)?.slice(0, 150) ?? null,
        (entry.userEmail ?? actor?.email ?? null)?.slice(0, 254) ?? null,
        entry.action.slice(0, 40),
        entry.module.slice(0, 30),
        entry.entityType?.slice(0, 40) ?? null,
        entry.entityId == null ? null : String(entry.entityId).slice(0, 60),
        entry.entityLabel == null ? null : String(entry.entityLabel).slice(0, 200),
        entry.summary.slice(0, 500),
        entry.changes && Object.keys(entry.changes).length ? JSON.stringify(entry.changes) : null,
        req ? clientIp(req)?.slice(0, 64) ?? null : null,
        req ? (req.headers['user-agent'] || '').slice(0, 200) || null : null,
      ]
    );
  } catch (err) {
    console.error('[audit] could not write entry:', err.message);
  }
}

async function loadRow(table, id) {
  if (id == null) return null;
  if (table === 'site_settings') {
    const rows = await q('SELECT key, value FROM site_settings');
    return Object.fromEntries(rows.map((r) => [r.key, r.value]));
  }
  return (await q(`SELECT * FROM ${table} WHERE id = $1`, [table === 'branches' ? String(id) : Number(id) || -1]))[0] || null;
}

function describe(module, req) {
  const segs = req.path.split('/').filter(Boolean).map(decodeURIComponent);
  const subs = RESOURCES[module] || {};
  const sub = segs.length && Object.hasOwn(subs, segs[0]) && segs[0] !== '' ? segs.shift() : '';
  const resource = subs[sub];
  if (!resource) return null;
  const [table, entityType] = resource;
  const [id, suffix, subId] = segs;
  const m = req.method;
  if (READ_ONLY.has(`${module} ${m} ${id}`)) return null;

  if (table === 'site_settings') return id ? null : { table, entityType, id: 'site', action: 'Updated', snapshot: true };
  if (!id) {
    if (m === 'POST') return { table, entityType, action: 'Created' };
    if (m === 'PUT') return { table, entityType, action: 'Reordered' };
    return null;
  }
  if (suffix === 'media') {
    if (m === 'POST') return { table, entityType, id, action: 'Media uploaded' };
    if (m === 'PUT' && !subId) return { table, entityType, id, action: 'Media reordered' };
    if (m === 'PATCH' || m === 'PUT') return { table, entityType, id, action: 'Media updated', detail: subId };
    if (m === 'DELETE') return { table, entityType, id, action: 'Media deleted', detail: subId };
  }
  if ((suffix === 'image' || suffix === 'cover') && m === 'DELETE') return { table, entityType, id, action: 'Image removed', snapshot: true };
  if (suffix) return { table, entityType, id, action: SUFFIX_ACTIONS[suffix] || `${m} ${suffix}`, snapshot: true };
  if (m === 'DELETE') return { table, entityType, id, action: 'Deleted', snapshot: true };
  return { table, entityType, id, action: 'Updated', snapshot: true };
}

function summarize(d, label, changes, body) {
  const what = `${d.entityType.toLowerCase()}${label ? ` “${label}”` : ''}`;
  const fields = Object.keys(changes || {});
  switch (d.action) {
    case 'Created': return `Created ${what}`;
    case 'Deleted': return `Deleted ${what}`;
    case 'Reordered': return `Reordered ${d.entityType.toLowerCase()} list`;
    case 'Status changed': {
      const s = changes?.status;
      return s ? `${d.entityType} ${label || d.id}: ${s.from} → ${s.to}${body?.note ? ' (with a message)' : ''}` : `Changed status of ${what}`;
    }
    case 'Note added': return `Added a note to ${what}`;
    case 'Password reset': return `Reset the password of ${what}`;
    case 'Password reset sent': return `Emailed a password link to ${what}`;
    case 'Rescheduled': return `Rescheduled ${what}`;
    default:
      if (d.action.startsWith('Image') || d.action.endsWith('uploaded')) return `${d.action} — ${what}`;
      if (!fields.length) return `Saved ${what} (no changes)`;
      return `Updated ${what}: ${fields.slice(0, 6).map(human).join(', ')}${fields.length > 6 ? ` +${fields.length - 6} more` : ''}`;
  }
}

export const auditWrites = (module) => async (req, res, next) => {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return next();
  const d = describe(module, req);
  if (!d) return next();
  let before = null;
  try {
    if (d.snapshot) before = await loadRow(d.table, d.id);
  } catch (err) {
    console.error('[audit] snapshot failed:', err.message);
  }

  let payload;
  const json = res.json.bind(res);
  res.json = (body) => {
    payload = body;
    return json(body);
  };
  const end = res.end.bind(res);
  let done = false;
  res.end = (...args) => {
    if (done || res.statusCode >= 400 || req.auditHandled) return end(...args);
    done = true;
    (async () => {
      const createdId = d.action === 'Created' ? payload?.id ?? null : null;
      const id = d.id ?? createdId;
      const after = d.action === 'Deleted' ? null : await loadRow(d.table, id).catch(() => null);
      const label = labelOf(after) || labelOf(before) || req.body?.name || req.body?.title || req.body?.code || null;
      let changes = null;
      if (d.action === 'Created') changes = { values: clean(after || req.body) };
      else if (d.action === 'Deleted') changes = { values: clean(before) };
      else if (d.action === 'Reordered') changes = { order: req.body?.order };
      else if (before || after) changes = diff(before, after);
      await logEvent({
        action: d.action, module, entityType: d.entityType,
        entityId: d.table === 'site_settings' ? null : id,
        entityLabel: label, summary: summarize(d, label, changes, req.body), changes,
      }, req);
    })()
      .catch((err) => console.error('[audit] failed:', err.message))
      .finally(() => end(...args));
    return res;
  };
  next();
};
