// Database access for the whole API.
//
// - With DATABASE_URL set, it connects to PostgreSQL (Supabase or any Postgres) through `pg`.
// - Without it, it runs an embedded PostgreSQL (PGlite) stored in cms/api/data/, so the project
//   works on a fresh machine with no database to install. Same SQL, same results.
//
// Columns are snake_case in SQL and come back camelCase in JS (profile_id -> profileId).
// Parameters use Postgres placeholders: q('SELECT * FROM profiles WHERE id = $1', [id]).
// NUMERIC and BIGINT come back as numbers, DATE as 'YYYY-MM-DD' strings, TIME as 'HH:MM:SS'.
import '../env.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = process.env.PGLITE_DIR || path.resolve(here, '../../data/pglite');

const camel = (s) => s.replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase());
const camelRow = (row) => {
  const out = {};
  for (const k in row) out[camel(k)] = row[k];
  return out;
};

const NUMERIC = 1700;
const INT8 = 20;
const DATE = 1082;

let driverPromise;

async function createPgDriver() {
  const pg = (await import('pg')).default;
  pg.types.setTypeParser(NUMERIC, (v) => (v == null ? null : parseFloat(v)));
  pg.types.setTypeParser(INT8, (v) => (v == null ? null : Number(v)));
  pg.types.setTypeParser(DATE, (v) => v);
  const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL) ? false : { rejectUnauthorized: false },
    max: process.env.VERCEL ? 3 : 10,
  });
  return {
    kind: 'postgres',
    query: async (text, params) => {
      const r = await pool.query(text, params);
      return { rows: r.rows || [], count: r.rowCount ?? 0 };
    },
    exec: (text) => pool.query(text),
    transaction: async (fn) => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await fn(async (text, params) => {
          const r = await client.query(text, params);
          return { rows: r.rows || [], count: r.rowCount ?? 0 };
        });
        await client.query('COMMIT');
        return result;
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
}

async function createPgliteDriver() {
  const { PGlite } = await import('@electric-sql/pglite');
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const db = new PGlite(DATA_DIR, {
    parsers: {
      [NUMERIC]: (v) => (v == null ? null : parseFloat(v)),
      [INT8]: (v) => (v == null ? null : Number(v)),
      [DATE]: (v) => v,
    },
  });
  await db.waitReady;
  // PGlite runs in UTC; "today in Manila" is computed in SQL with ph_today()
  const wrapResult = (r) => ({ rows: r.rows || [], count: r.affectedRows ?? r.rows?.length ?? 0 });
  return {
    kind: 'pglite',
    query: async (text, params) => wrapResult(await db.query(text, params)),
    exec: (text) => db.exec(text),
    transaction: (fn) => db.transaction((tx) => fn(async (text, params) => wrapResult(await tx.query(text, params)))),
    close: () => db.close(),
  };
}

export function driver() {
  if (!process.env.DATABASE_URL && process.env.VERCEL) {
    throw new Error('DATABASE_URL is not set. On Vercel the API needs a hosted PostgreSQL database (e.g. Supabase transaction pooler URL).');
  }
  driverPromise ||= (process.env.DATABASE_URL ? createPgDriver() : createPgliteDriver()).catch((err) => {
    driverPromise = null;
    throw err;
  });
  return driverPromise;
}

/** Runs one statement; returns camelCased rows. */
export async function q(text, params = []) {
  const d = await driver();
  return (await d.query(text, params)).rows.map(camelRow);
}

/** First row or null. */
export const one = async (text, params) => (await q(text, params))[0] || null;

/** Runs one statement; returns the number of rows changed. */
export async function run(text, params = []) {
  const d = await driver();
  return (await d.query(text, params)).count;
}

/** Runs several ;-separated statements without parameters (schema files). */
export async function exec(text) {
  const d = await driver();
  return d.exec(text);
}

/**
 * Runs fn inside a transaction. fn gets { q, one, run } bound to the transaction.
 * Anything thrown rolls the whole transaction back.
 */
export async function tx(fn) {
  const d = await driver();
  return d.transaction(async (raw) => {
    const tq = async (text, params = []) => (await raw(text, params)).rows.map(camelRow);
    return fn({
      q: tq,
      one: async (text, params) => (await tq(text, params))[0] || null,
      run: async (text, params = []) => (await raw(text, params)).count,
    });
  });
}

export async function closeDb() {
  if (!driverPromise) return;
  const d = await driverPromise;
  driverPromise = null;
  await d.close();
}

export const dbKind = async () => (await driver()).kind;

// Builds "$n" placeholders while collecting values, for dynamic WHERE clauses:
//   const p = params(); where.push(`name ILIKE ${p.add('%x%')}`); q(sql, p.values)
export function params(initial = []) {
  const values = [...initial];
  return {
    values,
    add(v) {
      values.push(v);
      return `$${values.length}`;
    },
  };
}
