// Demo data for a fictional companion directory.
//   npm run db:seed          loads demo data into an empty database (skips if profiles already exist)
//   npm run db:reset         drops every table, recreates the schema and reloads the demo data (local use only)
//
// Dates are relative to today (Manila time), so the dashboard, availability and member area always look current.
// Profile photos are generated placeholder portraits (silhouettes), saved through the normal image storage.
// Demo sign-ins: member demo@aurelia.example / password · companion companion@aurelia.example / password ·
// staff admin@aurelia.example / aurelia2026 (see README).
import '../env.js';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { closeDb, exec, one, tx } from './index.js';
import { initDb } from './init.js';
import { hashPassword } from '../lib/auth.js';
import { addDays, fromMin, phDate, phMinutesNow, toMin, weekday } from '../lib/dates.js';
import { saveImage } from '../lib/storage.js';
import * as D from './seed-data.js';

// ---------- deterministic randomness ----------
let state = 20261015;
const rnd = () => {
  state = (state * 1664525 + 1013904223) % 4294967296;
  return state / 4294967296;
};
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
const chance = (p) => rnd() < p;
const int = (a, b) => a + Math.floor(rnd() * (b - a + 1));

const TODAY = phDate();
const at = (date, time = '10:00') => new Date(`${date}T${time}:00+08:00`);
const hoursAgo = (h) => new Date(Date.now() - h * 3600000);
const stamp = (date) => date.slice(2).replace(/-/g, '');
const usedRefs = new Set();
const ref = (prefix, date) => {
  for (;;) {
    const r = `${prefix}-${stamp(date)}-${String(int(0, 9999)).padStart(4, '0')}`;
    if (!usedRefs.has(r)) { usedRefs.add(r); return r; }
  }
};

// ---------- placeholder portraits (PNG) ----------
const CRC = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
const crc32 = (buf) => {
  let c = -1;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));

/** A 480×600 portrait placeholder: gradient backdrop with a soft head-and-shoulders silhouette. */
function portraitPng([top, bottom], variant = 0) {
  const W = 480;
  const H = 600;
  const a = hex(top);
  const b = hex(bottom);
  const raw = Buffer.alloc((W * 3 + 1) * H);
  const hx = 240 + (variant - 1) * 26;
  const hy = 245 + variant * 8;
  for (let y = 0; y < H; y++) {
    const row = y * (W * 3 + 1);
    raw[row] = 0;
    const t = y / (H - 1);
    for (let x = 0; x < W; x++) {
      // diagonal light from the top right
      const light = 0.85 + 0.25 * ((x / W) * 0.6 + (1 - t) * 0.4);
      let c = [0, 1, 2].map((i) => (a[i] * (1 - t) + b[i] * t) * light);
      const dx = x - hx;
      const head = (dx * dx) / (78 * 78) + ((y - hy) * (y - hy)) / (96 * 96);
      const sx = x - hx;
      const shoulders = (sx * sx) / (230 * 230) + ((y - 760) * (y - 760)) / (330 * 330);
      const neck = Math.abs(dx) < 30 + Math.max(0, y - hy - 120) * 0.35 && y > hy + 60 && y < 460;
      const inside = head < 1 || shoulders < 1 || neck;
      const edge = Math.min(Math.abs(1 - head), Math.abs(1 - shoulders));
      if (inside) c = c.map((v) => v * 0.32);
      else if (edge < 0.06 && (head < 1.06 || shoulders < 1.06)) c = c.map((v) => Math.min(255, v * 1.35)); // rim light
      const vignette = 1 - 0.35 * (((x - W / 2) / (W / 2)) ** 2 + ((y - H / 2) / (H / 2)) ** 2) / 2;
      const o = row + 1 + x * 3;
      raw[o] = Math.max(0, Math.min(255, c[0] * vignette));
      raw[o + 1] = Math.max(0, Math.min(255, c[1] * vignette));
      raw[o + 2] = Math.max(0, Math.min(255, c[2] * vignette));
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0);
  ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

const DEMO_VIDEO = 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4';

export async function seedDemo({ log = console.log } = {}) {
  const started = Date.now();
  const memberPassword = await hashPassword('password');
  const staffPassword = await hashPassword('aurelia2026');

  // images first (outside the transaction): 3 per profile, the third is VIP-only for VIP-tier profiles
  log('… Generating placeholder portraits');
  const photos = [];
  for (const p of D.profiles) {
    const list = [];
    for (let v = 0; v < 3; v++) list.push(await saveImage(portraitPng(p.palette, v), 'demo'));
    photos.push(list);
  }

  await tx(async (db) => {
    // ---------- categories, locations, tiers ----------
    const cat = {};
    for (const [i, c] of D.categories.entries()) {
      cat[c.slug] = (await db.one(`INSERT INTO categories (name, slug, description, intro, seo_title, meta_description, sort_order) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
        [c.name, c.slug, c.description, c.intro, `${c.name} companions`, c.description, i])).id;
    }
    const loc = {};
    for (const [i, l] of D.locations.entries()) {
      loc[l.slug] = (await db.one(`INSERT INTO locations (name, slug, region, intro, sections, seo_title, meta_description, is_popular, sort_order) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
        [l.name, l.slug, l.region, l.intro, JSON.stringify(l.sections), `Companions in ${l.name}`, l.intro.slice(0, 165), l.popular, i])).id;
      for (const [j, [name, slug]] of l.areas.entries()) {
        loc[slug] = (await db.one('INSERT INTO locations (parent_id, name, slug, region, intro, sort_order) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id',
          [loc[l.slug], name, slug, l.region, `Verified companions available in ${name}, ${l.name}.`, j])).id;
      }
    }
    const cityOf = {};
    for (const l of D.locations) { cityOf[l.slug] = l.slug; for (const [, s] of l.areas) cityOf[s] = l.slug; }
    const tier = {};
    const tierRow = {};
    for (const [i, t] of D.tiers.entries()) {
      const row = await db.one('INSERT INTO tiers (name, slug, rank, description, price, duration_days, perks, color, is_public, sort_order) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,TRUE,$9) RETURNING id',
        [t.name, t.slug, t.rank, t.description, t.price, t.durationDays, JSON.stringify(t.perks), t.color, i]);
      tier[t.slug] = row.id;
      tierRow[t.slug] = { ...t, id: row.id };
    }

    // ---------- profiles ----------
    const profiles = [];
    for (const [i, p] of D.profiles.entries()) {
      const status = p.status || 'Published';
      const ageVerified = p.ageVerified !== false;
      const publishedDays = int(10, 200);
      const row = await db.one(
        `INSERT INTO profiles (slug, display_name, category_id, base_location_id, age, tagline, bio, languages, nationality, height_cm, attributes, status,
           is_featured, is_verified, verified_at, age_verified_at, vip_tier_id, booking_enabled, away_until, away_note, last_active_at, published_at, retired_at,
           seo_title, meta_description, sort_order, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,TRUE,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27) RETURNING id`,
        [p.name.toLowerCase(), p.name, cat[p.cat], loc[p.loc], p.age, p.tagline, p.bio, p.languages, p.nationality, p.height, JSON.stringify(p.attributes), status,
          !!p.featured, !!p.verified, p.verified ? hoursAgo(24 * int(5, 60)) : null, ageVerified ? hoursAgo(24 * (publishedDays + 2)) : null,
          p.vipTier ? tier[p.vipTier] : null, p.awayDays ? addDays(TODAY, p.awayDays) : null, p.awayDays ? 'Travelling — back soon' : null,
          hoursAgo(int(1, 120)), status === 'Draft' ? null : hoursAgo(24 * publishedDays), status === 'Retired' ? hoursAgo(24 * 20) : null,
          `${p.name}, ${p.age} — ${D.categories.find((c) => c.slug === p.cat).name} companion in ${D.locations.find((l) => l.slug === cityOf[p.loc]).name}`.slice(0, 70),
          `${p.tagline}. Verified profile with published rates and live availability.`.slice(0, 170),
          i, hoursAgo(24 * (publishedDays + 5)), hoursAgo(int(2, 24 * 25))]
      );
      const id = row.id;
      for (const a of p.areas) if (loc[a]) await db.run('INSERT INTO profile_areas (profile_id, location_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [id, loc[a]]);
      const rates = [];
      for (const [j, [label, minutes, price]] of p.rates.entries()) {
        rates.push(await db.one('INSERT INTO profile_rates (profile_id, label, duration_minutes, price, sort_order) VALUES ($1,$2,$3,$4,$5) RETURNING id, label, duration_minutes, price', [id, label, minutes, price, j]));
      }
      const blocks = [];
      for (const [days, start, end] of p.schedule) {
        for (const d of days) {
          await db.run('INSERT INTO profile_schedules (profile_id, weekday, start_time, end_time) VALUES ($1,$2,$3,$4)', [id, d, start, end]);
          blocks.push({ weekday: d, start: toMin(start), end: end === '24:00' ? 1440 : toMin(end) });
        }
      }
      for (const [v, img] of photos[i].entries()) {
        const vipOnly = v === 2 && !!(p.vipTier || p.featured);
        await db.run('INSERT INTO profile_media (profile_id, kind, url, file_name, alt_text, is_primary, vip_only, sort_order) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
          [id, 'photo', img.url, img.fileName, `${p.name} — portrait ${v + 1}`, v === 0, vipOnly, v]);
      }
      if (p.featured && !p.vipTier && i % 2 === 0) {
        await db.run("INSERT INTO profile_media (profile_id, kind, url, alt_text, vip_only, sort_order) VALUES ($1,'video',$2,$3,FALSE,3)", [id, DEMO_VIDEO, `${p.name} — short video`]);
      }
      if (i === 1) await db.run('INSERT INTO profile_time_off (profile_id, start_date, end_date, note) VALUES ($1,$2,$3,$4)', [id, addDays(TODAY, 9), addDays(TODAY, 11), 'Short trip']);
      profiles.push({ ...p, id, status, rates, blocks, city: cityOf[p.loc] });
    }

    // ---------- fees ----------
    for (const [i, f] of D.fees.entries()) {
      await db.run('INSERT INTO fees (name, description, fee_type, amount, location_id, sort_order) VALUES ($1,$2,$3,$4,$5,$6)', [f.name, f.description, f.type, f.amount, f.loc ? loc[f.loc] : null, i]);
    }

    // ---------- members and memberships ----------
    const members = [];
    for (const [i, [first, last, email, tierSlug, daysLeft]] of D.members.entries()) {
      const joined = int(20, 400);
      const expires = tierSlug ? addDays(TODAY, daysLeft) : null;
      const row = await db.one(
        `INSERT INTO members (member_no, first_name, last_name, email, phone, birthdate, tier_id, membership_expires_on, marketing_opt_in, terms_accepted_at, password_hash, email_verified_at, last_login_at, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$10,$12,$10) RETURNING id`,
        [`M-${String(i + 1).padStart(6, '0')}`, first, last, email, `0917 ${int(100, 999)} ${int(1000, 9999)}`, `${int(1975, 2000)}-${String(int(1, 12)).padStart(2, '0')}-${String(int(1, 28)).padStart(2, '0')}`,
          tierSlug ? tier[tierSlug] : null, expires, chance(0.4), hoursAgo(24 * joined), memberPassword, hoursAgo(int(1, 24 * 20))]
      );
      if (tierSlug) {
        const t = tierRow[tierSlug];
        const startsOn = addDays(expires, -(t.durationDays - 1));
        await db.run(`INSERT INTO memberships (membership_no, member_id, tier_id, kind, status, starts_on, ends_on, amount, payment_method, payment_reference, decided_by, decided_at, created_at)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'Mia Tan',$11,$11)`,
        [ref('MEM', startsOn), row.id, t.id, chance(0.3) ? 'Renewal' : 'New', expires >= TODAY ? 'Active' : 'Expired', startsOn, expires, t.price, pick(['GCash', 'Maya', 'Bank transfer']), `REF${int(100000, 999999)}`, at(startsOn)]);
      }
      members.push({ id: row.id, name: `${first} ${last}`, email, tierSlug, active: tierSlug && expires >= TODAY });
    }
    // pending requests to approve in the CMS
    for (const [idx, tierSlug, kind] of [[3, 'silver', 'New'], [6, 'gold', 'New'], [4, 'silver', 'Renewal']]) {
      const m = members[idx];
      await db.run(`INSERT INTO memberships (membership_no, member_id, tier_id, kind, status, amount, payment_method, payment_reference, member_note, created_at)
        VALUES ($1,$2,$3,$4,'Pending',$5,$6,$7,$8,$9)`,
      [ref('MEM', TODAY), m.id, tier[tierSlug], kind, tierRow[tierSlug].price, pick(['GCash', 'Maya']), `${pick(['GC', 'MY'])}${int(10000000, 99999999)}`, kind === 'Renewal' ? 'Renewing — thanks!' : null, hoursAgo(int(1, 30))]);
    }
    const demo = members[0];
    const published = profiles.filter((p) => p.status === 'Published');
    for (const p of [published[0], published[2], published[7], published[9]]) await db.run('INSERT INTO member_favorites (member_id, profile_id) VALUES ($1,$2)', [demo.id, p.id]);

    // ---------- collections ----------
    const byName = Object.fromEntries(profiles.map((p) => [p.name, p]));
    const collections = [
      ['New this month', 'new-this-month', 'The latest verified companions, before they reach the public directory.', null, ['Isabella', 'Alexa', 'Gabriel', 'Danica']],
      ['Gold Selection', 'gold-selection', 'Our most requested companions, with private galleries.', 'gold', ['Yuna', 'Camille', 'Sofia', 'Marco']],
      ['Cebu escapes', 'cebu-escapes', 'Companions for resort weekends and island days in Cebu.', 'silver', ['Mika', 'Rafael']],
    ];
    for (const [i, [title, slug, desc, t, names]] of collections.entries()) {
      const c = await db.one('INSERT INTO collections (title, slug, description, min_tier_id, sort_order) VALUES ($1,$2,$3,$4,$5) RETURNING id', [title, slug, desc, t ? tier[t] : null, i]);
      for (const [j, n] of names.entries()) await db.run('INSERT INTO collection_profiles (collection_id, profile_id, sort_order) VALUES ($1,$2,$3)', [c.id, byName[n].id, j]);
    }

    // ---------- bookings ----------
    const BUFFER = 30;
    const taken = new Map(); // profileId -> [[startAbs, endAbs]] in minutes from epoch day 0
    const dayIndex = (date) => Math.round(Date.parse(`${date}T00:00:00Z`) / 86400000);
    const free = (pid, s, e) => !(taken.get(pid) || []).some(([a, b]) => a < e + BUFFER && b + BUFFER > s);
    const take = (pid, s, e) => taken.set(pid, [...(taken.get(pid) || []), [s, e]]);
    const nowAbs = dayIndex(TODAY) * 1440 + phMinutesNow();
    const verifiedMembers = members.filter((m) => m.id);
    let bookingCount = 0;

    async function insertBooking(p, { date, rate, status, client, memberId, createdAt, source = 'Online' }) {
      const block = pick(p.blocks.filter((b) => b.weekday === weekday(date)));
      if (!block) return null;
      const latest = block.end - rate.durationMinutes;
      if (latest < block.start) return null;
      const startMin = Math.ceil((block.start + Math.floor(rnd() * (latest - block.start + 1))) / 30) * 30;
      if (startMin > latest) return null;
      const s = dayIndex(date) * 1440 + startMin;
      const e = s + rate.durationMinutes;
      if (!free(p.id, s, e)) return null;
      if (['Pending', 'Confirmed'].includes(status) && s < nowAbs + 180) return null; // keep open bookings in the future
      take(p.id, s, e);
      const fees = [{ name: 'Booking fee', description: 'Covers verification, scheduling and concierge support.', amount: 500, percent: null }];
      if (p.city === 'cebu-city') fees.push({ name: 'Cebu travel fee', description: 'Applies to meetings in Cebu City and Mactan.', amount: 1500, percent: null });
      const feesTotal = fees.reduce((x, f) => x + f.amount, 0);
      const time = fromMin(startMin);
      const reference = ref('BK', createdAt.toISOString().slice(0, 10));
      const row = await db.one(
        `INSERT INTO bookings (reference, kind, profile_id, rate_id, rate_label, duration_minutes, booking_date, start_time, starts_at, ends_at, location_id, meeting_place,
           member_id, client_name, client_email, client_phone, preferred_contact, client_notes, rate_price, fees, fees_total, total, status, cancel_reason, cancelled_by, source, created_at, updated_at)
         VALUES ($1,'Booking',$2,$3,$4,$5,$6::date,$7::time,$6::date + $7::time, $6::date + $7::time + make_interval(mins => $5::int),$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$24) RETURNING id`,
        [reference, p.id, rate.id, rate.label, rate.durationMinutes, date, time, loc[p.city], pick(['Hotel lobby', 'Restaurant — details by message', 'Hotel lounge', null]),
          memberId || null, client.name, client.email, `0917 ${int(100, 999)} ${int(1000, 9999)}`, pick(['Email', 'WhatsApp', 'Telegram', 'SMS']),
          chance(0.3) ? pick(['Dinner reservation for two at 8 PM.', 'First time booking — please advise on dress code.', 'Business event, smart casual.', 'Celebrating a birthday.']) : null,
          rate.price, JSON.stringify(fees), feesTotal, rate.price + feesTotal, status,
          ['Cancelled', 'Declined'].includes(status) ? pick(['Change of plans', 'Schedule conflict', 'Companion unavailable']) : null,
          status === 'Cancelled' ? pick(['Client', 'Staff']) : status === 'Declined' ? 'Staff' : null, source, createdAt]
      );
      await db.run('INSERT INTO booking_events (booking_id, status, title, actor, created_at) VALUES ($1, $2, $3, $4, $5)', [row.id, 'Pending', 'Booking request received', client.name, createdAt]);
      const later = new Date(createdAt.getTime() + int(10, 90) * 60000);
      if (status !== 'Pending') {
        const title = { Confirmed: 'Confirmed by the concierge', Completed: 'Confirmed by the concierge', 'No-Show': 'Confirmed by the concierge', Cancelled: 'Cancelled', Declined: 'Request declined' }[status];
        await db.run('INSERT INTO booking_events (booking_id, status, title, actor, created_at) VALUES ($1, $2, $3, $4, $5)', [row.id, ['Completed', 'No-Show'].includes(status) ? 'Confirmed' : status, title, 'Bea Cruz', later]);
      }
      if (status === 'Completed' || status === 'No-Show') {
        await db.run('INSERT INTO booking_events (booking_id, status, title, actor, visible_to_client, created_at) VALUES ($1, $2, $3, $4, $5, $6)',
          [row.id, status, status === 'Completed' ? 'Completed' : 'Marked as no-show', 'Bea Cruz', status === 'Completed', at(date, '23:30')]);
      }
      bookingCount++;
      return row.id;
    }

    const bookable = published.filter((p) => p.rates.length);
    for (let d = -30; d <= 14; d++) {
      const date = addDays(TODAY, d);
      for (const p of bookable) {
        if (!chance(d < 0 ? 0.16 : 0.1)) continue;
        const rate = pick(p.rates.slice(0, 3));
        const status = d < 0
          ? (chance(0.78) ? 'Completed' : pick(['Cancelled', 'Declined', 'No-Show']))
          : d === 0 ? 'Confirmed' : (chance(0.6) ? 'Confirmed' : 'Pending');
        const useMember = chance(0.35);
        const m = useMember ? pick(verifiedMembers) : null;
        const client = m ? { name: m.name, email: m.email } : (([n, e]) => ({ name: n, email: e }))(pick(D.clients));
        const createdAt = d < 0 ? at(addDays(date, -int(1, 5)), fromMin(int(9, 22) * 60)) : status === 'Pending' ? hoursAgo(int(1, 40)) : hoursAgo(int(30, 24 * 6));
        await insertBooking(p, { date, rate, status, client, memberId: m?.id, createdAt, source: chance(0.85) ? 'Online' : pick(['Phone', 'Messaging']) });
      }
    }
    // the demo member always has an upcoming and a past booking
    for (const [offset, status] of [[3, 'Confirmed'], [5, 'Pending'], [-6, 'Completed']]) {
      for (let tries = 0; tries < 12; tries++) {
        const p = pick(bookable.filter((x) => !x.vipTier || x.vipTier === 'gold'));
        const ok = await insertBooking(p, { date: addDays(TODAY, offset + (tries % 3)), rate: p.rates[1] || p.rates[0], status, client: { name: demo.name, email: demo.email }, memberId: demo.id,
          createdAt: offset < 0 ? at(addDays(TODAY, offset - 2)) : hoursAgo(int(2, 30)) });
        if (ok) break;
      }
    }
    // profile inquiries
    for (const [i, [name, email]] of D.clients.slice(0, 4).entries()) {
      const p = bookable[(i * 3) % bookable.length];
      const status = i < 2 ? 'Pending' : 'Answered';
      const createdAt = hoursAgo(int(2, 60));
      const row = await db.one(`INSERT INTO bookings (reference, kind, profile_id, booking_date, client_name, client_email, preferred_contact, client_notes, status, source, created_at, updated_at)
        VALUES ($1,'Inquiry',$2,$3,$4,$5,$6,$7,$8,'Online',$9,$9) RETURNING id`,
      [ref('INQ', createdAt.toISOString().slice(0, 10)), p.id, chance(0.5) ? addDays(TODAY, int(4, 12)) : null, name, email, pick(['Email', 'WhatsApp']),
        pick([`Is ${p.name} available for a weekend trip to Boracay next month?`, `Would ${p.name} be comfortable attending a formal wedding reception?`, 'Do you offer longer bookings for business travel?', 'What languages does this companion speak fluently?']),
        status, createdAt]);
      await db.run('INSERT INTO booking_events (booking_id, status, title, actor, created_at) VALUES ($1,$2,$3,$4,$5)', [row.id, 'Pending', 'Inquiry received', name, createdAt]);
      if (status === 'Answered') await db.run('INSERT INTO booking_events (booking_id, status, title, note, actor, created_at) VALUES ($1,$2,$3,$4,$5,$6)', [row.id, 'Answered', 'Concierge replied', 'Thanks for asking — yes, that works. Reply to our email with your preferred dates.', 'Bea Cruz', new Date(createdAt.getTime() + 3600000)]);
    }

    // ---------- content ----------
    for (const [i, pg] of D.pages.entries()) {
      await db.run('INSERT INTO content_pages (slug, title, kicker, intro, sections, meta_description, show_in_footer, sort_order) VALUES ($1,$2,$3,$4,$5,$6,TRUE,$7)',
        [pg.slug, pg.title, pg.kicker, pg.intro, JSON.stringify(pg.sections), pg.intro.slice(0, 165), i]);
    }
    for (const [i, ps] of D.posts.entries()) {
      await db.run(`INSERT INTO posts (slug, kind, title, excerpt, sections, audience, min_tier_id, location_id, is_pinned, is_published, published_at, meta_description, created_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,TRUE,$10,$4,$10)`,
      [ps.slug, ps.kind, ps.title, ps.excerpt, JSON.stringify(ps.sections), ps.audience || 'Public', ps.tier ? tier[ps.tier] : null, ps.loc ? loc[ps.loc] : null, !!ps.pinned, hoursAgo(24 * (i * 9 + 2))]);
    }
    for (const [i, [group, question, answer, home]] of D.faqs.entries()) {
      await db.run('INSERT INTO faqs (group_name, question, answer, show_on_home, sort_order) VALUES ($1,$2,$3,$4,$5)', [group, question, answer, home, i]);
    }
    for (const [from, to, note] of D.redirects) await db.run('INSERT INTO redirects (from_path, to_path, note, hits) VALUES ($1,$2,$3,$4)', [from, to, note, int(0, 40)]);
    await db.run("INSERT INTO redirects (from_path, to_path, note) VALUES ('/companions/lara', '/locations/makati', 'Retired profile')");

    for (const [i, [name, email, subject, message, status]] of D.inquiries.entries()) {
      await db.run('INSERT INTO inquiries (reference, full_name, email, subject, message, status, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)',
        [ref('MSG', TODAY), name, email, subject, message, status, hoursAgo(6 + i * 20)]);
    }

    // ---------- staff (local demo only) ----------
    if (!process.env.VERCEL && process.env.NODE_ENV !== 'production') {
      const roles = Object.fromEntries((await db.q('SELECT id, name FROM admin_roles')).map((r) => [r.name, r.id]));
      for (const [role, name, email] of D.staff) {
        await db.run('INSERT INTO admin_users (full_name, email, password_hash, role_id) VALUES ($1,$2,$3,$4) ON CONFLICT (email) DO NOTHING', [name, email, staffPassword, roles[role]]);
      }
    }

    // ---------- companion portal: the published profile with the most open requests can sign in ----------
    const busiest = await db.one(`SELECT p.id FROM profiles p JOIN bookings b ON b.profile_id = p.id AND b.status = 'Pending' AND b.kind = 'Booking'
      WHERE p.status = 'Published' GROUP BY p.id ORDER BY COUNT(*) DESC, p.id LIMIT 1`);
    if (busiest) {
      await db.run(`INSERT INTO companion_accounts (profile_id, email, status, password_hash, invited_by, invited_at, activated_at)
        VALUES ($1, 'companion@aurelia.example', 'Active', $2, 'Demo data', now() - INTERVAL '20 days', now() - INTERVAL '19 days')`, [busiest.id, memberPassword]);
    }

    // a few notifications so the bell isn't empty
    const pendings = await db.q(`SELECT b.id, b.reference, b.client_name, p.display_name, b.rate_label, b.booking_date FROM bookings b JOIN profiles p ON p.id = b.profile_id
      WHERE b.status = 'Pending' AND b.kind = 'Booking' ORDER BY b.created_at DESC LIMIT 4`);
    for (const b of pendings) {
      await db.run("INSERT INTO notifications (type, module, title, body, link) VALUES ('booking_requested', 'bookings', $1, $2, $3)",
        [`New booking request ${b.reference}`, `${b.clientName} · ${b.displayName} · ${b.rateLabel} · ${b.bookingDate}`, `/bookings/${b.id}`]);
    }
    await db.run("INSERT INTO notifications (type, module, title, body, link) VALUES ('membership_requested', 'members', 'New membership requests', '3 requests are waiting for approval.', '/members?vip=pending')");

    log(`✓ Demo data: ${profiles.length} profiles, ${Object.keys(loc).length} locations, ${D.tiers.length} tiers, ${members.length} members, ${bookingCount} bookings, ${D.posts.length} posts`);
  });
  log(`  (${((Date.now() - started) / 1000).toFixed(1)} s)`);
}

const TABLES = ['notification_reads', 'notifications', 'audit_log', 'admin_sessions', 'admin_users', 'admin_roles', 'inquiries', 'redirects', 'faqs', 'posts', 'content_pages',
  'booking_events', 'bookings', 'collection_profiles', 'collections', 'member_favorites', 'memberships', 'member_tokens', 'member_mfa_challenges', 'member_sessions', 'members', 'fees',
  'profile_change_requests', 'companion_mfa_challenges', 'companion_tokens', 'companion_sessions', 'companion_accounts',
  'profile_time_off', 'profile_schedules', 'profile_rates', 'profile_media', 'profile_areas', 'profiles', 'tiers', 'locations', 'categories', 'site_settings'];

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  (async () => {
    if (process.argv.includes('--reset')) {
      if (process.env.VERCEL || process.env.NODE_ENV === 'production') throw new Error('Refusing to reset a production database.');
      await exec(TABLES.map((t) => `DROP TABLE IF EXISTS ${t} CASCADE;`).join('\n'));
      console.log('✓ Dropped all tables');
    }
    await initDb();
    const { n } = await one('SELECT COUNT(*)::int AS n FROM profiles');
    if (n > 0) console.log('• Profiles already exist — skipping demo data (use npm run db:reset to start over).');
    else await seedDemo();
    await closeDb();
  })().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
