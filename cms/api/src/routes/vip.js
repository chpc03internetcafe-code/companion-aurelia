// CMS: VIP membership tiers and curated profile collections.
import { Router } from 'express';
import { one, q, run, tx } from '../db/index.js';
import { HttpError, idParam, wrap } from '../lib/http.js';
import { getRow, insertRow, reorder, slugify, updateRow, validate } from '../lib/validate.js';

const router = Router();
const SLUG = { type: 'string', max: 80, pattern: /^[a-z0-9-]+$/, patternMessage: 'Use lowercase letters, numbers and dashes.' };

// ---------- Tiers ----------
const tierSchema = {
  name: { type: 'string', required: true, max: 60, label: 'Name' },
  slug: SLUG,
  rank: { type: 'int', required: true, min: 1, max: 20, message: 'Enter a level from 1 to 20.' },
  description: { type: 'string', max: 500 },
  price: { type: 'decimal', required: true, min: 0, label: 'Price' },
  durationDays: { type: 'int', required: true, min: 1, max: 3660, label: 'Duration' },
  perks: { type: 'json', default: '[]', validate: (v) => (!Array.isArray(v) || v.length > 12 || v.some((x) => typeof x !== 'string' || x.length > 120) ? 'Up to 12 perks, 120 characters each.' : null) },
  color: { type: 'string', max: 7, pattern: /^#[0-9a-fA-F]{6}$/, patternMessage: 'Use a colour like #d4af6a.' },
  isPublic: { type: 'bool', default: true },
  isActive: { type: 'bool', default: true },
};

const listTiers = async () => (await q(`SELECT t.*,
    (SELECT COUNT(*)::int FROM members m WHERE m.tier_id = t.id AND m.membership_expires_on >= ph_today()) AS active_members,
    (SELECT COUNT(*)::int FROM profiles p WHERE p.vip_tier_id = t.id AND p.status = 'Published') AS vip_profiles
  FROM tiers t ORDER BY t.rank, t.sort_order`)).map((t) => ({ ...t, perks: JSON.parse(t.perks || '[]') }));

router.get('/tiers', wrap(async (_req, res) => res.json(await listTiers())));
router.put('/tiers', wrap(async (req, res) => {
  await reorder('tiers', req.body.order);
  res.json(await listTiers());
}));
router.post('/tiers', wrap(async (req, res) => {
  const data = validate(req.body, tierSchema);
  data.slug ||= slugify(data.name);
  const { n } = await one('SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM tiers');
  const id = await insertRow('tiers', tierSchema, data, { sort_order: n });
  res.status(201).json({ id, tiers: await listTiers() });
}));
router.put('/tiers/:id', wrap(async (req, res) => {
  const data = validate(req.body, tierSchema);
  data.slug ||= slugify(data.name);
  await updateRow('tiers', tierSchema, idParam(req), data);
  res.json(await listTiers());
}));
router.delete('/tiers/:id', wrap(async (req, res) => {
  const id = idParam(req);
  const used = await one('SELECT (SELECT COUNT(*) FROM memberships WHERE tier_id = $1)::int + (SELECT COUNT(*) FROM members WHERE tier_id = $1)::int AS n', [id]);
  if (used.n) throw new HttpError(409, 'Members have used this tier. Deactivate it instead.');
  await run('DELETE FROM tiers WHERE id = $1', [id]);
  res.status(204).end();
}));

// ---------- Collections ----------
const collectionSchema = {
  title: { type: 'string', required: true, max: 120, label: 'Title' },
  slug: { ...SLUG, max: 140 },
  description: { type: 'string', max: 600 },
  minTierId: { type: 'int', min: 1 },
  isPublished: { type: 'bool', default: true },
};

const listCollections = () => q(`SELECT c.*, t.name AS tier_name,
    (SELECT COUNT(*)::int FROM collection_profiles cp WHERE cp.collection_id = c.id) AS profile_count
  FROM collections c LEFT JOIN tiers t ON t.id = c.min_tier_id ORDER BY c.sort_order, c.title`);

async function collection(id) {
  const c = await getRow('collections', id, 'Collection');
  c.profiles = await q(`SELECT p.id, p.display_name, p.slug, p.status, cp.sort_order,
      (SELECT url FROM profile_media m WHERE m.profile_id = p.id AND m.kind = 'photo' ORDER BY m.is_primary DESC, m.sort_order LIMIT 1) AS photo_url
    FROM collection_profiles cp JOIN profiles p ON p.id = cp.profile_id WHERE cp.collection_id = $1 ORDER BY cp.sort_order`, [id]);
  return c;
}

router.get('/collections', wrap(async (_req, res) => res.json(await listCollections())));
router.put('/collections', wrap(async (req, res) => {
  await reorder('collections', req.body.order);
  res.json(await listCollections());
}));
router.get('/collections/:id', wrap(async (req, res) => res.json(await collection(idParam(req)))));
router.post('/collections', wrap(async (req, res) => {
  const data = validate(req.body, collectionSchema);
  data.slug ||= slugify(data.title);
  const { n } = await one('SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM collections');
  const id = await insertRow('collections', collectionSchema, data, { sort_order: n });
  res.status(201).json(await collection(id));
}));
router.put('/collections/:id', wrap(async (req, res) => {
  const id = idParam(req);
  const data = validate(req.body, collectionSchema);
  data.slug ||= slugify(data.title);
  await updateRow('collections', collectionSchema, id, data);
  res.json(await collection(id));
}));
// body: { profileIds: [3, 1, 7] } in display order
router.put('/collections/:id/profiles', wrap(async (req, res) => {
  const id = idParam(req);
  await getRow('collections', id, 'Collection');
  const ids = [...new Set((Array.isArray(req.body.profileIds) ? req.body.profileIds : []).map(Number).filter(Number.isInteger))].slice(0, 100);
  await tx(async (db) => {
    await db.run('DELETE FROM collection_profiles WHERE collection_id = $1', [id]);
    for (const [i, pid] of ids.entries()) {
      await db.run("INSERT INTO collection_profiles (collection_id, profile_id, sort_order) SELECT $1, id, $3 FROM profiles WHERE id = $2 AND status <> 'Retired'", [id, pid, i]);
    }
    await db.run('UPDATE collections SET updated_at = now() WHERE id = $1', [id]);
  });
  res.json(await collection(id));
}));
router.delete('/collections/:id', wrap(async (req, res) => {
  await run('DELETE FROM collections WHERE id = $1', [idParam(req)]);
  res.status(204).end();
}));

export default router;
