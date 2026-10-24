// End-to-end API checks against a freshly seeded database: npm run test:smoke
// Starts the app in-process on a random port (stop the dev server first when using the embedded database).
// Uses the demo data, so run `npm run db:reset` beforehand for a clean slate.
import '../env.js';
import assert from 'node:assert/strict';
import app from '../app.js';
import { closeDb, one, q } from './index.js';
import { addDays, phDate } from '../lib/dates.js';

// Each test client gets a random X-Forwarded-For address, as if behind one trusted proxy, so the per-IP
// limits don't trip during the run.
process.env.TRUST_PROXY = '1';

const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
const base = `http://127.0.0.1:${server.address().port}/api`;
let passed = 0;
const results = [];

function client() {
  let cookie = '';
  return async (method, url, body, extraHeaders = {}) => {
    const form = body instanceof FormData;
    const res = await fetch(base + url, {
      method,
      headers: { ...(body && !form ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}), 'X-Forwarded-For': `10.0.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`, ...extraHeaders },
      body: body ? (form ? body : JSON.stringify(body)) : undefined,
    });
    const set = res.headers.getSetCookie?.() || [];
    for (const c of set) {
      const [pair] = c.split(';');
      const [name] = pair.split('=');
      cookie = [...cookie.split('; ').filter((x) => x && !x.startsWith(`${name}=`)), pair].join('; ');
    }
    const text = await res.text();
    let data;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    return { status: res.status, data };
  };
}

async function check(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.log(`  ✗ ${name}\n      ${err.message}`);
  }
  results.push(name);
}

const guest = client();
const staff = client();
const coordinator = client();
const today = phDate();

let profile;
let rate;
let booking;
let slotDate;
let slotTime;

await check('health + bootstrap', async () => {
  assert.equal((await guest('GET', '/health')).data.ok, true);
  const { data } = await guest('GET', '/site/bootstrap');
  assert.ok(data.categories.length >= 3 && data.locations.length > 5);
  assert.equal(data.tiers, undefined, 'no VIP tiers any more');
  assert.ok(data.theme.vars['--primary']);
});

await check('staff sign-in', async () => {
  const login = await staff('POST', '/admin/auth/login', { email: 'admin@aurelia.example', password: 'aurelia2026' });
  assert.equal(login.status, 200, JSON.stringify(login.data));
});

await check('removed: member accounts, VIP and the companion portal are gone', async () => {
  for (const url of ['/account/session', '/companion/session', '/members', '/vip/tiers', '/companions/changes']) {
    const r = url.startsWith('/account') || url.startsWith('/companion/') ? await guest('GET', url) : await staff('GET', url);
    assert.equal(r.status, 404, `${url}: ${r.status}`);
  }
  const { roles, modules } = (await staff('GET', '/admin/roles')).data;
  const admin = roles.find((r) => r.name === 'Administrator');
  assert.ok(!('members' in admin.permissions) && !('vip' in admin.permissions), JSON.stringify(admin.permissions));
  assert.ok(!modules.some((m) => ['members', 'vip'].includes(m.key ?? m[0])), JSON.stringify(modules));
});

await check('performance: compressed responses and CDN cache headers', async () => {
  const res = await fetch(`${base}/site/bootstrap`, { headers: { 'Accept-Encoding': 'gzip' } });
  assert.equal(res.headers.get('content-encoding'), 'gzip');
  assert.match(res.headers.get('cache-control'), /s-maxage=\d+/);
  assert.match(res.headers.get('vary'), /Accept-Encoding/);
});

await check('home: featured, recent, available-today count', async () => {
  const { data } = await guest('GET', '/site/home');
  assert.ok(data.featured.length > 0 && data.recent.length > 0);
});

await check('directory filters: category, location (incl. areas), budget, duration, verified, sort', async () => {
  const all = (await guest('GET', '/site/profiles')).data;
  const female = (await guest('GET', '/site/profiles?category=female')).data;
  assert.ok(female.total > 0 && female.total < all.total);
  assert.ok(female.items.every((p) => p.category.slug === 'female'));
  const makati = (await guest('GET', '/site/profiles?location=makati')).data;
  assert.ok(makati.total > 0);
  const cheap = (await guest('GET', '/site/profiles?budgetMax=5000')).data;
  assert.ok(cheap.items.every((p) => p.priceFrom <= 5000));
  const dur = (await guest('GET', '/site/profiles?duration=60')).data;
  assert.ok(dur.total > 0);
  const verified = (await guest('GET', '/site/profiles?verified=1')).data;
  assert.ok(verified.items.every((p) => p.verified));
  const asc = (await guest('GET', '/site/profiles?sort=price_asc')).data.items.map((p) => p.priceFrom);
  assert.deepEqual(asc, [...asc].sort((a, b) => a - b));
  const date = (await guest('GET', `/site/profiles?available=${addDays(today, 2)}`)).data;
  assert.ok(date.total >= 0);
});

await check('profile page: hidden photos stay off the website; retired profiles point elsewhere', async () => {
  const { data } = await guest('GET', '/site/profiles/sofia');
  assert.equal(data.name, 'Sofia');
  assert.ok(data.rates.length && data.schedule.length && data.media.length >= 2);
  // staff hide a photo: it's kept in the CMS but no longer sent to the website
  const hide = data.media[1];
  assert.equal((await staff('PATCH', `/profiles/${data.id}/media/${hide.id}`, { isHidden: true })).status, 200);
  const after = (await guest('GET', '/site/profiles/sofia')).data;
  assert.ok(!after.media.some((m) => m.id === hide.id) && after.media.length === data.media.length - 1);
  assert.ok((await staff('GET', `/profiles/${data.id}`)).data.media.find((m) => m.id === hide.id).isHidden);
  await staff('PATCH', `/profiles/${data.id}/media/${hide.id}`, { isHidden: false });
  assert.equal((await guest('GET', '/site/profiles/yuna')).status, 200, 'formerly VIP-only profiles are ordinary profiles');
  const retired = await guest('GET', '/site/profiles/lara');
  assert.equal(retired.status, 410);
  assert.equal(retired.data.redirect, '/locations/makati');
  profile = data;
  rate = data.rates[0];
});

await check('availability days + slots + quote with fees', async () => {
  const days = (await guest('GET', `/site/availability/days?profileId=${profile.id}&rateId=${rate.id}&days=14`)).data;
  const open = days.find((d) => d.slots > 0 && d.date > addDays(today, 1)); // outside the 24-hour change window, whatever the time of day
  assert.ok(open, 'an open day in the next two weeks');
  const slots = (await guest('GET', `/site/availability?profileId=${profile.id}&rateId=${rate.id}&date=${open.date}`)).data;
  assert.ok(slots.slots.length > 0);
  slotDate = open.date;
  slotTime = slots.slots[0];
  const quote = (await guest('POST', '/site/quote', { profileId: profile.id, rateId: rate.id })).data;
  assert.equal(quote.total, quote.ratePrice + quote.feesTotal);
  assert.ok(quote.fees.length >= 1);
});

await check('booking request → reference, status lookup, taken slot rejected', async () => {
  const body = { profileId: profile.id, rateId: rate.id, date: slotDate, time: slotTime, name: 'Smoke Tester', email: 'smoke@example.com', phone: '0917 000 1111', consent: true };
  const r = await guest('POST', '/site/bookings', body);
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.match(r.data.reference, /^BK-/);
  booking = r.data;
  const again = await guest('POST', '/site/bookings', { ...body, email: 'other@example.com' });
  assert.equal(again.status, 409);
  const look = await guest('GET', `/site/bookings/${booking.reference}`, null, { 'X-Booking-Email': 'smoke@example.com' });
  assert.equal(look.data.status, 'Pending');
  assert.ok(look.data.timeline.length >= 1);
  const wrong = await guest('GET', `/site/bookings/${booking.reference}`, null, { 'X-Booking-Email': 'nobody@example.com' });
  assert.equal(wrong.status, 404);
  const noConsent = await guest('POST', '/site/bookings', { ...body, consent: false });
  assert.equal(noConsent.status, 422);
});

await check('client reschedules then cancels online', async () => {
  const days = (await guest('GET', `/site/availability/days?profileId=${profile.id}&rateId=${rate.id}&days=14&from=${addDays(slotDate, 1)}`)).data;
  const open = days.find((d) => d.slots > 0);
  const slots = (await guest('GET', `/site/availability?profileId=${profile.id}&rateId=${rate.id}&date=${open.date}`)).data.slots;
  const r = await guest('POST', `/site/bookings/${booking.reference}/reschedule`, { email: 'smoke@example.com', date: open.date, time: slots[0] });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.date, open.date);
  assert.equal(r.data.rescheduleCount, 1);
  const c = await guest('POST', `/site/bookings/${booking.reference}/cancel`, { email: 'smoke@example.com', reason: 'Plans changed' });
  assert.equal(c.data.status, 'Cancelled');
  assert.equal(c.data.canCancel, false);
});

await check('profile inquiry without a date', async () => {
  const r = await guest('POST', '/site/bookings', { kind: 'Inquiry', profileId: profile.id, name: 'Asker', email: 'ask@example.com', notes: 'Is a weekend trip possible next month?', consent: true });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.match(r.data.reference, /^INQ-/);
});

await check('server cache: a saved setting shows on the website straight away', async () => {
  const before = (await guest('GET', '/site/bootstrap')).data.site.heroTitle; // now cached
  const changed = `${before} (smoke)`;
  assert.equal((await staff('PUT', '/settings', { heroTitle: changed })).status, 200);
  assert.equal((await guest('GET', '/site/bootstrap')).data.site.heroTitle, changed);
  await staff('PUT', '/settings', { heroTitle: before });
  assert.equal((await guest('GET', '/site/bootstrap')).data.site.heroTitle, before);
});

await check('CMS: lists, dashboard, booking status change with timeline, audit', async () => {
  for (const url of ['/meta', '/dashboard', '/bookings', '/bookings/stats', '/profiles', '/profiles/options', '/locations', '/locations/categories', '/live-chat',
    '/content/pages', '/content/posts', '/content/faqs', '/seo/redirects', '/seo/health', '/inquiries', '/settings', '/admin/users', '/admin/roles', '/audit', '/notifications']) {
    const r = await staff('GET', url);
    assert.equal(r.status, 200, `${url}: ${r.status} ${JSON.stringify(r.data).slice(0, 200)}`);
  }
  const pending = (await staff('GET', '/bookings?status=Pending&kind=Booking')).data.items[0];
  const r = await staff('POST', `/bookings/${pending.id}/status`, { status: 'Confirmed', note: 'See you then.' });
  assert.equal(r.data.status, 'Confirmed');
  assert.ok(r.data.events.some((e) => e.title === 'Confirmed by the concierge'));
  const bad = await staff('POST', `/bookings/${pending.id}/status`, { status: 'Pending' });
  assert.equal(bad.status, 409);
  const audit = (await staff('GET', '/audit?module=bookings')).data;
  assert.ok(audit.items.some((a) => a.action === 'Status changed'));
});

await check('booking chat: client ↔ concierge, unread counts, staff notified, closed for pending bookings', async () => {
  const b = (await staff('GET', '/bookings?status=Confirmed&kind=Booking')).data.items.find((x) => x.bookingDate >= today);
  const detail = (await staff('GET', `/bookings/${b.id}`)).data;
  const email = detail.clientEmail;
  const sent = await guest('POST', `/site/bookings/${b.reference}/messages`, { email, body: 'Can we move dinner to 8 PM?' });
  assert.equal(sent.status, 201, JSON.stringify(sent.data));
  assert.equal(sent.data.messages.at(-1).from, 'me');
  const notes = (await staff('GET', '/notifications?unread=1')).data.items;
  assert.ok(notes.some((n) => n.type === 'booking_message' && n.link === `/bookings/${b.id}` && !n.body.includes('8 PM')), 'staff are notified, without the text');
  const reply = await staff('POST', `/bookings/${b.id}/messages`, { body: 'Of course — 8 PM it is.' });
  assert.equal(reply.status, 201);
  assert.ok(reply.data.chat.messages.some((m) => m.sender === 'Client' && m.body === 'Can we move dinner to 8 PM?'));
  const look = (await guest('GET', `/site/bookings/${b.reference}`, null, { 'X-Booking-Email': email })).data;
  assert.equal(look.chat.unread, 1);
  const thread = (await guest('GET', `/site/bookings/${b.reference}/messages`, null, { 'X-Booking-Email': email })).data;
  assert.equal(thread.messages.at(-1).from, 'concierge');
  assert.equal((await guest('GET', `/site/bookings/${b.reference}`, null, { 'X-Booking-Email': email })).data.chat.unread, 0);
  const pending = (await staff('GET', '/bookings?status=Pending&kind=Booking')).data.items[0];
  const pd = (await staff('GET', `/bookings/${pending.id}`)).data;
  assert.equal((await guest('POST', `/site/bookings/${pending.reference}/messages`, { email: pd.clientEmail, body: 'Hello?' })).status, 409);
});

await check('CMS: profile publish needs ID check; slug change creates a redirect; retire', async () => {
  const meta = (await staff('GET', '/meta')).data;
  const p = await staff('POST', '/profiles', { displayName: 'Smoke Profile', categoryId: meta.categories[0].id, age: 25, status: 'Published' });
  assert.equal(p.status, 422);
  const ok = await staff('POST', '/profiles', { displayName: 'Smoke Profile', categoryId: meta.categories[0].id, age: 25, status: 'Published', ageVerified: true });
  assert.equal(ok.status, 201, JSON.stringify(ok.data));
  const minor = await staff('POST', '/profiles', { displayName: 'Too Young', categoryId: meta.categories[0].id, age: 17 });
  assert.equal(minor.status, 422);
  const id = ok.data.id;
  const rates = await staff('PUT', `/profiles/${id}/rates`, { rates: [{ label: 'Dinner', durationMinutes: 120, price: 6000 }] });
  assert.equal(rates.data.rates.length, 1);
  const sched = await staff('PUT', `/profiles/${id}/schedule`, { blocks: [{ weekday: 1, start: '18:00', end: '24:00' }, { weekday: 1, start: '20:00', end: '22:00' }] });
  assert.equal(sched.status, 422, 'overlapping blocks are refused');
  const renamed = await staff('PUT', `/profiles/${id}`, { ...ok.data, slug: 'smoke-profile-renamed', ageVerified: true });
  assert.equal(renamed.status, 200, JSON.stringify(renamed.data));
  const resolve = (await guest('GET', '/site/resolve?path=/companions/smoke-profile')).data;
  assert.equal(resolve.to, '/companions/smoke-profile-renamed');
  const retired = await staff('POST', `/profiles/${id}/retire`, { redirectTo: '/female' });
  assert.equal(retired.data.status, 'Retired');
});

await check('permissions: coordinator can manage bookings, can only view profiles, no settings', async () => {
  await coordinator('POST', '/admin/auth/login', { email: 'bookings@aurelia.example', password: 'aurelia2026' });
  assert.equal((await coordinator('GET', '/bookings')).status, 200);
  assert.equal((await coordinator('GET', '/profiles')).status, 200);
  const p = (await coordinator('GET', '/profiles')).data.items[0];
  assert.equal((await coordinator('PATCH', `/profiles/${p.id}`, { isFeatured: true })).status, 403);
  assert.equal((await coordinator('GET', '/settings')).status, 403);
});

await check('SEO: sitemap and robots, redirects resolve', async () => {
  const sm = await guest('GET', '/site/sitemap.xml');
  assert.match(sm.data, /<urlset/);
  assert.ok(sm.data.includes('/companions/sofia') && !sm.data.includes('/vip<'), 'no VIP page in the sitemap');
  assert.match((await guest('GET', '/site/robots.txt')).data, /Sitemap:/);
  assert.equal((await guest('GET', '/site/resolve?path=/ladies')).data.to, '/female');
});

await check('database constraints: adults only, publish requires ID check', async () => {
  const bad = await one('SELECT COUNT(*)::int AS n FROM profiles WHERE age < 18 OR (status = \'Published\' AND age_verified_at IS NULL)');
  assert.equal(bad.n, 0);
  const overlaps = await q(`SELECT a.id FROM bookings a JOIN bookings b ON a.profile_id = b.profile_id AND a.id < b.id
    WHERE a.kind = 'Booking' AND b.kind = 'Booking' AND a.status IN ('Pending','Confirmed') AND b.status IN ('Pending','Confirmed') AND a.starts_at < b.ends_at AND b.starts_at < a.ends_at`);
  assert.equal(overlaps.length, 0, 'no overlapping active bookings');
});

await check('security: headers, cross-site requests, CORS, uploads, password hashing, webhooks, CSV', async () => {
  const res = await fetch(`${base}/health`);
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(res.headers.get('x-frame-options'), 'DENY');
  assert.match(res.headers.get('content-security-policy'), /default-src 'none'/);
  assert.equal(res.headers.get('x-powered-by'), null);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  // a form or script on another website can't make changes with the visitor's cookies
  const evil = await fetch(`${base}/site/inquiries`, { method: 'POST', headers: { Origin: 'https://evil.example', 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(evil.status, 403);
  const preflight = await fetch(`${base}/site/bootstrap`, { headers: { Origin: 'https://evil.example' } });
  assert.equal(preflight.headers.get('access-control-allow-origin'), null, 'other sites get no CORS access');
  // uploads: a text file named .jpg, and a real-looking JPEG header with garbage after it, are both refused
  const { id: profileId } = (await staff('GET', '/profiles?pageSize=1')).data.items[0];
  const fake = new FormData();
  fake.append('photos', new Blob(['<script>alert(1)</script>'], { type: 'image/jpeg' }), 'photo.jpg');
  assert.equal((await staff('POST', `/profiles/${profileId}/media`, fake)).status, 422);
  const broken = new FormData();
  broken.append('photos', new Blob([Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(2000, 7)])], { type: 'image/jpeg' }), 'broken.jpg');
  assert.equal((await staff('POST', `/profiles/${profileId}/media`, broken)).status, 422);
  const svg = new FormData();
  svg.append('photos', new Blob(['<svg xmlns="http://www.w3.org/2000/svg"/>'], { type: 'image/svg+xml' }), 'x.svg');
  assert.equal((await staff('POST', `/profiles/${profileId}/media`, svg)).status, 422);
  // passwords: current cost in the hash, older hashes still verify and are flagged for upgrade
  const { hashPassword, verifyPassword, needsRehash, passwordProblem } = await import('../lib/auth.js');
  const h = await hashPassword('Velvet-Harbor-42');
  assert.match(h, /^scrypt\$65536\$8\$2\$/);
  assert.equal(await verifyPassword('Velvet-Harbor-42', h), true);
  assert.equal(await verifyPassword('velvet-harbor-42', h), false);
  assert.equal(needsRehash(h), false);
  const crypto = await import('node:crypto');
  const salt = crypto.randomBytes(16);
  const legacy = `scrypt$${salt.toString('base64')}$${crypto.scryptSync('old-password-1', salt, 64).toString('base64')}`;
  assert.equal(await verifyPassword('old-password-1', legacy), true);
  assert.equal(needsRehash(legacy), true);
  assert.ok(passwordProblem('qwerty123') && passwordProblem('jane.doe2024', 'jane.doe@example.com') && !passwordProblem('Velvet-Harbor-42'));
  // webhooks: valid signature accepted; tampered body, wrong secret and stale timestamp refused
  const { checkSignature } = await import('../lib/webhooks.js');
  const ts = Math.floor(Date.now() / 1000);
  const body = Buffer.from('{"event":"paid"}');
  const sig = `sha256=${crypto.createHmac('sha256', 'whsec_test').update(`${ts}.`).update(body).digest('hex')}`;
  assert.equal(checkSignature({ secret: 'whsec_test', rawBody: body, timestamp: ts, signature: sig }), true);
  assert.equal(checkSignature({ secret: 'whsec_test', rawBody: Buffer.from('{"event":"refund"}'), timestamp: ts, signature: sig }), false);
  assert.equal(checkSignature({ secret: 'other', rawBody: body, timestamp: ts, signature: sig }), false);
  assert.equal(checkSignature({ secret: 'whsec_test', rawBody: body, timestamp: ts - 3600, signature: sig }), false);
  // CSV exports: text that Excel would run as a formula is neutralised
  const { sendCsv } = await import('../lib/http.js');
  let out = '';
  sendCsv({ setHeader() {}, send: (s) => { out = s; } }, 'x.csv', ['Name', 'Total'], [['=HYPERLINK("http://evil")', 1500], ['@SUM(A1)', -20]]);
  assert.ok(out.includes(`"'=HYPERLINK(""http://evil"")"`) && out.includes("'@SUM(A1)") && out.includes(',-20'), out);
});

await check('encryption: chats, timeline notes and client notes are stored encrypted, read back as text', async () => {
  const { driver } = await import('./index.js');
  const raw = async (sql, p) => (await (await driver()).query(sql, p)).rows; // without the automatic decryption
  // everything already in the database (demo data + this run) is ciphertext
  for (const [table, col] of [['booking_messages', 'body'], ['booking_events', 'note'], ['bookings', 'client_notes']]) {
    const [{ plain, total }] = await raw(`SELECT COUNT(*) FILTER (WHERE ${col} NOT LIKE 'enc:v1:%')::int AS plain, COUNT(*)::int AS total FROM ${table} WHERE ${col} IS NOT NULL AND ${col} <> ''`);
    assert.ok(total > 0, `${table}.${col} has rows`);
    assert.equal(plain, 0, `${table}.${col}: ${plain} of ${total} rows in plain text`);
  }
  // a new concierge message: unreadable in the database, readable through the API, not copied into the audit trail
  const [{ id }] = await raw("SELECT id FROM bookings WHERE kind = 'Booking' AND status = 'Confirmed' ORDER BY id LIMIT 1");
  const secret = 'Meet at the side entrance, room 1407';
  const sent = await staff('POST', `/bookings/${id}/messages`, { body: secret });
  assert.equal(sent.status, 201, JSON.stringify(sent.data));
  assert.ok(sent.data.chat.messages.some((m) => m.body === secret));
  const [stored] = await raw('SELECT id, body FROM booking_messages WHERE booking_id = $1 ORDER BY id DESC LIMIT 1', [id]);
  assert.match(stored.body, /^enc:v1:[0-9a-f]{8}:/);
  assert.ok(!stored.body.includes('1407'));
  const [{ hits }] = await raw("SELECT COUNT(*)::int AS hits FROM audit_log WHERE summary LIKE '%1407%' OR changes LIKE '%1407%'");
  assert.equal(hits, 0, 'message text must not be copied to the audit trail');
  // a tampered value is refused (authenticated encryption) instead of showing altered text
  const { decryptText, encryptText, resetKeys, UNREADABLE } = await import('../lib/encryption.js');
  const flipped = stored.body.slice(0, -2) + (stored.body.at(-2) === 'A' ? 'B' : 'A') + stored.body.at(-1);
  assert.equal(decryptText(flipped), UNREADABLE);
  // key rotation: text written with the old key still reads once that key is listed as old
  const before = process.env.MESSAGE_ENCRYPTION_KEY;
  const crypto = await import('node:crypto');
  const oldKey = crypto.randomBytes(32).toString('base64');
  const newKey = crypto.randomBytes(32).toString('base64');
  process.env.MESSAGE_ENCRYPTION_KEY = oldKey; resetKeys();
  const written = encryptText('rotate me');
  process.env.MESSAGE_ENCRYPTION_KEY = newKey; resetKeys();
  assert.equal(decryptText(written), UNREADABLE, 'unknown key');
  process.env.MESSAGE_ENCRYPTION_KEYS_OLD = oldKey; resetKeys();
  assert.equal(decryptText(written), 'rotate me');
  if (before === undefined) delete process.env.MESSAGE_ENCRYPTION_KEY; else process.env.MESSAGE_ENCRYPTION_KEY = before;
  delete process.env.MESSAGE_ENCRYPTION_KEYS_OLD; resetKeys();
});

await check('live chat: visitor ↔ desk, long poll, encrypted at rest, private to the browser and permitted staff', async () => {
  const { driver } = await import('./index.js');
  const raw = async (sql, p) => (await (await driver()).query(sql, p)).rows;
  const visitor = client();
  const secret = 'Is Sofia free on the 14th? My room is 2210';
  // no chat yet in this browser
  const none = await visitor('GET', '/site/chat');
  assert.equal(none.status, 200);
  assert.equal(none.data.chat, null);
  // name and message are required for guests
  const bad = await visitor('POST', '/site/chat', { message: '' });
  assert.equal(bad.status, 422);
  assert.ok(bad.data.details.name && bad.data.details.message);
  const started = await visitor('POST', '/site/chat', { name: 'Chat Tester', email: 'chat.tester@example.com', message: secret, page: '/companions' });
  assert.equal(started.status, 201, JSON.stringify(started.data));
  assert.equal(started.data.chat.status, 'Open');
  assert.equal(started.data.messages[0].body, secret);
  const ref = started.data.chat.reference;
  // stored encrypted; the cookie token is stored only as a hash
  const [row] = await raw('SELECT c.id, c.token_hash, m.body FROM live_chats c JOIN live_chat_messages m ON m.chat_id = c.id WHERE c.reference = $1', [ref]);
  assert.match(row.body, /^enc:v1:[0-9a-f]{8}:/);
  assert.ok(!row.body.includes('2210'));
  assert.match(row.token_hash, /^[0-9a-f]{64}$/);
  // another browser can't see or write to it
  const stranger = client();
  assert.equal((await stranger('GET', '/site/chat')).data.chat, null);
  assert.equal((await stranger('POST', '/site/chat/messages', { body: 'hi' })).status, 404);
  // the desk sees it (unread), with the text decrypted
  const list = await staff('GET', '/live-chat');
  assert.equal(list.status, 200);
  const item = list.data.items.find((c) => c.reference === ref);
  assert.ok(item && item.unread === 1 && item.preview.includes('2210'), JSON.stringify(item));
  // staff without the Contact Messages permission can't (Profile Editor)
  const editor = client();
  await editor('POST', '/admin/auth/login', { email: 'profiles@aurelia.example', password: 'aurelia2026' });
  assert.equal((await editor('GET', '/live-chat')).status, 403);
  // the visitor waits; a staff reply wakes the long poll
  const waiting = visitor('GET', `/site/chat/wait?after=${started.data.messages[0].id}`);
  await new Promise((r) => setTimeout(r, 300));
  const reply = await staff('POST', `/live-chat/${item.id}/messages`, { body: 'Yes she is — shall I hold 8 PM?' });
  assert.equal(reply.status, 201, JSON.stringify(reply.data));
  assert.equal(reply.data.chat.assignedTo != null, true, 'the first reply assigns the chat');
  const woke = await waiting;
  assert.equal(woke.status, 200);
  assert.ok(woke.data.messages.some((m) => m.from === 'staff' && m.body.startsWith('Yes she is')), JSON.stringify(woke.data));
  // reading the chat in the CMS clears the unread count
  await staff('GET', `/live-chat/${item.id}`);
  assert.equal((await staff('GET', '/live-chat')).data.items.find((c) => c.reference === ref).unread, 0);
  // message text stays out of the audit trail and notifications
  const [{ hits }] = await raw("SELECT COUNT(*)::int AS hits FROM audit_log WHERE summary LIKE '%2210%' OR changes LIKE '%2210%' OR summary LIKE '%hold 8 PM%'");
  assert.equal(hits, 0);
  const [{ notes }] = await raw("SELECT COUNT(*)::int AS notes FROM notifications WHERE body LIKE '%2210%' OR title LIKE '%2210%'");
  assert.equal(notes, 0);
  // closing: the visitor can't write any more; a new chat replaces it
  const closed = await staff('POST', `/live-chat/${item.id}/close`);
  assert.equal(closed.data.chat.status, 'Closed');
  assert.equal((await visitor('POST', '/site/chat/messages', { body: 'still there?' })).status, 409);
  assert.equal((await visitor('GET', '/site/chat')).data.chat.status, 'Closed');
  const ended = await visitor('POST', '/site/chat/end');
  assert.equal(ended.status, 200);
  assert.equal((await visitor('GET', '/site/chat')).data.chat, null);
  // every live chat message in the database is ciphertext
  const [{ plain }] = await raw("SELECT COUNT(*)::int AS plain FROM live_chat_messages WHERE body NOT LIKE 'enc:v1:%'");
  assert.equal(plain, 0);
});

const total = results.length;
console.log(`\n${passed}/${total} checks passed`);
server.close();
await closeDb();
process.exit(passed === total ? 0 : 1);
