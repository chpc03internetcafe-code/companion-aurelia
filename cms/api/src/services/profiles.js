// The public directory: profile cards, search filters and the profile page.
// Only published profiles in active categories are shown; photos/videos marked hidden are never sent.
import { params, q, one } from '../db/index.js';
import { isIsoDate, phDate } from '../lib/dates.js';
import { availableOnSql } from './availability.js';

export const SORTS = { featured: 'Featured', newest: 'Newest', active: 'Recently active', price_asc: 'Price: low to high', price_desc: 'Price: high to low' };

const CARD = `
  p.id, p.slug, p.display_name, p.age, p.tagline, p.languages, p.is_verified, p.is_featured,
  p.published_at, p.updated_at, p.last_active_at, p.away_until,
  c.name AS category_name, c.slug AS category_slug,
  l.name AS location_name, l.slug AS location_slug, pl.name AS location_parent_name,
  (SELECT url FROM profile_media m WHERE m.profile_id = p.id AND m.kind = 'photo' AND NOT m.is_hidden ORDER BY m.is_primary DESC, m.sort_order, m.id LIMIT 1) AS photo_url,
  (SELECT alt_text FROM profile_media m WHERE m.profile_id = p.id AND m.kind = 'photo' AND NOT m.is_hidden ORDER BY m.is_primary DESC, m.sort_order, m.id LIMIT 1) AS photo_alt,
  (SELECT COUNT(*)::int FROM profile_media m WHERE m.profile_id = p.id AND m.kind = 'photo' AND NOT m.is_hidden) AS photo_count,
  EXISTS (SELECT 1 FROM profile_media m WHERE m.profile_id = p.id AND m.kind = 'video' AND NOT m.is_hidden) AS has_video,
  (SELECT MIN(price) FROM profile_rates r WHERE r.profile_id = p.id AND r.is_active) AS price_from,
  (SELECT MIN(duration_minutes) FROM profile_rates r WHERE r.profile_id = p.id AND r.is_active) AS min_duration`;

const FROM = `FROM profiles p
  JOIN categories c ON c.id = p.category_id
  LEFT JOIN locations l ON l.id = p.base_location_id
  LEFT JOIN locations pl ON pl.id = l.parent_id`;

/** WHERE parts every public listing shares: published, active category. */
const visibility = () => ["p.status = 'Published'", 'c.is_active'];

const shapeCard = (r, today) => ({
  id: r.id, slug: r.slug, name: r.displayName, age: r.age, tagline: r.tagline, languages: r.languages,
  verified: r.isVerified, featured: r.isFeatured,
  category: { name: r.categoryName, slug: r.categorySlug },
  location: r.locationName ? { name: r.locationName, slug: r.locationSlug, parent: r.locationParentName } : null,
  photoUrl: r.photoUrl, photoAlt: r.photoAlt, photoCount: r.photoCount, hasVideo: r.hasVideo,
  priceFrom: r.priceFrom, minDuration: r.minDuration, availableToday: !!r.availableToday && !(r.awayUntil && r.awayUntil >= today),
  updatedAt: r.updatedAt, lastActiveAt: r.lastActiveAt, publishedAt: r.publishedAt,
});

/**
 * filters: { category, location (city or area slug), q, budgetMin, budgetMax, duration, available ('today' | YYYY-MM-DD),
 *            verified, featured, sort, ids[] }
 */
export async function searchProfiles(filters = {}, { page = 1, pageSize = 24 } = {}) {
  const p = params();
  const today = phDate();
  const where = visibility();
  if (filters.category) where.push(`c.slug = ${p.add(String(filters.category))}`);
  if (filters.location) {
    // the location itself, its areas, and profiles serving either one
    const loc = p.add(String(filters.location));
    where.push(`EXISTS (
      SELECT 1 FROM locations x WHERE x.slug = ${loc} AND x.is_published AND (
        p.base_location_id = x.id OR l.parent_id = x.id
        OR EXISTS (SELECT 1 FROM profile_areas a JOIN locations al ON al.id = a.location_id WHERE a.profile_id = p.id AND (al.id = x.id OR al.parent_id = x.id))))`);
  }
  if (filters.q) {
    const s = p.add(`%${String(filters.q).slice(0, 60)}%`);
    where.push(`(p.display_name ILIKE ${s} OR p.tagline ILIKE ${s} OR p.languages ILIKE ${s} OR l.name ILIKE ${s})`);
  }
  const min = Number(filters.budgetMin) || null;
  const max = Number(filters.budgetMax) || null;
  const dur = Number(filters.duration) || null;
  if (min || max || dur) {
    const conds = ['r.profile_id = p.id', 'r.is_active'];
    if (min) conds.push(`r.price >= ${p.add(min)}`);
    if (max) conds.push(`r.price <= ${p.add(max)}`);
    if (dur) conds.push(`r.duration_minutes = ${p.add(dur)}`);
    where.push(`EXISTS (SELECT 1 FROM profile_rates r WHERE ${conds.join(' AND ')})`);
  }
  const day = filters.available === 'today' ? today : isIsoDate(filters.available) ? filters.available : null;
  if (day) where.push(availableOnSql(p.add(day)));
  if (filters.verified === '1' || filters.verified === true) where.push('p.is_verified');
  if (filters.featured === '1' || filters.featured === true) where.push('p.is_featured');
  if (Array.isArray(filters.ids)) where.push(`p.id = ANY(${p.add(filters.ids.map(Number).filter(Number.isInteger))}::int[])`);

  const order = {
    newest: 'p.published_at DESC NULLS LAST, p.id DESC',
    active: 'p.last_active_at DESC NULLS LAST, p.updated_at DESC',
    price_asc: 'price_from ASC NULLS LAST, p.display_name',
    price_desc: 'price_from DESC NULLS LAST, p.display_name',
    updated: 'p.updated_at DESC',
  }[filters.sort] || 'p.is_featured DESC, p.sort_order, p.last_active_at DESC NULLS LAST';

  const w = `WHERE ${where.join(' AND ')}`;
  const todayParam = p.add(today);
  const size = Math.min(60, Math.max(1, pageSize));
  const [{ total }] = await q(`SELECT COUNT(*)::int AS total ${FROM} ${w}`, p.values.slice(0, -1));
  const rows = await q(
    `SELECT ${CARD}, ${availableOnSql(todayParam)} AS available_today ${FROM} ${w} ORDER BY ${order} LIMIT ${p.add(size)} OFFSET ${p.add((Math.max(1, page) - 1) * size)}`,
    p.values
  );
  return { total, page: Math.max(1, page), pageSize: size, items: rows.map((r) => shapeCard(r, today)) };
}

/** Cards for a fixed list of ids (favourites), in the given order, respecting visibility. */
export async function cardsByIds(ids) {
  if (!ids.length) return [];
  const { items } = await searchProfiles({ ids }, { pageSize: 60 });
  const byId = new Map(items.map((c) => [c.id, c]));
  return ids.map((id) => byId.get(Number(id))).filter(Boolean);
}

/**
 * Full profile page. Returns { retired, redirect } for retired profiles, null when not found / not visible.
 */
export async function profileDetail(slug) {
  const p = params([slug]);
  const raw = await one('SELECT * FROM profiles WHERE slug = $1', [slug]);
  if (!raw) return null;
  if (raw.status === 'Retired') return { retired: true, name: raw.displayName, categoryId: raw.categoryId, locationId: raw.baseLocationId };
  if (raw.status !== 'Published') return null;

  const [card] = (await q(`SELECT ${CARD}, ${availableOnSql('$2')} AS available_today ${FROM} WHERE p.slug = $1`, [...p.values, phDate()]));
  const [media, rates, schedule, timeOff, areas] = await Promise.all([
    q('SELECT id, kind, url, poster_url, alt_text, is_primary FROM profile_media WHERE profile_id = $1 AND NOT is_hidden ORDER BY is_primary DESC, sort_order, id', [raw.id]),
    q('SELECT id, label, duration_minutes, price, notes FROM profile_rates WHERE profile_id = $1 AND is_active ORDER BY sort_order, duration_minutes', [raw.id]),
    q("SELECT weekday, to_char(start_time, 'HH24:MI') AS start, CASE WHEN end_time = '24:00' THEN '24:00' ELSE to_char(end_time, 'HH24:MI') END AS end FROM profile_schedules WHERE profile_id = $1 ORDER BY weekday, start_time", [raw.id]),
    q('SELECT start_date, end_date, note FROM profile_time_off WHERE profile_id = $1 AND end_date >= ph_today() ORDER BY start_date LIMIT 10', [raw.id]),
    q('SELECT l.id, l.name, l.slug, pl.name AS parent_name FROM profile_areas a JOIN locations l ON l.id = a.location_id LEFT JOIN locations pl ON pl.id = l.parent_id WHERE a.profile_id = $1 AND l.is_published ORDER BY l.name', [raw.id]),
  ]);
  return {
    ...shapeCard(card, phDate()),
    categoryId: raw.categoryId,
    baseLocationId: raw.baseLocationId,
    bio: raw.bio, nationality: raw.nationality, heightCm: raw.heightCm,
    attributes: JSON.parse(raw.attributes || '[]'),
    bookingEnabled: raw.bookingEnabled, awayUntil: raw.awayUntil, awayNote: raw.awayNote,
    verifiedAt: raw.verifiedAt,
    seoTitle: raw.seoTitle, metaDescription: raw.metaDescription,
    media: media.map((m) => ({ id: m.id, kind: m.kind, url: m.url, posterUrl: m.posterUrl, alt: m.altText })),
    rates, schedule, timeOff, areas,
  };
}

/** A few other visible profiles from the same category / location. */
export async function similarProfiles({ excludeId, categoryId, locationId }, limit = 4) {
  const p = params();
  const where = visibility();
  if (excludeId) where.push(`p.id <> ${p.add(excludeId)}`);
  const cat = p.add(categoryId || 0);
  const loc = p.add(locationId || 0);
  const rows = await q(
    `SELECT ${CARD}, ${availableOnSql(p.add(phDate()))} AS available_today ${FROM} WHERE ${where.join(' AND ')}
     ORDER BY (p.category_id = ${cat})::int + (p.base_location_id = ${loc} OR l.parent_id = ${loc})::int DESC, p.is_featured DESC, p.last_active_at DESC NULLS LAST
     LIMIT ${p.add(limit)}`,
    p.values
  );
  return rows.map((r) => shapeCard(r, phDate()));
}
