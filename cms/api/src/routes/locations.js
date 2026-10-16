// CMS: locations (cities and their service areas, each with a landing page) and profile categories.
import { Router } from 'express';
import multer from 'multer';
import { one, q, run } from '../db/index.js';
import { HttpError, idParam, wrap } from '../lib/http.js';
import { getRow, insertRow, reorder, slugify, updateRow, validate } from '../lib/validate.js';
import { removeImages, saveImage } from '../lib/storage.js';
import { validateSections } from './content.js';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 4 * 1024 * 1024, files: 1 } });
const SLUG = { type: 'string', max: 120, pattern: /^[a-z0-9-]+$/, patternMessage: 'Use lowercase letters, numbers and dashes.' };

const locationSchema = {
  name: { type: 'string', required: true, max: 100, label: 'Name' },
  slug: SLUG,
  parentId: { type: 'int', min: 1 },
  region: { type: 'string', max: 100 },
  intro: { type: 'string', max: 600 },
  sections: { type: 'json', validate: validateSections, default: '[]' },
  imageAlt: { type: 'string', max: 200 },
  seoTitle: { type: 'string', max: 70 },
  metaDescription: { type: 'string', max: 170 },
  isPopular: { type: 'bool' },
  isPublished: { type: 'bool', default: true },
};

const listLocations = () => q(`SELECT l.id, l.parent_id, l.name, l.slug, l.region, l.is_popular, l.is_published, l.sort_order, l.image_url, l.seo_title, l.meta_description, l.updated_at,
    pl.name AS parent_name,
    (SELECT COUNT(*)::int FROM profiles p WHERE p.base_location_id = l.id AND p.status <> 'Retired') AS base_count,
    (SELECT COUNT(*)::int FROM profile_areas a JOIN profiles p ON p.id = a.profile_id WHERE a.location_id = l.id AND p.status <> 'Retired') AS area_count
  FROM locations l LEFT JOIN locations pl ON pl.id = l.parent_id
  ORDER BY COALESCE(pl.sort_order, l.sort_order), COALESCE(pl.name, l.name), l.parent_id NULLS FIRST, l.sort_order, l.name`);

// ---------- Categories (defined before /:id so /categories isn't read as a location id) ----------
const categorySchema = {
  name: { type: 'string', required: true, max: 60, label: 'Name' },
  slug: { ...SLUG, max: 80 },
  description: { type: 'string', max: 300 },
  intro: { type: 'string', max: 1000 },
  seoTitle: { type: 'string', max: 70 },
  metaDescription: { type: 'string', max: 170 },
  isActive: { type: 'bool', default: true },
};
// Category pages live at /<slug>; these paths belong to other pages.
const RESERVED = ['companions', 'locations', 'guides', 'faq', 'vip', 'contact', 'account', 'favorites', 'book', 'booking-status', 'pages', 'api', 'uploads', 'sitemap-xml'];
const checkSlug = (slug) => {
  if (RESERVED.includes(slug)) throw new HttpError(422, `“${slug}” is used by another page. Choose another URL.`, { slug: 'Reserved.' });
};
const listCategories = () => q(`SELECT c.*, (SELECT COUNT(*)::int FROM profiles p WHERE p.category_id = c.id AND p.status <> 'Retired') AS profile_count FROM categories c ORDER BY c.sort_order, c.name`);

router.get('/categories', wrap(async (_req, res) => res.json(await listCategories())));
router.put('/categories', wrap(async (req, res) => {
  await reorder('categories', req.body.order);
  res.json(await listCategories());
}));
router.post('/categories', wrap(async (req, res) => {
  const data = validate(req.body, categorySchema);
  data.slug ||= slugify(data.name);
  checkSlug(data.slug);
  const { n } = await one('SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM categories');
  const id = await insertRow('categories', categorySchema, data, { sort_order: n });
  res.status(201).json({ id, categories: await listCategories() });
}));
router.put('/categories/:id', wrap(async (req, res) => {
  const data = validate(req.body, categorySchema);
  data.slug ||= slugify(data.name);
  checkSlug(data.slug);
  await updateRow('categories', categorySchema, idParam(req), data);
  res.json(await listCategories());
}));
router.delete('/categories/:id', wrap(async (req, res) => {
  const id = idParam(req);
  if ((await one('SELECT COUNT(*)::int AS n FROM profiles WHERE category_id = $1', [id])).n) throw new HttpError(409, 'This category has profiles. Hide it instead.');
  await run('DELETE FROM categories WHERE id = $1', [id]);
  res.status(204).end();
}));

// ---------- Locations ----------
const parse = (l) => ({ ...l, sections: JSON.parse(l.sections || '[]') });

router.get('/', wrap(async (_req, res) => res.json(await listLocations())));
router.put('/', wrap(async (req, res) => {
  await reorder('locations', req.body.order);
  res.json(await listLocations());
}));
router.get('/:id', wrap(async (req, res) => res.json(parse(await getRow('locations', idParam(req), 'Location')))));

async function checkParent(id, parentId) {
  if (!parentId) return;
  const parent = await one('SELECT id, parent_id FROM locations WHERE id = $1', [parentId]);
  if (!parent) throw new HttpError(422, 'Choose a city.', { parentId: 'Choose a city.' });
  if (parent.parentId) throw new HttpError(422, 'Areas can only be inside a city, not inside another area.', { parentId: 'Choose a city, not an area.' });
  if (id && parentId === id) throw new HttpError(422, 'A location can’t be inside itself.', { parentId: 'Invalid.' });
  if (id && (await one('SELECT 1 AS x FROM locations WHERE parent_id = $1', [id]))) throw new HttpError(422, 'This city has areas, so it can’t become an area itself.', { parentId: 'Has areas.' });
}

router.post('/', wrap(async (req, res) => {
  const data = validate(req.body, locationSchema);
  await checkParent(null, data.parentId);
  data.slug ||= slugify(data.name);
  const { n } = await one('SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM locations');
  const id = await insertRow('locations', locationSchema, data, { sort_order: n });
  res.status(201).json(parse(await getRow('locations', id)));
}));

router.put('/:id', wrap(async (req, res) => {
  const id = idParam(req);
  const before = await getRow('locations', id, 'Location');
  const data = validate(req.body, locationSchema);
  await checkParent(id, data.parentId);
  data.slug ||= slugify(data.name);
  await updateRow('locations', locationSchema, id, data);
  if (before.slug !== data.slug && before.isPublished) {
    await run(`INSERT INTO redirects (from_path, to_path, note) VALUES ($1, $2, 'Location URL changed')
      ON CONFLICT (from_path) DO UPDATE SET to_path = EXCLUDED.to_path, is_active = TRUE, updated_at = now()`, [`/locations/${before.slug}`, `/locations/${data.slug}`]);
  }
  res.json(parse(await getRow('locations', id)));
}));

router.patch('/:id', wrap(async (req, res) => {
  const id = idParam(req);
  await updateRow('locations', locationSchema, id, validate(req.body, { isPublished: locationSchema.isPublished, isPopular: locationSchema.isPopular }, { partial: true }));
  res.json(await listLocations());
}));

router.post('/:id/image', upload.single('image'), wrap(async (req, res) => {
  const l = await getRow('locations', idParam(req), 'Location');
  if (!req.file) throw new HttpError(422, 'Choose an image.');
  const saved = await saveImage(req.file.buffer, 'locations');
  await run('UPDATE locations SET image_url = $1, image_file = $2, image_alt = COALESCE(image_alt, $3), updated_at = now() WHERE id = $4', [saved.url, saved.fileName, l.name, l.id]);
  await removeImages([{ url: l.imageUrl, fileName: l.imageFile }]);
  res.json(parse(await getRow('locations', l.id)));
}));

router.delete('/:id/image', wrap(async (req, res) => {
  const l = await getRow('locations', idParam(req), 'Location');
  await run('UPDATE locations SET image_url = NULL, image_file = NULL, updated_at = now() WHERE id = $1', [l.id]);
  await removeImages([{ url: l.imageUrl, fileName: l.imageFile }]);
  res.json(parse(await getRow('locations', l.id)));
}));

// Locations with profiles, bookings or areas can be unpublished but not deleted.
router.delete('/:id', wrap(async (req, res) => {
  const id = idParam(req);
  const l = await getRow('locations', id, 'Location');
  const used = await one(`SELECT (SELECT COUNT(*) FROM profiles WHERE base_location_id = $1)::int + (SELECT COUNT(*) FROM bookings WHERE location_id = $1)::int
    + (SELECT COUNT(*) FROM locations WHERE parent_id = $1)::int AS n`, [id]);
  if (used.n) throw new HttpError(409, 'This location has profiles, bookings or areas. Unpublish it instead.');
  await run('DELETE FROM locations WHERE id = $1', [id]);
  await removeImages([{ url: l.imageUrl, fileName: l.imageFile }]);
  res.status(204).end();
}));

export default router;
