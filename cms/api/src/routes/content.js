// CMS: content pages (About, Terms, Privacy…), posts (guides, announcements, member news) and FAQs.
import { Router } from 'express';
import { one, q, run } from '../db/index.js';
import { HttpError, idParam, wrap } from '../lib/http.js';
import { getRow, insertRow, reorder, slugify, updateRow, validate } from '../lib/validate.js';
import { removeImages, saveImage, imageUpload } from '../lib/storage.js';

const router = Router();
const upload = imageUpload(1);

// Sections: [{ type: 'text', heading, body } | { type: 'list', heading, items[] } | { type: 'table', heading, columns[], rows[][] }
//            | { type: 'stats', items: [{ value, label }] } | { type: 'callout', heading, body }]
export const SECTION_TYPES = ['text', 'list', 'table', 'stats', 'callout'];
export function validateSections(v) {
  if (!Array.isArray(v)) return 'Sections must be a list.';
  if (v.length > 40) return 'Up to 40 sections per page.';
  for (const [i, s] of v.entries()) {
    const n = `Section ${i + 1}`;
    if (!s || !SECTION_TYPES.includes(s.type)) return `${n}: unknown section type.`;
    if (s.heading && String(s.heading).length > 150) return `${n}: heading is too long.`;
    if ((s.type === 'text' || s.type === 'callout') && !String(s.body || '').trim()) return `${n}: add some text.`;
    if (s.type === 'list' && (!Array.isArray(s.items) || !s.items.some((x) => String(x).trim()))) return `${n}: add at least one bullet.`;
    if (s.type === 'table' && (!Array.isArray(s.columns) || !s.columns.length || !Array.isArray(s.rows))) return `${n}: a table needs columns and rows.`;
    if (s.type === 'stats' && (!Array.isArray(s.items) || !s.items.length)) return `${n}: add at least one figure.`;
  }
  return null;
}

const SLUG = { type: 'string', max: 140, pattern: /^[a-z0-9-]+$/, patternMessage: 'Use lowercase letters, numbers and dashes.' };
const SEO = { seoTitle: { type: 'string', max: 70 }, metaDescription: { type: 'string', max: 170 } };
const parse = (p) => ({ ...p, sections: JSON.parse(p.sections || '[]') });

// ---------- Pages ----------
const pageSchema = {
  title: { type: 'string', required: true, max: 150, label: 'Title' },
  slug: { ...SLUG, max: 100 },
  kicker: { type: 'string', max: 60 },
  intro: { type: 'string', max: 600 },
  sections: { type: 'json', required: true, validate: validateSections, label: 'Sections' },
  ...SEO,
  showInFooter: { type: 'bool', default: true },
  isPublished: { type: 'bool', default: true },
};

const listPages = () => q('SELECT id, slug, title, kicker, show_in_footer, is_published, sort_order, updated_at, sections, seo_title, meta_description FROM content_pages ORDER BY sort_order, title');

router.get('/pages', wrap(async (_req, res) => res.json((await listPages()).map((p) => ({ ...p, sectionCount: JSON.parse(p.sections || '[]').length, sections: undefined })))));
router.put('/pages', wrap(async (req, res) => {
  await reorder('content_pages', req.body.order);
  res.status(204).end();
}));
router.get('/pages/:id', wrap(async (req, res) => res.json(parse(await getRow('content_pages', idParam(req), 'Page')))));
router.post('/pages', wrap(async (req, res) => {
  const data = validate(req.body, pageSchema);
  data.slug ||= slugify(data.title);
  const { n } = await one('SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM content_pages');
  const id = await insertRow('content_pages', pageSchema, data, { sort_order: n });
  res.status(201).json(parse(await getRow('content_pages', id)));
}));
router.put('/pages/:id', wrap(async (req, res) => {
  const id = idParam(req);
  const before = await getRow('content_pages', id, 'Page');
  const data = validate(req.body, pageSchema);
  data.slug ||= slugify(data.title);
  await updateRow('content_pages', pageSchema, id, data);
  if (before.slug !== data.slug && before.isPublished) {
    await run(`INSERT INTO redirects (from_path, to_path, note) VALUES ($1, $2, 'Page URL changed')
      ON CONFLICT (from_path) DO UPDATE SET to_path = EXCLUDED.to_path, is_active = TRUE, updated_at = now()`, [`/pages/${before.slug}`, `/pages/${data.slug}`]);
  }
  res.json(parse(await getRow('content_pages', id)));
}));
router.patch('/pages/:id', wrap(async (req, res) => {
  const id = idParam(req);
  await updateRow('content_pages', pageSchema, id, validate(req.body, { isPublished: pageSchema.isPublished, showInFooter: pageSchema.showInFooter }, { partial: true }));
  res.json(parse(await getRow('content_pages', id)));
}));
router.delete('/pages/:id', wrap(async (req, res) => {
  await run('DELETE FROM content_pages WHERE id = $1', [idParam(req)]);
  res.status(204).end();
}));

// ---------- Posts ----------
const postSchema = {
  title: { type: 'string', required: true, max: 150, label: 'Title' },
  slug: SLUG,
  kind: { type: 'enum', values: ['Guide', 'Announcement', 'News'], default: 'Guide' },
  excerpt: { type: 'string', max: 400 },
  sections: { type: 'json', required: true, validate: validateSections, label: 'Sections' },
  coverAlt: { type: 'string', max: 200 },
  audience: { type: 'enum', values: ['Public', 'Members'], default: 'Public' },
  minTierId: { type: 'int', min: 1 },
  locationId: { type: 'int', min: 1 },
  isPinned: { type: 'bool' },
  isPublished: { type: 'bool' },
  ...SEO,
};

const listPosts = () => q(`SELECT ps.id, ps.slug, ps.kind, ps.title, ps.excerpt, ps.audience, ps.is_pinned, ps.is_published, ps.published_at, ps.updated_at, ps.cover_url,
    ps.meta_description, t.name AS tier_name, l.name AS location_name
  FROM posts ps LEFT JOIN tiers t ON t.id = ps.min_tier_id LEFT JOIN locations l ON l.id = ps.location_id ORDER BY ps.is_pinned DESC, COALESCE(ps.published_at, ps.created_at) DESC`);

router.get('/posts', wrap(async (_req, res) => res.json(await listPosts())));
router.get('/posts/:id', wrap(async (req, res) => res.json(parse(await getRow('posts', idParam(req), 'Post')))));
router.post('/posts', wrap(async (req, res) => {
  const data = validate(req.body, postSchema);
  data.slug ||= slugify(data.title);
  if (data.audience === 'Public') data.minTierId = null;
  const id = await insertRow('posts', postSchema, data, data.isPublished ? { published_at: new Date() } : {});
  res.status(201).json(parse(await getRow('posts', id)));
}));
router.put('/posts/:id', wrap(async (req, res) => {
  const id = idParam(req);
  const before = await getRow('posts', id, 'Post');
  const data = validate(req.body, postSchema);
  data.slug ||= slugify(data.title);
  if (data.audience === 'Public') data.minTierId = null;
  await updateRow('posts', postSchema, id, data, { extra: data.isPublished && !before.publishedAt ? { published_at: new Date() } : {} });
  if (before.slug !== data.slug && before.isPublished) {
    await run(`INSERT INTO redirects (from_path, to_path, note) VALUES ($1, $2, 'Article URL changed')
      ON CONFLICT (from_path) DO UPDATE SET to_path = EXCLUDED.to_path, is_active = TRUE, updated_at = now()`, [`/guides/${before.slug}`, `/guides/${data.slug}`]);
  }
  res.json(parse(await getRow('posts', id)));
}));
router.patch('/posts/:id', wrap(async (req, res) => {
  const id = idParam(req);
  const data = validate(req.body, { isPublished: postSchema.isPublished, isPinned: postSchema.isPinned }, { partial: true });
  await updateRow('posts', postSchema, id, data, { extra: data.isPublished ? { published_at: (await getRow('posts', id)).publishedAt || new Date() } : {} });
  res.json(await listPosts());
}));
router.post('/posts/:id/cover', upload.single('image'), wrap(async (req, res) => {
  const p = await getRow('posts', idParam(req), 'Post');
  if (!req.file) throw new HttpError(422, 'Choose an image.');
  const saved = await saveImage(req.file.buffer, 'posts');
  await run('UPDATE posts SET cover_url = $1, cover_file = $2, cover_alt = COALESCE(cover_alt, $3), updated_at = now() WHERE id = $4', [saved.url, saved.fileName, p.title, p.id]);
  await removeImages([{ url: p.coverUrl, fileName: p.coverFile }]);
  res.json(parse(await getRow('posts', p.id)));
}));
router.delete('/posts/:id/cover', wrap(async (req, res) => {
  const p = await getRow('posts', idParam(req), 'Post');
  await run('UPDATE posts SET cover_url = NULL, cover_file = NULL, updated_at = now() WHERE id = $1', [p.id]);
  await removeImages([{ url: p.coverUrl, fileName: p.coverFile }]);
  res.json(parse(await getRow('posts', p.id)));
}));
router.delete('/posts/:id', wrap(async (req, res) => {
  const p = await getRow('posts', idParam(req), 'Post');
  await run('DELETE FROM posts WHERE id = $1', [p.id]);
  await removeImages([{ url: p.coverUrl, fileName: p.coverFile }]);
  res.status(204).end();
}));

// ---------- FAQs ----------
const faqSchema = {
  groupName: { type: 'string', required: true, max: 80, label: 'Group' },
  question: { type: 'string', required: true, max: 300, label: 'Question' },
  answer: { type: 'string', required: true, max: 4000, label: 'Answer' },
  showOnHome: { type: 'bool' },
  isPublished: { type: 'bool', default: true },
};
const listFaqs = () => q('SELECT * FROM faqs ORDER BY sort_order, id');

router.get('/faqs', wrap(async (_req, res) => res.json(await listFaqs())));
router.put('/faqs', wrap(async (req, res) => {
  await reorder('faqs', req.body.order);
  res.json(await listFaqs());
}));
router.post('/faqs', wrap(async (req, res) => {
  const { n } = await one('SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM faqs');
  const id = await insertRow('faqs', faqSchema, validate(req.body, faqSchema), { sort_order: n });
  res.status(201).json({ id, faqs: await listFaqs() });
}));
router.put('/faqs/:id', wrap(async (req, res) => {
  await updateRow('faqs', faqSchema, idParam(req), validate(req.body, faqSchema));
  res.json(await listFaqs());
}));
router.patch('/faqs/:id', wrap(async (req, res) => {
  await updateRow('faqs', faqSchema, idParam(req), validate(req.body, { isPublished: faqSchema.isPublished, showOnHome: faqSchema.showOnHome }, { partial: true }));
  res.json(await listFaqs());
}));
router.delete('/faqs/:id', wrap(async (req, res) => {
  const n = await run('DELETE FROM faqs WHERE id = $1', [idParam(req)]);
  if (!n) throw new HttpError(404, 'FAQ not found.');
  res.status(204).end();
}));

export default router;
