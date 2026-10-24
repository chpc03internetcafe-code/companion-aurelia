// Where uploaded files are kept.
// - Supabase Storage when SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are set (needed on Vercel,
//   whose file system doesn't keep files between requests). Public images get an https URL.
// - Otherwise the local cms/api/uploads folder, served by the API at /uploads (offline development).
// Rows store each file's url and key, so either kind can be deleted later.
//
// Private files (verification documents) go to a private bucket (or cms/api/private-uploads, never served),
// read back only through a staff-only API route.
import fs from 'node:fs/promises';
import path from 'node:path';
import multer from 'multer';
import { fileURLToPath } from 'node:url';

const apiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const UPLOAD_DIR = path.join(apiRoot, 'uploads');
export const PRIVATE_DIR = path.join(apiRoot, 'private-uploads');

const SUPABASE_URL = process.env.SUPABASE_URL?.replace(/\/$/, '');
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
export const BUCKET = process.env.SUPABASE_BUCKET || 'site-media';
export const PRIVATE_BUCKET = process.env.SUPABASE_PRIVATE_BUCKET || 'private-files';
export const usingSupabase = !!(SUPABASE_URL && KEY);

const IMAGE_TYPES = { '.jpg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };
const headers = (extra = {}) => ({ Authorization: `Bearer ${KEY}`, apikey: KEY, ...extra });
const publicUrl = (key) => `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${key.split('/').map(encodeURIComponent).join('/')}`;

async function check(res, what) {
  if (res.ok) return res;
  const body = await res.text().catch(() => '');
  throw new Error(`Supabase Storage ${what} failed (${res.status}): ${body.slice(0, 200)}`);
}

const buckets = new Map();
// Creates a bucket on first use (the API on Vercel never runs db:init). Safe to call repeatedly.
function ensureBucket(id, isPublic) {
  if (!buckets.has(id)) {
    buckets.set(id, (async () => {
      const res = await fetch(`${SUPABASE_URL}/storage/v1/bucket/${id}`, { headers: headers() });
      if (res.ok) return;
      await check(await fetch(`${SUPABASE_URL}/storage/v1/bucket`, {
        method: 'POST',
        headers: headers({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ id, name: id, public: isPublic, file_size_limit: 5 * 1024 * 1024, allowed_mime_types: Object.values(IMAGE_TYPES) }),
      }), 'bucket create');
    })().catch((err) => {
      buckets.delete(id);
      throw err;
    }));
  }
  return buckets.get(id);
}

// Checks the file really is a JPG, PNG or WEBP (the browser-reported type can't be trusted). Returns its extension, or null.
export function sniffImage(buffer) {
  if (!buffer || buffer.length < 12) return null;
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return '.jpg';
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return '.png';
  if (buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return '.webp';
  return null;
}

/**
 * Upload middleware for photos: in memory, at most `maxFiles` files of 4 MB, a few small text fields, and only
 * files the browser reports as JPG/PNG/WEBP. The file's real type is checked again from its bytes in saveImage.
 */
export function imageUpload(maxFiles) {
  return multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 4 * 1024 * 1024, files: maxFiles, fields: 20, fieldSize: 100 * 1024, parts: maxFiles + 20 },
    fileFilter: (_req, file, cb) => (Object.values(IMAGE_TYPES).includes(file.mimetype)
      ? cb(null, true)
      : cb(Object.assign(new Error('Upload JPG, PNG or WEBP images only.'), { status: 422 }))),
  });
}

export const newFileName = (ext) => `${Date.now()}-${Math.round(Math.random() * 1e6)}${ext}`;

// Public images are fully decoded, resized to fit MAX_SIDE and re-encoded as WebP (EXIF orientation applied,
// metadata such as GPS location stripped). Re-encoding also drops anything hidden in the file besides the
// picture (e.g. a script appended to a valid JPEG). A file that doesn't decode as an image is refused; only
// if sharp isn't installed on the platform is the (type-checked) original stored.
const MAX_SIDE = 1600;
const WEBP_QUALITY = 80;
const MAX_INPUT_PIXELS = 40_000_000; // ~8000×5000; bigger "images" are usually decompression bombs
let sharpLib; // undefined = not loaded yet, null = not installed on this platform
async function compressImage(buffer, ext) {
  if (sharpLib === undefined) {
    sharpLib = await import('sharp').then((m) => m.default, (err) => {
      console.warn('[storage] sharp unavailable, images are stored as uploaded:', err.message);
      return null;
    });
  }
  if (!sharpLib) return { buffer, ext };
  try {
    const out = await sharpLib(buffer, { failOn: 'error', limitInputPixels: MAX_INPUT_PIXELS, animated: false })
      .rotate()
      .resize({ width: MAX_SIDE, height: MAX_SIDE, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: WEBP_QUALITY, effort: 4 })
      .toBuffer();
    return { buffer: out, ext: '.webp' };
  } catch (err) {
    console.warn('[storage] image refused:', err.message);
    throw Object.assign(new Error(/pixel limit/i.test(err.message)
      ? 'This image is too large. Upload one under 8000 × 5000 pixels.'
      : 'This file couldn’t be read as an image. Upload a JPG, PNG or WEBP photo.'), { status: 422 });
  }
}

/** Saves a public image (profile photo, location or post cover), compressed. Returns { url, fileName }. */
export async function saveImage(original, folder) {
  const sniffed = sniffImage(original);
  if (!sniffed) throw Object.assign(new Error('Upload a JPG, PNG or WEBP image.'), { status: 422 });
  const { buffer, ext } = await compressImage(original, sniffed);
  const key = `${folder}/${newFileName(ext)}`;
  if (usingSupabase) {
    await ensureBucket(BUCKET, true);
    await check(await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${key}`, {
      method: 'POST',
      headers: headers({ 'Content-Type': IMAGE_TYPES[ext], 'Cache-Control': 'public, max-age=31536000, immutable', 'x-upsert': 'true' }),
      body: buffer,
    }), 'upload');
    return { url: publicUrl(key), fileName: key };
  }
  const file = path.join(UPLOAD_DIR, ...key.split('/'));
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, buffer);
  return { url: `/uploads/${key}`, fileName: key };
}

/** Deletes public images by { url, fileName }. Never throws: a missing file shouldn't block a delete. */
export async function removeImages(images) {
  const list = images.filter((i) => i?.fileName);
  const remote = list.filter((i) => !i.url?.startsWith('/uploads/')).map((i) => i.fileName);
  const local = list.filter((i) => i.url?.startsWith('/uploads/'));
  if (remote.length && usingSupabase) {
    await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}`, {
      method: 'DELETE', headers: headers({ 'Content-Type': 'application/json' }), body: JSON.stringify({ prefixes: remote }),
    }).catch((e) => console.error('[storage] delete failed:', e.message));
  }
  await Promise.all(local.map((i) => {
    const file = path.join(UPLOAD_DIR, ...i.fileName.split('/'));
    return file.startsWith(UPLOAD_DIR + path.sep) ? fs.unlink(file).catch(() => {}) : null;
  }));
}

/** Saves a private file. key e.g. "verification/12/123.jpg". */
export async function savePrivateFile(buffer, key) {
  const contentType = IMAGE_TYPES[path.extname(key).toLowerCase()];
  if (usingSupabase) {
    await ensureBucket(PRIVATE_BUCKET, false);
    await check(await fetch(`${SUPABASE_URL}/storage/v1/object/${PRIVATE_BUCKET}/${key}`, {
      method: 'POST', headers: headers({ 'Content-Type': contentType, 'Cache-Control': 'no-cache', 'x-upsert': 'true' }), body: buffer,
    }), 'upload');
    return key;
  }
  const file = path.join(PRIVATE_DIR, ...key.split('/'));
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, buffer);
  return key;
}

/** Returns { buffer, contentType }, or null when the file is gone. */
export async function readPrivateFile(key) {
  const contentType = IMAGE_TYPES[path.extname(key).toLowerCase()] || 'application/octet-stream';
  if (usingSupabase) {
    const res = await fetch(`${SUPABASE_URL}/storage/v1/object/${PRIVATE_BUCKET}/${key}`, { headers: headers() });
    if (res.status === 400 || res.status === 404) return null;
    await check(res, 'download');
    return { buffer: Buffer.from(await res.arrayBuffer()), contentType };
  }
  const file = path.join(PRIVATE_DIR, ...key.split('/'));
  if (!file.startsWith(PRIVATE_DIR + path.sep)) return null;
  const buffer = await fs.readFile(file).catch(() => null);
  return buffer && { buffer, contentType };
}
