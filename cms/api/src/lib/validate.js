// Schema-driven validation plus INSERT/UPDATE helpers shared by the CMS modules.
//
// A schema maps request-body keys (camelCase) to rules; the column is the snake_case of the key
// unless `col` says otherwise:
//   { price: { type: 'decimal', required: true, min: 0, label: 'Price' } }
// Types: string | email | phone | int | decimal | bool | date | time | enum | json
import { q, run } from '../db/index.js';
import { HttpError } from './http.js';

const snake = (s) => s.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
export const colOf = (key, rule) => rule.col || snake(key);

// Philippine mobile/landline: digits, spaces, +, -, parentheses; 7–15 digits.
const PHONE = /^[+()\d\s-]+$/;

export function parse(body = {}, schema, { partial = false } = {}) {
  const data = {};
  const errors = {};
  for (const [key, rule] of Object.entries(schema)) {
    if (rule.readOnly) continue;
    const present = body[key] !== undefined;
    if (partial && !present) continue;
    let v = body[key];
    if (typeof v === 'string') v = v.trim();
    const empty = v === undefined || v === null || v === '';

    if (empty) {
      if (rule.required) errors[key] = rule.message || `${rule.label || 'This field'} is required.`;
      else data[key] = rule.default !== undefined ? rule.default : rule.type === 'bool' ? false : null;
      continue;
    }

    switch (rule.type) {
      case 'string':
        v = String(v);
        if (rule.upper) v = v.toUpperCase();
        if (rule.lower) v = v.toLowerCase();
        if (rule.max && v.length > rule.max) errors[key] = `Use ${rule.max} characters or fewer.`;
        else if (rule.pattern && !rule.pattern.test(v)) errors[key] = rule.patternMessage || 'Invalid format.';
        break;
      case 'email':
        v = String(v).toLowerCase();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) || v.length > 254) errors[key] = 'Enter a valid email address.';
        break;
      case 'phone': {
        v = String(v);
        const digits = v.replace(/\D/g, '');
        if (!PHONE.test(v) || digits.length < 7 || digits.length > 15) errors[key] = 'Enter a valid phone number, e.g. 0917 123 4567.';
        break;
      }
      case 'int':
        v = Number(v);
        if (!Number.isInteger(v) || (rule.min !== undefined && v < rule.min) || (rule.max !== undefined && v > rule.max))
          errors[key] = rule.message || `Enter a whole number${rule.min !== undefined ? ` from ${rule.min}` : ''}${rule.max !== undefined ? ` to ${rule.max}` : ''}.`;
        break;
      case 'decimal':
        v = Math.round(Number(v) * 100) / 100;
        if (Number.isNaN(v) || (rule.min !== undefined && v < rule.min) || (rule.max !== undefined && v > rule.max))
          errors[key] = rule.message || 'Enter a valid amount.';
        break;
      case 'bool':
        v = v === true || v === 'true' || v === 1 || v === '1';
        break;
      case 'date':
        v = String(v).slice(0, 10);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(v))) errors[key] = 'Enter a valid date.';
        break;
      case 'time':
        v = String(v).slice(0, 5);
        // 24:00 is allowed where a rule says so (availability "until midnight")
        if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(v) && !(rule.allowMidnight && v === '24:00')) errors[key] = 'Enter a valid time.';
        break;
      case 'enum':
        if (!rule.values.includes(v)) errors[key] = `Choose one of: ${rule.values.join(', ')}.`;
        break;
      case 'json':
        if (rule.validate) {
          const msg = rule.validate(v);
          if (msg) errors[key] = msg;
        }
        v = JSON.stringify(v);
        break;
      default:
        break;
    }
    if (!errors[key] && rule.check) {
      const msg = rule.check(v, body);
      if (msg) errors[key] = msg;
    }
    data[key] = v;
  }
  return { data, errors };
}

export function assertValid(errors) {
  if (Object.keys(errors).length) throw new HttpError(422, 'Please fix the highlighted fields.', errors);
}

/** parse + assertValid in one go. */
export function validate(body, schema, opts) {
  const { data, errors } = parse(body, schema, opts);
  assertValid(errors);
  return data;
}

function columns(schema, data) {
  const cols = [];
  const values = [];
  for (const [k, v] of Object.entries(data)) {
    const rule = schema[k];
    if (!rule || rule.virtual) continue;
    cols.push(colOf(k, rule));
    values.push(v);
  }
  return { cols, values };
}

export async function insertRow(table, schema, data, extra = {}, db = { q }) {
  const { cols, values } = columns(schema, data);
  for (const [c, v] of Object.entries(extra)) {
    cols.push(c);
    values.push(v);
  }
  const rows = await db.q(`INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING id`, values);
  return rows[0].id;
}

export async function updateRow(table, schema, id, data, { touch = true, extra = {}, db = { run } } = {}) {
  const { cols, values } = columns(schema, data);
  for (const [c, v] of Object.entries(extra)) {
    cols.push(c);
    values.push(v);
  }
  const sets = cols.map((c, i) => `${c} = $${i + 1}`);
  if (touch) sets.push('updated_at = now()');
  if (!sets.length) return 0;
  values.push(id);
  const n = await db.run(`UPDATE ${table} SET ${sets.join(', ')} WHERE id = $${values.length}`, values);
  if (!n) throw new HttpError(404, 'Not found.');
  return n;
}

export async function getRow(table, id, label = 'Record') {
  const row = (await q(`SELECT * FROM ${table} WHERE id = $1`, [id]))[0];
  if (!row) throw new HttpError(404, `${label} not found.`);
  return row;
}

// Rewrites sort_order for a list of ids in the given order.
export async function reorder(table, ids) {
  if (!Array.isArray(ids)) throw new HttpError(422, 'Send the new order as an array of ids.');
  for (const [i, id] of ids.entries()) await run(`UPDATE ${table} SET sort_order = $1 WHERE id = $2`, [i, id]);
}

export const slugify = (s) =>
  String(s || '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 150);
