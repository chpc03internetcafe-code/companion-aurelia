// CMS: SEO settings, redirects and an SEO health check (missing titles / descriptions / alt text).
import { Router } from 'express';
import { one, q, run } from '../db/index.js';
import { HttpError, idParam, wrap } from '../lib/http.js';
import { getRow, insertRow, updateRow, validate } from '../lib/validate.js';
import { loadSettings } from '../services/settings.js';

const router = Router();
const PATH = { type: 'string', required: true, max: 300, pattern: /^\/[^\s?#]*$/, patternMessage: 'Enter a site path starting with /, e.g. /old-page' };

// ---------- Settings ----------
const seoSchema = {
  seoTitleSuffix: { type: 'string', max: 60 },
  seoDefaultDescription: { type: 'string', max: 170 },
  seoOgImage: { type: 'string', max: 400, pattern: /^https?:\/\/\S+$|^\/\S+$/, patternMessage: 'Enter an image link.' },
  structuredData: { type: 'enum', values: ['0', '1'] },
  searchIndexing: { type: 'enum', values: ['0', '1'] },
};
const seoSettings = async () => {
  const s = await loadSettings();
  return Object.fromEntries(Object.keys(seoSchema).map((k) => [k, s[k]]));
};

router.get('/settings', wrap(async (_req, res) => res.json(await seoSettings())));
router.put('/settings', wrap(async (req, res) => {
  const data = validate(req.body, seoSchema, { partial: true });
  for (const [k, v] of Object.entries(data)) {
    await run('INSERT INTO site_settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()', [k, v ?? '']);
  }
  res.json(await seoSettings());
}));

// ---------- Redirects ----------
const redirectSchema = {
  fromPath: { ...PATH, label: 'From' },
  toPath: { type: 'string', required: true, max: 300, pattern: /^\/[^\s]*$|^https?:\/\/\S+$/, patternMessage: 'Enter a path starting with / or a full https:// link.', label: 'To' },
  statusCode: { type: 'int', required: true, min: 301, max: 302, check: (v) => ([301, 302].includes(v) ? null : 'Choose 301 or 302.') },
  note: { type: 'string', max: 200 },
  isActive: { type: 'bool', default: true },
};
const clean = (p) => (p.length > 1 ? p.replace(/\/+$/, '') : p);
const listRedirects = () => q('SELECT * FROM redirects ORDER BY updated_at DESC');

async function assertNoLoop(fromPath, toPath, id) {
  if (fromPath === toPath) throw new HttpError(422, 'A redirect can’t point to itself.', { toPath: 'Same as “From”.' });
  const next = await one('SELECT to_path FROM redirects WHERE from_path = $1 AND is_active AND ($2::int IS NULL OR id <> $2)', [toPath, id || null]);
  if (next?.toPath === fromPath) throw new HttpError(422, `This would loop: ${toPath} already redirects to ${fromPath}.`, { toPath: 'Creates a loop.' });
}

router.get('/redirects', wrap(async (_req, res) => res.json(await listRedirects())));
router.post('/redirects', wrap(async (req, res) => {
  const data = validate({ statusCode: 301, ...req.body }, redirectSchema);
  data.fromPath = clean(data.fromPath);
  await assertNoLoop(data.fromPath, data.toPath);
  const id = await insertRow('redirects', redirectSchema, data);
  res.status(201).json({ id, redirects: await listRedirects() });
}));
router.put('/redirects/:id', wrap(async (req, res) => {
  const id = idParam(req);
  const data = validate(req.body, redirectSchema);
  data.fromPath = clean(data.fromPath);
  await assertNoLoop(data.fromPath, data.toPath, id);
  await updateRow('redirects', redirectSchema, id, data);
  res.json(await listRedirects());
}));
router.patch('/redirects/:id', wrap(async (req, res) => {
  await updateRow('redirects', redirectSchema, idParam(req), validate(req.body, { isActive: redirectSchema.isActive }, { partial: true }));
  res.json(await listRedirects());
}));
router.delete('/redirects/:id', wrap(async (req, res) => {
  await getRow('redirects', idParam(req), 'Redirect');
  await run('DELETE FROM redirects WHERE id = $1', [idParam(req)]);
  res.status(204).end();
}));

// ---------- Health check ----------
// Published pages without their own title/description, profile photos without alt text, retired profiles without a redirect.
router.get('/health', wrap(async (_req, res) => {
  const [profiles, locations, categories, posts, pages, photos, retired] = await Promise.all([
    q("SELECT id, display_name AS name, slug, (seo_title IS NULL) AS no_title, (meta_description IS NULL) AS no_description FROM profiles WHERE status = 'Published' AND (seo_title IS NULL OR meta_description IS NULL) ORDER BY display_name"),
    q('SELECT id, name, slug, (seo_title IS NULL) AS no_title, (meta_description IS NULL) AS no_description, (intro IS NULL) AS no_intro FROM locations WHERE is_published AND (seo_title IS NULL OR meta_description IS NULL OR intro IS NULL) ORDER BY name'),
    q('SELECT id, name, slug, (seo_title IS NULL) AS no_title, (meta_description IS NULL) AS no_description FROM categories WHERE is_active AND (seo_title IS NULL OR meta_description IS NULL) ORDER BY name'),
    q("SELECT id, title AS name, slug, (meta_description IS NULL AND excerpt IS NULL) AS no_description, (cover_url IS NOT NULL AND cover_alt IS NULL) AS no_alt FROM posts WHERE is_published AND audience = 'Public' AND ((meta_description IS NULL AND excerpt IS NULL) OR (cover_url IS NOT NULL AND cover_alt IS NULL)) ORDER BY title"),
    q('SELECT id, title AS name, slug, (meta_description IS NULL) AS no_description FROM content_pages WHERE is_published AND meta_description IS NULL ORDER BY title'),
    q("SELECT p.id, p.display_name AS name, COUNT(*)::int AS missing FROM profile_media m JOIN profiles p ON p.id = m.profile_id WHERE p.status = 'Published' AND (m.alt_text IS NULL OR m.alt_text = '') GROUP BY p.id, p.display_name ORDER BY p.display_name"),
    q("SELECT p.id, p.display_name AS name, p.slug FROM profiles p WHERE p.status = 'Retired' AND NOT EXISTS (SELECT 1 FROM redirects r WHERE r.from_path = '/companions/' || p.slug AND r.is_active) ORDER BY p.retired_at DESC"),
  ]);
  res.json({ profiles, locations, categories, posts, pages, photos, retired });
}));

export default router;
