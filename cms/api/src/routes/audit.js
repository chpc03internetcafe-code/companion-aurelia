// Audit trail (read-only): GET /api/audit, /filters, /export, /:id. There are deliberately no routes to edit or delete entries.
import { Router } from 'express';
import { one, params, q } from '../db/index.js';
import { logEvent } from '../lib/audit.js';
import { MODULES } from '../lib/admin-auth.js';
import { HttpError, paging, sendCsv, wrap } from '../lib/http.js';
import { isIsoDate } from '../lib/dates.js';

const router = Router();
const MODULE_LABELS = { ...Object.fromEntries(MODULES), auth: 'Sign-in', website: 'Website' };

function filters(query) {
  const p = params();
  const where = [];
  if (query.search?.trim()) {
    const s = p.add(`%${query.search.trim()}%`);
    where.push(`(a.summary ILIKE ${s} OR a.entity_label ILIKE ${s} OR a.user_name ILIKE ${s} OR a.user_email ILIKE ${s} OR a.entity_id = ${p.add(query.search.trim())})`);
  }
  if (query.module) where.push(`a.module = ${p.add(query.module)}`);
  if (query.action) where.push(`a.action = ${p.add(query.action)}`);
  if (query.actorType) where.push(`a.actor_type = ${p.add(query.actorType)}`);
  if (query.userId) where.push(`a.user_id = ${p.add(Number(query.userId))}`);
  if (query.entityType) where.push(`a.entity_type = ${p.add(query.entityType)}`);
  if (query.entityId) where.push(`a.entity_id = ${p.add(String(query.entityId))}`);
  // dates are Philippine calendar days
  if (isIsoDate(query.from)) where.push(`a.created_at >= ${p.add(new Date(`${query.from}T00:00:00+08:00`))}`);
  if (isIsoDate(query.to)) where.push(`a.created_at < ${p.add(new Date(Date.parse(`${query.to}T00:00:00+08:00`) + 86400000))}`);
  return { p, w: where.length ? `WHERE ${where.join(' AND ')}` : '' };
}

const COLUMNS = 'a.id, a.created_at, a.actor_type, a.user_id, a.user_name, a.user_email, a.action, a.module, a.entity_type, a.entity_id, a.entity_label, a.summary, a.ip_address';

router.get('/', wrap(async (req, res) => {
  const { page, pageSize, offset } = paging(req.query, 50);
  const { p, w } = filters(req.query);
  const { total } = await one(`SELECT COUNT(*)::int AS total FROM audit_log a ${w}`, p.values);
  const items = await q(`SELECT ${COLUMNS}, (a.changes IS NOT NULL) AS has_changes FROM audit_log a ${w} ORDER BY a.created_at DESC, a.id DESC LIMIT ${p.add(pageSize)} OFFSET ${p.add(offset)}`, p.values);
  res.json({ total, page, pageSize, items });
}));

router.get('/filters', wrap(async (_req, res) => {
  const [users, actions, modules, stats] = await Promise.all([
    q('SELECT DISTINCT a.user_id AS id, COALESCE(u.full_name, a.user_name) AS name FROM audit_log a LEFT JOIN admin_users u ON u.id = a.user_id WHERE a.user_id IS NOT NULL ORDER BY name'),
    q('SELECT DISTINCT action FROM audit_log ORDER BY action'),
    q('SELECT DISTINCT module FROM audit_log ORDER BY module'),
    one(`SELECT COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE created_at >= now() - INTERVAL '1 day')::int AS last24h,
      COUNT(*) FILTER (WHERE action = 'Sign-in failed' AND created_at >= now() - INTERVAL '7 days')::int AS failed_sign_ins_7d,
      COUNT(DISTINCT user_id) FILTER (WHERE created_at >= now() - INTERVAL '7 days')::int AS active_staff_7d
      FROM audit_log`),
  ]);
  res.json({
    users,
    actions: actions.map((a) => a.action),
    modules: modules.map((m) => ({ key: m.module, label: MODULE_LABELS[m.module] || m.module })),
    stats,
  });
}));

// CSV of the current filter (newest first, up to 10,000 rows). The export itself is logged.
router.get('/export', wrap(async (req, res) => {
  const { p, w } = filters(req.query);
  const rows = await q(`SELECT ${COLUMNS}, a.changes, a.user_agent FROM audit_log a ${w} ORDER BY a.created_at DESC, a.id DESC LIMIT 10000`, p.values);
  await logEvent({ action: 'Exported', module: 'audit', entityType: 'Audit trail', summary: `Exported ${rows.length} audit entr${rows.length === 1 ? 'y' : 'ies'} to CSV` }, req);
  sendCsv(res, `audit-trail-${new Date().toISOString().slice(0, 10)}.csv`,
    ['Id', 'When (UTC)', 'Actor type', 'User', 'Email', 'Action', 'Section', 'Record type', 'Record id', 'Record', 'Summary', 'Changes', 'IP address', 'Browser'],
    rows.map((x) => [x.id, x.createdAt, x.actorType, x.userName, x.userEmail, x.action, MODULE_LABELS[x.module] || x.module, x.entityType, x.entityId, x.entityLabel, x.summary, x.changes, x.ipAddress, x.userAgent]));
}));

router.get('/:id', wrap(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, 'Invalid id.');
  const row = await one('SELECT * FROM audit_log WHERE id = $1', [id]);
  if (!row) throw new HttpError(404, 'Audit entry not found.');
  let changes = null;
  try { changes = row.changes ? JSON.parse(row.changes) : null; } catch { changes = null; }
  res.json({ ...row, changes, moduleLabel: MODULE_LABELS[row.module] || row.module });
}));

export default router;
