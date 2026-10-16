// Date/time helpers in Philippine time (Asia/Manila, UTC+8, no daylight saving).
const PH_OFFSET_MS = 8 * 3600000;

/** 'YYYY-MM-DD' for today in Manila (or for a given Date). */
export const phDate = (d = new Date()) => new Date(d.getTime() + PH_OFFSET_MS).toISOString().slice(0, 10);

/** Minutes since midnight, Manila time. */
export const phMinutesNow = (d = new Date()) => {
  const t = new Date(d.getTime() + PH_OFFSET_MS);
  return t.getUTCHours() * 60 + t.getUTCMinutes();
};

/** 'YYMMDD' for reference numbers. */
export const phStamp = (d = new Date()) => phDate(d).slice(2).replace(/-/g, '');

export const addDays = (iso, n) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/** 0 = Sunday … 6 = Saturday for a 'YYYY-MM-DD'. */
export const weekday = (iso) => new Date(`${iso}T00:00:00Z`).getUTCDay();

/** 'HH:MM[:SS]' -> minutes since midnight. */
export const toMin = (t) => {
  const [h, m] = String(t).split(':').map(Number);
  return h * 60 + m;
};

/** minutes -> 'HH:MM' */
export const fromMin = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

/** '14:30' -> '2:30 PM' */
export const time12 = (t) => {
  const [h, m] = String(t).split(':').map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
};

/** '2026-10-12' -> 'Mon, Oct 12, 2026' */
export const longDate = (iso) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-PH', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

export const isIsoDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
