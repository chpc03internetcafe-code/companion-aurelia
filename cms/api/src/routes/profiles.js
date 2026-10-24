// CMS: profiles — details, verification, visibility, media, rates, weekly availability, time off, retiring.
import { Router } from 'express';
import { one, params, q, run, tx } from '../db/index.js';
import { HttpError, idParam, paging, wrap } from '../lib/http.js';
import { slugify, validate } from '../lib/validate.js';
import { logEvent } from '../lib/audit.js';
import { removeImages, saveImage, imageUpload } from '../lib/storage.js';
import { parseBlocks, parseTimeOff, saveSchedule, saveTimeOff } from '../services/schedule.js';

const router = Router();
const upload = imageUpload(12);
export const PROFILE_STATUSES = ['Draft', 'Published', 'Hidden', 'Retired'];

const validateAttributes = (v) => {
  if (!Array.isArray(v) || v.length > 20) return 'Up to 20 facts.';
  if (v.some((a) => !a || typeof a.label !== 'string' || typeof a.value !== 'string' || a.label.length > 40 || a.value.length > 120)) return 'Each fact needs a label (40) and value (120).';
  return null;
};

const schema = {
  displayName: { type: 'string', required: true, max: 80, label: 'Display name' },
  slug: { type: 'string', max: 120, pattern: /^[a-z0-9-]+$/, patternMessage: 'Use lowercase letters, numbers and dashes.' },
  categoryId: { type: 'int', required: true, min: 1, message: 'Choose a category.' },
  baseLocationId: { type: 'int', min: 1 },
  age: { type: 'int', required: true, min: 18, max: 99, message: 'Profiles must be 18 or over.' },
  tagline: { type: 'string', max: 160 },
  bio: { type: 'string', max: 6000 },
  languages: { type: 'string', max: 200 },
  nationality: { type: 'string', max: 60 },
  heightCm: { type: 'int', min: 120, max: 230 },
  attributes: { type: 'json', validate: validateAttributes, default: '[]' },
  status: { type: 'enum', values: ['Draft', 'Published', 'Hidden'], default: 'Draft' },
  isFeatured: { type: 'bool' },
  verificationNotes: { type: 'string', max: 1000 },
  bookingEnabled: { type: 'bool', default: true },
  awayUntil: { type: 'date' },
  awayNote: { type: 'string', max: 200 },
  seoTitle: { type: 'string', max: 70 },
  metaDescription: { type: 'string', max: 170 },
  staffNotes: { type: 'string', max: 6000 },
};
const COLS = Object.keys(schema).map((k) => k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`));

const LIST = `
  SELECT p.id, p.slug, p.display_name, p.age, p.status, p.is_featured, p.is_verified, p.age_verified_at, p.booking_enabled, p.away_until,
         p.updated_at, p.published_at, p.last_active_at, c.name AS category_name, l.name AS location_name,
         (SELECT url FROM profile_media m WHERE m.profile_id = p.id AND m.kind = 'photo' ORDER BY m.is_primary DESC, m.sort_order, m.id LIMIT 1) AS photo_url,
         (SELECT COUNT(*)::int FROM profile_media m WHERE m.profile_id = p.id) AS media_count,
         (SELECT COUNT(*)::int FROM profile_rates r WHERE r.profile_id = p.id AND r.is_active) AS rate_count,
         (SELECT MIN(price) FROM profile_rates r WHERE r.profile_id = p.id AND r.is_active) AS price_from,
         (SELECT COUNT(*)::int FROM profile_schedules s WHERE s.profile_id = p.id) AS schedule_blocks,
         (SELECT COUNT(*)::int FROM bookings b WHERE b.profile_id = p.id AND b.status IN ('Pending','Confirmed') AND (b.booking_date IS NULL OR b.booking_date >= ph_today())) AS open_bookings
  FROM profiles p JOIN categories c ON c.id = p.category_id LEFT JOIN locations l ON l.id = p.base_location_id`;

router.get('/', wrap(async (req, res) => {
  const { page, pageSize, offset } = paging(req.query, 50);
  const p = params();
  const where = [];
  if (PROFILE_STATUSES.includes(req.query.status)) where.push(`p.status = ${p.add(req.query.status)}`);
  else if (req.query.status !== 'all') where.push("p.status <> 'Retired'");
  if (req.query.categoryId) where.push(`p.category_id = ${p.add(Number(req.query.categoryId))}`);
  if (req.query.locationId) {
    const l = p.add(Number(req.query.locationId));
    where.push(`(p.base_location_id = ${l} OR l.parent_id = ${l} OR EXISTS (SELECT 1 FROM profile_areas a WHERE a.profile_id = p.id AND a.location_id = ${l}))`);
  }
  if (req.query.flag === 'featured') where.push('p.is_featured');
  if (req.query.flag === 'unverified') where.push('NOT p.is_verified');
  if (req.query.flag === 'incomplete') where.push(`(NOT EXISTS (SELECT 1 FROM profile_rates r WHERE r.profile_id = p.id AND r.is_active) OR NOT EXISTS (SELECT 1 FROM profile_schedules s WHERE s.profile_id = p.id)
    OR NOT EXISTS (SELECT 1 FROM profile_media m WHERE m.profile_id = p.id) OR p.meta_description IS NULL)`);
  if (req.query.search) {
    const s = p.add(`%${req.query.search}%`);
    where.push(`(p.display_name ILIKE ${s} OR p.slug ILIKE ${s} OR p.tagline ILIKE ${s})`);
  }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const { total } = await one(`SELECT COUNT(*)::int AS total FROM profiles p LEFT JOIN locations l ON l.id = p.base_location_id ${w}`, p.values);
  const sort = { name: 'p.display_name', updated: 'p.updated_at DESC', newest: 'p.created_at DESC' }[req.query.sort] || 'p.is_featured DESC, p.sort_order, p.display_name';
  const items = await q(`${LIST} ${w} ORDER BY ${sort} LIMIT ${p.add(pageSize)} OFFSET ${p.add(offset)}`, p.values);
  res.json({ items, total, page, pageSize });
}));

router.get('/stats', wrap(async (_req, res) => {
  res.json(await one(`SELECT COUNT(*) FILTER (WHERE status = 'Published')::int AS published, COUNT(*) FILTER (WHERE status = 'Draft')::int AS drafts,
    COUNT(*) FILTER (WHERE status = 'Hidden')::int AS hidden, COUNT(*) FILTER (WHERE status = 'Retired')::int AS retired,
    COUNT(*) FILTER (WHERE status = 'Published' AND is_verified)::int AS verified
    FROM profiles`));
}));

// Picker for staff bookings: profiles with their active rates.
router.get('/options', wrap(async (_req, res) => {
  const rows = await q(`SELECT p.id, p.display_name, p.slug, p.status, c.name AS category_name, l.name AS location_name,
      COALESCE((SELECT json_agg(json_build_object('id', r.id, 'label', r.label, 'durationMinutes', r.duration_minutes, 'price', r.price) ORDER BY r.sort_order, r.duration_minutes)
                FROM profile_rates r WHERE r.profile_id = p.id AND r.is_active), '[]') AS rates
    FROM profiles p JOIN categories c ON c.id = p.category_id LEFT JOIN locations l ON l.id = p.base_location_id
    WHERE p.status <> 'Retired' ORDER BY p.display_name`);
  res.json(rows.map((r) => ({ ...r, rates: typeof r.rates === 'string' ? JSON.parse(r.rates) : r.rates })));
}));

async function detail(id) {
  const p = await one(`SELECT p.*, c.name AS category_name, c.slug AS category_slug FROM profiles p JOIN categories c ON c.id = p.category_id WHERE p.id = $1`, [id]);
  if (!p) throw new HttpError(404, 'Profile not found.');
  const [areas, media, rates, schedule, timeOff, stats] = await Promise.all([
    q('SELECT location_id FROM profile_areas WHERE profile_id = $1', [id]),
    q('SELECT * FROM profile_media WHERE profile_id = $1 ORDER BY is_primary DESC, sort_order, id', [id]),
    q('SELECT * FROM profile_rates WHERE profile_id = $1 ORDER BY sort_order, duration_minutes', [id]),
    q("SELECT id, weekday, to_char(start_time, 'HH24:MI') AS start, CASE WHEN end_time = '24:00' THEN '24:00' ELSE to_char(end_time, 'HH24:MI') END AS end FROM profile_schedules WHERE profile_id = $1 ORDER BY weekday, start_time", [id]),
    q('SELECT * FROM profile_time_off WHERE profile_id = $1 ORDER BY start_date DESC', [id]),
    one(`SELECT COUNT(*) FILTER (WHERE status IN ('Pending','Confirmed') AND (booking_date IS NULL OR booking_date >= ph_today()))::int AS open_bookings,
      COUNT(*) FILTER (WHERE status = 'Completed')::int AS completed, COUNT(*)::int AS total FROM bookings WHERE profile_id = $1`, [id]),
  ]);
  return { ...p, attributes: JSON.parse(p.attributes || '[]'), areaIds: areas.map((a) => a.locationId), media, rates, schedule, timeOff, stats, ageVerified: !!p.ageVerifiedAt };
}

router.get('/:id', wrap(async (req, res) => res.json(await detail(idParam(req)))));

async function saveAreas(db, id, areaIds) {
  if (!Array.isArray(areaIds)) return;
  await db.run('DELETE FROM profile_areas WHERE profile_id = $1', [id]);
  const ids = [...new Set(areaIds.map(Number).filter(Number.isInteger))].slice(0, 40);
  if (ids.length) await db.run('INSERT INTO profile_areas (profile_id, location_id) SELECT $1, id FROM locations WHERE id = ANY($2::int[]) ON CONFLICT DO NOTHING', [id, ids]);
}

function checkPublish(data, ageVerified) {
  if (data.status === 'Published' && !ageVerified) {
    throw new HttpError(422, 'Confirm the government ID check (18+) before publishing.', { ageVerified: 'Required before publishing.' });
  }
}

router.post('/', wrap(async (req, res) => {
  const data = validate(req.body, schema);
  const ageVerified = !!req.body.ageVerified;
  checkPublish(data, ageVerified);
  data.slug ||= slugify(data.displayName);
  const id = await tx(async (db) => {
    const vals = Object.keys(schema).map((k) => data[k]);
    const row = await db.one(
      `INSERT INTO profiles (${COLS.join(', ')}, is_verified, verified_at, age_verified_at, published_at, last_active_at)
       VALUES (${COLS.map((_, i) => `$${i + 1}`).join(', ')}, $${COLS.length + 1}, CASE WHEN $${COLS.length + 1} THEN now() END,
               CASE WHEN $${COLS.length + 2} THEN now() END, CASE WHEN $${COLS.length + 3} = 'Published' THEN now() END, now()) RETURNING id`,
      [...vals, !!req.body.isVerified, ageVerified, data.status]
    );
    await saveAreas(db, row.id, req.body.areaIds);
    return row.id;
  });
  res.status(201).json(await detail(id));
}));

router.put('/:id', wrap(async (req, res) => {
  const id = idParam(req);
  const before = await detail(id);
  if (before.status === 'Retired') throw new HttpError(409, 'This profile is retired. Restore it first.');
  const data = validate(req.body, schema);
  const ageVerified = req.body.ageVerified === undefined ? before.ageVerified : !!req.body.ageVerified;
  checkPublish(data, ageVerified);
  data.slug ||= slugify(data.displayName);
  await tx(async (db) => {
    await db.run(
      `UPDATE profiles SET ${COLS.map((c, i) => `${c} = $${i + 1}`).join(', ')},
         is_verified = $${COLS.length + 1}, verified_at = CASE WHEN $${COLS.length + 1} THEN COALESCE(verified_at, now()) END,
         age_verified_at = CASE WHEN $${COLS.length + 2} THEN COALESCE(age_verified_at, now()) END,
         published_at = CASE WHEN $${COLS.length + 3} = 'Published' THEN COALESCE(published_at, now()) ELSE published_at END,
         updated_at = now() WHERE id = $${COLS.length + 4}`,
      [...Object.keys(schema).map((k) => data[k]), req.body.isVerified === undefined ? before.isVerified : !!req.body.isVerified, ageVerified, data.status, id]
    );
    await saveAreas(db, id, req.body.areaIds);
    // keep old links working when the URL changes
    if (data.slug !== before.slug && before.publishedAt) {
      await db.run(`INSERT INTO redirects (from_path, to_path, note) VALUES ($1, $2, 'Profile URL changed')
        ON CONFLICT (from_path) DO UPDATE SET to_path = EXCLUDED.to_path, is_active = TRUE, updated_at = now()`, [`/companions/${before.slug}`, `/companions/${data.slug}`]);
      await db.run('DELETE FROM redirects WHERE from_path = $1', [`/companions/${data.slug}`]);
    }
  });
  res.json(await detail(id));
}));

// Quick toggles from the list: { status?, isFeatured?, bookingEnabled?, markActive? }
router.patch('/:id', wrap(async (req, res) => {
  const id = idParam(req);
  const before = await detail(id);
  const data = validate(req.body, { status: schema.status, isFeatured: schema.isFeatured, bookingEnabled: schema.bookingEnabled }, { partial: true });
  if ('status' in data) checkPublish(data, before.ageVerified);
  if (before.status === 'Retired' && 'status' in data) throw new HttpError(409, 'Use “Restore” for a retired profile.');
  const sets = [];
  const vals = [];
  for (const [k, col] of [['status', 'status'], ['isFeatured', 'is_featured'], ['bookingEnabled', 'booking_enabled']]) {
    if (k in data) { vals.push(data[k]); sets.push(`${col} = $${vals.length}`); }
  }
  if (data.status === 'Published') sets.push('published_at = COALESCE(published_at, now())');
  if (req.body.markActive) sets.push('last_active_at = now()');
  if (sets.length) {
    vals.push(id);
    await run(`UPDATE profiles SET ${sets.join(', ')}, updated_at = now() WHERE id = $${vals.length}`, vals);
  }
  res.json(await detail(id));
}));

// ---------- Rates ----------
router.put('/:id/rates', wrap(async (req, res) => {
  const id = idParam(req);
  await detail(id);
  const list = Array.isArray(req.body.rates) ? req.body.rates : [];
  if (list.length > 20) throw new HttpError(422, 'Up to 20 rates per profile.');
  const rates = list.map((r, i) => {
    const d = validate(r, {
      id: { type: 'int', min: 1 },
      label: { type: 'string', required: true, max: 80, label: 'Label' },
      durationMinutes: { type: 'int', required: true, min: 15, max: 1440, message: `Rate ${i + 1}: enter 15–1440 minutes.` },
      price: { type: 'decimal', required: true, min: 0, message: `Rate ${i + 1}: enter a price.` },
      notes: { type: 'string', max: 200 },
      isActive: { type: 'bool', default: true },
    });
    return { ...d, sortOrder: i };
  });
  await tx(async (db) => {
    const keep = rates.filter((r) => r.id).map((r) => r.id);
    // rates used by bookings are deactivated rather than deleted (bookings keep their label and price either way)
    await db.run('DELETE FROM profile_rates WHERE profile_id = $1 AND NOT (id = ANY($2::int[]))', [id, keep]);
    for (const r of rates) {
      if (r.id) await db.run('UPDATE profile_rates SET label = $1, duration_minutes = $2, price = $3, notes = $4, is_active = $5, sort_order = $6 WHERE id = $7 AND profile_id = $8', [r.label, r.durationMinutes, r.price, r.notes, r.isActive, r.sortOrder, r.id, id]);
      else await db.run('INSERT INTO profile_rates (profile_id, label, duration_minutes, price, notes, is_active, sort_order) VALUES ($1,$2,$3,$4,$5,$6,$7)', [id, r.label, r.durationMinutes, r.price, r.notes, r.isActive, r.sortOrder]);
    }
    await db.run('UPDATE profiles SET updated_at = now() WHERE id = $1', [id]);
  });
  res.json(await detail(id));
}));

// ---------- Weekly availability ----------
// body: { blocks: [{ weekday, start: 'HH:MM', end: 'HH:MM' | '24:00' }] }
router.put('/:id/schedule', wrap(async (req, res) => {
  const id = idParam(req);
  await detail(id);
  const blocks = parseBlocks(req.body.blocks);
  await tx((db) => saveSchedule(db, id, blocks));
  res.json(await detail(id));
}));

// body: { items: [{ startDate, endDate, note }] }
router.put('/:id/time-off', wrap(async (req, res) => {
  const id = idParam(req);
  await detail(id);
  const items = parseTimeOff(req.body.items);
  await tx((db) => saveTimeOff(db, id, items));
  res.json(await detail(id));
}));

// ---------- Media ----------
router.post('/:id/media', upload.array('photos', 12), wrap(async (req, res) => {
  const id = idParam(req);
  const p = await detail(id);
  if (!req.files?.length) throw new HttpError(422, 'Choose one or more photos (JPG, PNG or WEBP, up to 4 MB each).');
  if (p.media.length + req.files.length > 40) throw new HttpError(422, 'Up to 40 photos and videos per profile.');
  let order = p.media.length;
  const hasPrimary = p.media.some((m) => m.isPrimary && m.kind === 'photo' && !m.isHidden);
  for (const [i, f] of req.files.entries()) {
    const saved = await saveImage(f.buffer, `profiles/${id}`);
    await run('INSERT INTO profile_media (profile_id, kind, url, file_name, alt_text, is_primary, sort_order) VALUES ($1, $2, $3, $4, $5, $6, $7)',
      [id, 'photo', saved.url, saved.fileName, `${p.displayName} — photo ${order + 1}`, !hasPrimary && i === 0, order++]);
  }
  await run('UPDATE profiles SET updated_at = now() WHERE id = $1', [id]);
  res.status(201).json(await detail(id));
}));

const VIDEO_URL = /^https:\/\/(www\.)?(youtube\.com|youtu\.be|vimeo\.com|player\.vimeo\.com)\/\S+$|^https:\/\/\S+\.(mp4|webm)(\?\S*)?$/i;
router.post('/:id/video', wrap(async (req, res) => {
  const id = idParam(req);
  const p = await detail(id);
  const d = validate(req.body, {
    url: { type: 'string', required: true, max: 500, pattern: VIDEO_URL, patternMessage: 'Paste a YouTube or Vimeo link, or an https link to an .mp4/.webm file.' },
    posterUrl: { type: 'string', max: 500, pattern: /^https?:\/\/\S+$|^\/uploads\/\S+$/, patternMessage: 'Enter an image link.' },
    altText: { type: 'string', max: 200 },
  });
  await run('INSERT INTO profile_media (profile_id, kind, url, poster_url, alt_text, sort_order) VALUES ($1, $2, $3, $4, $5, $6)',
    [id, 'video', d.url, d.posterUrl, d.altText || `${p.displayName} — video`, p.media.length]);
  await run('UPDATE profiles SET updated_at = now() WHERE id = $1', [id]);
  res.status(201).json(await detail(id));
}));

router.put('/:id/media', wrap(async (req, res) => {
  const id = idParam(req);
  if (!Array.isArray(req.body.order)) throw new HttpError(422, 'Send the new order.');
  for (const [i, mid] of req.body.order.entries()) await run('UPDATE profile_media SET sort_order = $1 WHERE id = $2 AND profile_id = $3', [i, Number(mid), id]);
  res.json(await detail(id));
}));

// body: { altText?, isHidden?, isPrimary? } — hidden photos and videos stay in the CMS but aren't shown on the website
router.patch('/:id/media/:mediaId', wrap(async (req, res) => {
  const id = idParam(req);
  const mid = idParam(req, 'mediaId');
  const m = await one('SELECT * FROM profile_media WHERE id = $1 AND profile_id = $2', [mid, id]);
  if (!m) throw new HttpError(404, 'Media not found.');
  const d = validate(req.body, { altText: { type: 'string', max: 200 }, isHidden: { type: 'bool' }, isPrimary: { type: 'bool' } }, { partial: true });
  if ('altText' in d) await run('UPDATE profile_media SET alt_text = $1 WHERE id = $2', [d.altText, mid]);
  if ('isHidden' in d) await run('UPDATE profile_media SET is_hidden = $1, is_primary = CASE WHEN $1 THEN FALSE ELSE is_primary END WHERE id = $2', [d.isHidden, mid]);
  if (d.isPrimary) {
    if (m.kind !== 'photo') throw new HttpError(422, 'Only a photo can be the main picture.');
    await run('UPDATE profile_media SET is_primary = (id = $1), is_hidden = CASE WHEN id = $1 THEN FALSE ELSE is_hidden END WHERE profile_id = $2', [mid, id]);
  }
  await run('UPDATE profiles SET updated_at = now() WHERE id = $1', [id]);
  res.json(await detail(id));
}));

router.delete('/:id/media/:mediaId', wrap(async (req, res) => {
  const id = idParam(req);
  const m = await one('DELETE FROM profile_media WHERE id = $1 AND profile_id = $2 RETURNING url, file_name', [idParam(req, 'mediaId'), id]);
  if (!m) throw new HttpError(404, 'Media not found.');
  await removeImages([m]);
  res.json(await detail(id));
}));

// ---------- Retire / restore / delete ----------
// body: { redirectTo?: '/locations/makati' }  Retired profiles leave the site; their URL shows a "no longer available" page or redirects.
router.post('/:id/retire', wrap(async (req, res) => {
  const id = idParam(req);
  const p = await detail(id);
  const to = String(req.body.redirectTo || '').trim();
  if (to && !/^\/[\w\-/]*$/.test(to)) throw new HttpError(422, 'Enter a site path such as /locations/makati.', { redirectTo: 'Start with /' });
  await tx(async (db) => {
    await db.run("UPDATE profiles SET status = 'Retired', retired_at = now(), is_featured = FALSE, updated_at = now() WHERE id = $1", [id]);
    await db.run('DELETE FROM collection_profiles WHERE profile_id = $1', [id]);
    if (to) {
      await db.run(`INSERT INTO redirects (from_path, to_path, note) VALUES ($1, $2, 'Retired profile')
        ON CONFLICT (from_path) DO UPDATE SET to_path = EXCLUDED.to_path, is_active = TRUE, updated_at = now()`, [`/companions/${p.slug}`, to]);
    }
  });
  res.json(await detail(id));
}));

router.post('/:id/restore', wrap(async (req, res) => {
  const id = idParam(req);
  const p = await detail(id);
  if (p.status !== 'Retired') throw new HttpError(409, 'This profile isn’t retired.');
  await run("UPDATE profiles SET status = 'Hidden', retired_at = NULL, updated_at = now() WHERE id = $1", [id]);
  await run('DELETE FROM redirects WHERE from_path = $1', [`/companions/${p.slug}`]);
  res.json(await detail(id));
}));

router.delete('/:id', wrap(async (req, res) => {
  const id = idParam(req);
  const p = await detail(id);
  if (p.stats.total) throw new HttpError(409, 'This profile has bookings. Retire it instead so the history is kept.');
  await run('DELETE FROM profiles WHERE id = $1', [id]);
  await removeImages(p.media);
  req.auditHandled = true;
  await logEvent({ action: 'Deleted', module: 'profiles', entityType: 'Profile', entityId: id, entityLabel: p.displayName, summary: `Deleted profile “${p.displayName}”` }, req);
  res.status(204).end();
}));

export default router;
