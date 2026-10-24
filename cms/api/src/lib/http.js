export class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

// Forwards async errors to the Express error handler.
export const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

export const paging = (query, defaultSize = 25) => {
  const page = Math.max(1, Number(query.page) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(query.pageSize) || defaultSize));
  return { page, pageSize, offset: (page - 1) * pageSize };
};

export const idParam = (req, name = 'id') => {
  const id = Number(req.params[name]);
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, 'Invalid id.');
  return id;
};

export const notFound = (what = 'Record') => new HttpError(404, `${what} not found.`);

// The client's IP, believing X-Forwarded-For only as far as a known proxy vouches for it (see lib/security.js).
export { clientIp } from './security.js';

// CSV with a BOM so Excel opens accented names (ñ) correctly.
export function sendCsv(res, filename, header, rows) {
  const cell = (v) => {
    if (v == null) return '';
    let s = v instanceof Date ? v.toISOString() : String(v);
    // text from the website (names, notes) starting with = + - @ would run as a formula in Excel
    if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const body = [header, ...rows].map((r) => r.map(cell).join(',')).join('\r\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(`﻿${body}`);
}
