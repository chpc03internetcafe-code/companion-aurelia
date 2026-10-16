// Human-friendly reference numbers: BK-261012-4821, MEM-261012-0007, INQ-…, M-000123 …
import crypto from 'node:crypto';
import { phStamp } from './dates.js';

const rand4 = () => String(crypto.randomInt(0, 10000)).padStart(4, '0');

/**
 * A new reference like `${prefix}-YYMMDD-NNNN` that isn't in table.column yet.
 * `db` can be the transaction helpers from tx() so the check sees uncommitted rows.
 */
export async function newReference(db, prefix, table, column) {
  for (let i = 0; i < 20; i++) {
    const ref = `${prefix}-${phStamp()}-${rand4()}`;
    const hit = await db.one(`SELECT 1 FROM ${table} WHERE ${column} = $1`, [ref]);
    if (!hit) return ref;
  }
  throw new Error(`Could not generate a unique ${prefix} reference.`);
}

/** Next sequential member number, e.g. M-000124. */
export async function nextMemberNo(db) {
  const row = await db.one("SELECT COALESCE(MAX(CAST(substring(member_no FROM 3) AS INT)), 0) + 1 AS n FROM members WHERE member_no ~ '^M-[0-9]+$'");
  return `M-${String(row.n).padStart(6, '0')}`;
}
