// CMS: messages from the website Contact page.
import { Router } from 'express';
import { one, params, q, run } from '../db/index.js';
import { HttpError, idParam, paging, wrap } from '../lib/http.js';
import { validate } from '../lib/validate.js';

const router = Router();
export const INQUIRY_STATUSES = ['New', 'In Progress', 'Resolved', 'Closed'];
export const INQUIRY_SUBJECTS = ['General question', 'Booking help', 'VIP membership', 'Rates & payment', 'Join as a companion', 'Profile correction or removal', 'Feedback', 'Others'];

const SELECT = `SELECT i.*, m.member_no, m.full_name AS member_name
  FROM inquiries i LEFT JOIN members m ON m.id = i.member_id`;

// ?search &status (Open = New + In Progress) &subject
router.get('/', wrap(async (req, res) => {
  const { page, pageSize, offset } = paging(req.query);
  const p = params();
  const where = [];
  if (req.query.status === 'Open') where.push("i.status IN ('New','In Progress')");
  else if (INQUIRY_STATUSES.includes(req.query.status)) where.push(`i.status = ${p.add(req.query.status)}`);
  if (INQUIRY_SUBJECTS.includes(req.query.subject)) where.push(`i.subject = ${p.add(req.query.subject)}`);
  if (req.query.search) {
    const s = p.add(`%${req.query.search}%`);
    where.push(`(i.reference ILIKE ${s} OR i.full_name ILIKE ${s} OR i.email ILIKE ${s} OR i.phone ILIKE ${s} OR i.message ILIKE ${s})`);
  }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const { total } = await one(`SELECT COUNT(*)::int AS total FROM inquiries i ${w}`, p.values);
  const items = await q(`${SELECT} ${w} ORDER BY i.created_at DESC LIMIT ${p.add(pageSize)} OFFSET ${p.add(offset)}`, p.values);
  res.json({ items, total, page, pageSize });
}));

router.get('/stats', wrap(async (_req, res) => {
  res.json(await one(`SELECT COUNT(*) FILTER (WHERE status = 'New')::int AS new, COUNT(*) FILTER (WHERE status = 'In Progress')::int AS in_progress,
    COUNT(*) FILTER (WHERE status IN ('Resolved','Closed') AND updated_at >= now() - INTERVAL '30 days')::int AS resolved_30d, COUNT(*)::int AS total FROM inquiries`));
}));

router.get('/:id', wrap(async (req, res) => {
  const row = await one(`${SELECT} WHERE i.id = $1`, [idParam(req)]);
  if (!row) throw new HttpError(404, 'Inquiry not found.');
  res.json(row);
}));

// body: { status?, staffNotes? }
router.patch('/:id', wrap(async (req, res) => {
  const id = idParam(req);
  const data = validate(req.body, {
    status: { type: 'enum', values: INQUIRY_STATUSES },
    staffNotes: { type: 'string', max: 4000 },
  }, { partial: true });
  const sets = [];
  const vals = [];
  for (const [k, col] of [['status', 'status'], ['staffNotes', 'staff_notes']]) {
    if (k in data) { vals.push(data[k]); sets.push(`${col} = $${vals.length}`); }
  }
  if (sets.length) {
    vals.push(id);
    if (!(await run(`UPDATE inquiries SET ${sets.join(', ')}, updated_at = now() WHERE id = $${vals.length}`, vals))) throw new HttpError(404, 'Inquiry not found.');
  }
  res.json(await one(`${SELECT} WHERE i.id = $1`, [id]));
}));

router.delete('/:id', wrap(async (req, res) => {
  if (!(await run('DELETE FROM inquiries WHERE id = $1', [idParam(req)]))) throw new HttpError(404, 'Inquiry not found.');
  res.status(204).end();
}));

export default router;
