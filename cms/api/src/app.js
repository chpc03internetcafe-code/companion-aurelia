// The Express app. Started locally by server.js and on Vercel by /api/index.js at the repo root.
import './env.js';
import express from 'express';
import cors from 'cors';
import compression from 'compression';
import multer from 'multer';
import { dbKind, q } from './db/index.js';
import { HttpError, wrap } from './lib/http.js';
import { requireAdmin, requirePermission } from './lib/admin-auth.js';
import { auditWrites } from './lib/audit.js';
import { UPLOAD_DIR } from './lib/storage.js';
import { mailConfigured } from './lib/mailer.js';
import { cached, clearCacheOnWrite } from './lib/cache.js';
import { blockCrossSite, checkProductionConfig, corsOptions, isProduction, LONG_POLL_PATHS, loggableError, requestLimit, safeJsonReviver, securityHeaders, trustProxySetting } from './lib/security.js';
import { idleMinutes, loadSettings } from './services/settings.js';
import { BOOKING_SOURCES, BOOKING_STATUSES, CONTACT_METHODS, INQUIRY_STATUSES as PROFILE_INQUIRY_STATUSES } from './services/bookings.js';
import { SORTS } from './services/profiles.js';
import adminRoutes from './routes/admin.js';
import auditRoutes from './routes/audit.js';
import dashboardRoutes from './routes/dashboard.js';
import bookingRoutes from './routes/bookings.js';
import profileRoutes, { PROFILE_STATUSES } from './routes/profiles.js';
import locationRoutes from './routes/locations.js';
import contentRoutes, { SECTION_TYPES } from './routes/content.js';
import seoRoutes from './routes/seo.js';
import inquiryRoutes, { INQUIRY_STATUSES, INQUIRY_SUBJECTS } from './routes/inquiries.js';
import settingsRoutes from './routes/settings.js';
import notificationRoutes from './routes/notifications.js';
import siteRoutes from './routes/site.js';
import liveChatSiteRoutes from './routes/live-chat-site.js';
import liveChatRoutes from './routes/live-chat.js';

const app = express();
checkProductionConfig();
app.disable('x-powered-by');
app.set('trust proxy', trustProxySetting());
app.use(securityHeaders);
app.use(cors(corsOptions));
app.use(requestLimit);
// gzip / brotli for JSON, XML and text over 1 KB. The live-notification long poll is left alone so it answers immediately.
app.use(compression({ threshold: 1024, filter: (req, res) => !LONG_POLL_PATHS.has(req.path) && compression.filter(req, res) }));
app.use(express.json({
  limit: '1mb',
  reviver: safeJsonReviver,
  // webhook signatures are computed over the exact bytes received, so keep them for those routes
  verify: (req, _res, buf) => { if (req.originalUrl.startsWith('/api/webhooks/')) req.rawBody = buf; },
}));
app.use('/api', blockCrossSite);
app.use(clearCacheOnWrite);
// Upload file names are unique and never reused, so browsers and the CDN can keep them for a year.
app.use('/uploads', express.static(UPLOAD_DIR, { maxAge: '365d', immutable: true }));

app.get('/api/health', async (_req, res) => {
  try {
    await q('SELECT 1');
    res.json({ ok: true, database: await dbKind(), email: mailConfigured() });
  } catch (err) {
    console.error('[health]', loggableError(err));
    res.status(503).json({ ok: false, error: isProduction() ? 'Database unavailable.' : err.message });
  }
});

// Shared option lists for the CMS forms.
app.get('/api/meta', requireAdmin, wrap(async (_req, res) => res.json(await cached('meta', 60_000, meta))));

async function meta() {
  const [categories, locations, s] = await Promise.all([
    q('SELECT id, name, slug, is_active FROM categories ORDER BY sort_order, name'),
    q(`SELECT l.id, l.name, l.slug, l.parent_id, l.is_published, pl.name AS parent_name FROM locations l LEFT JOIN locations pl ON pl.id = l.parent_id
       ORDER BY COALESCE(pl.sort_order, l.sort_order), COALESCE(pl.name, l.name), l.parent_id NULLS FIRST, l.name`),
    loadSettings(),
  ]);
  return {
    site: { siteName: s.siteName, logoText: s.logoText, currency: s.currency || 'PHP', slotMinutes: Number(s.slotMinutes) || 30, idleMinutes: idleMinutes(s).staff },
    categories, locations,
    bookingStatuses: BOOKING_STATUSES, profileInquiryStatuses: PROFILE_INQUIRY_STATUSES, bookingSources: BOOKING_SOURCES, contactMethods: CONTACT_METHODS,
    profileStatuses: PROFILE_STATUSES,
    inquiryStatuses: INQUIRY_STATUSES, inquirySubjects: INQUIRY_SUBJECTS, sectionTypes: SECTION_TYPES, sorts: SORTS,
    websiteUrl: process.env.SITE_URL || 'http://localhost:5173',
  };
}

// Public: website
app.use('/api/site/chat', liveChatSiteRoutes);
app.use('/api/site', siteRoutes);

// CMS: staff sign-in + role permission per section (View for GET, Manage for changes) + audit trail
app.use('/api/admin', auditWrites('users'), adminRoutes); // sign-in events are logged in the route
app.use('/api/dashboard', requireAdmin, dashboardRoutes);
app.use('/api/bookings', requirePermission('bookings'), auditWrites('bookings'), bookingRoutes);
app.use('/api/profiles', requirePermission('profiles'), auditWrites('profiles'), profileRoutes);
app.use('/api/locations', requirePermission('locations'), auditWrites('locations'), locationRoutes);
app.use('/api/content', requirePermission('content'), auditWrites('content'), contentRoutes);
app.use('/api/seo', requirePermission('seo'), auditWrites('seo'), seoRoutes);
app.use('/api/inquiries', requirePermission('inquiries'), auditWrites('inquiries'), inquiryRoutes);
app.use('/api/settings', requirePermission('settings'), auditWrites('settings'), settingsRoutes);
app.use('/api/notifications', requireAdmin, notificationRoutes);
app.use('/api/live-chat', requirePermission('inquiries'), liveChatRoutes); // logs its own audit entries (never the message text)
app.use('/api/audit', requirePermission('audit'), auditRoutes);

app.use('/api', (_req, _res, next) => next(new HttpError(404, 'Not found.')));

// Postgres error codes → friendly API errors.
// constraint names are uq_<table>_<column>; a longer table name is listed before any name it starts with
const UNIQUE_TABLES = ['admin_sessions', 'content_pages', 'admin_roles', 'admin_users', 'live_chats', 'categories', 'locations', 'redirects', 'inquiries', 'profiles', 'bookings', 'posts'];
const FIELD_LABELS = { email: 'email', slug: 'URL slug', name: 'name', from_path: '“From” path', reference: 'reference' };
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, _next) => {
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'Each image must be 4 MB or smaller.' : err.code === 'LIMIT_FILE_COUNT' ? 'Too many files at once.' : err.message });
  }
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Request body is not valid JSON.' });
  if (err.code === '23505') {
    const rest = String(err.constraint || '').replace(/^uq_/, '');
    const table = UNIQUE_TABLES.find((t) => rest.startsWith(`${t}_`));
    const col = table ? rest.slice(table.length + 1) : 'value';
    const key = col.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
    const label = FIELD_LABELS[col] || col.replace(/_/g, ' ');
    return res.status(409).json({ error: `This ${label} is already in use.`, details: { [key]: `This ${label} is already in use.` } });
  }
  if (err.code === '23503') {
    if (/delete|update/i.test(err.message) && /still referenced/i.test(err.detail || '')) return res.status(409).json({ error: 'This record is still in use and can’t be deleted.' });
    return res.status(422).json({ error: 'A selected reference (profile, location…) is not valid.' });
  }
  if (err.code === '23514') return res.status(422).json({ error: 'Some values are out of range. Please check the form.' });
  if (err.code === '22P02' || err.code === '22007' || err.code === '22008') return res.status(400).json({ error: 'Some values are in the wrong format.' });
  const status = err.status || 500;
  if (status >= 500) console.error(`[api] ${req.method} ${req.path}`, loggableError(err));
  // never send internal error text (SQL, stack traces, file paths) to the browser
  res.status(status).json({ error: status >= 500 ? (isProduction() ? 'Something went wrong. Please try again.' : 'Server error. Check the API logs.') : err.message, details: err.details });
});

export default app;
