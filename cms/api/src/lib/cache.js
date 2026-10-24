// Server-side cache for expensive, mostly-public reads (site settings, the website bootstrap, homepage
// lists, sitemap, CMS option lists).
//
// - In memory, per server instance (each Vercel instance or cluster worker has its own copy), so entries
//   are kept short: a change made through another instance shows up within the entry's TTL.
// - Any successful change (POST / PUT / PATCH / DELETE) handled by this instance clears everything,
//   so staff see their own edits straight away (see app.js).
// - Concurrent misses for the same key share one database round trip.
const entries = new Map(); // key -> { value, expires } or { pending }
const MAX_ENTRIES = 500;

/** Returns the cached value for key, or runs fn() and keeps its result for ttlMs. */
export async function cached(key, ttlMs, fn) {
  const hit = entries.get(key);
  if (hit?.pending) return hit.pending;
  if (hit && hit.expires > Date.now()) return hit.value;
  const pending = Promise.resolve().then(fn);
  entries.set(key, { pending });
  try {
    const value = await pending;
    if (entries.get(key)?.pending === pending) {
      if (entries.size > MAX_ENTRIES) entries.delete(entries.keys().next().value);
      entries.set(key, { value, expires: Date.now() + ttlMs });
    }
    return value;
  } catch (err) {
    if (entries.get(key)?.pending === pending) entries.delete(key);
    throw err;
  }
}

/** Drops every entry, or only those whose key starts with prefix. */
export function clearCache(prefix) {
  if (!prefix) return entries.clear();
  for (const k of entries.keys()) if (k.startsWith(prefix)) entries.delete(k);
}

/** Express middleware: clears the cache after any successful write request. */
export function clearCacheOnWrite(req, res, next) {
  if (req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'OPTIONS') {
    res.on('finish', () => { if (res.statusCode < 400) clearCache(); });
  }
  next();
}

/** Cache-Control for public responses that are the same for every visitor: browsers revalidate, the CDN keeps them briefly. */
export const PUBLIC_CDN_CACHE = 'public, max-age=0, s-maxage=30, stale-while-revalidate=300';
