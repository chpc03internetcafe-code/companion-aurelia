// Display helpers. Dates are shown in Manila time.
let currency = 'PHP';
export const setCurrency = (c) => { currency = c || 'PHP'; };
export const money = (n, whole = false) => (n == null || n === '' ? '—'
  : new Intl.NumberFormat('en-PH', { style: 'currency', currency, minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: whole ? 0 : 2 }).format(Number(n)));
export const duration = (m) => (!m ? '' : m < 60 ? `${m} min` : `${Math.floor(m / 60)} hr${Math.floor(m / 60) > 1 ? 's' : ''}${m % 60 ? ` ${m % 60} min` : ''}`);

const TZ = { timeZone: 'Asia/Manila' };
export const dateTime = (d) => (d ? new Date(d).toLocaleString('en-PH', { ...TZ, month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—');
// DATE columns arrive as 'YYYY-MM-DD'; format them without a timezone shift.
export const day = (d, opts = { month: 'short', day: 'numeric', year: 'numeric' }) =>
  d ? new Date(`${String(d).slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-PH', { ...opts, timeZone: 'UTC' }) : '—';
export const dayLong = (d) => day(d, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
export const time12 = (t) => {
  if (!t) return '';
  if (String(t).startsWith('24:00')) return 'midnight';
  const [h, m] = String(t).split(':').map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
};
export const timeRange = (a, b) => `${time12(a)} – ${time12(b)}`;

/** Today in Manila as YYYY-MM-DD. */
export const todayIso = () => new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
export const addDays = (iso, n) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
export const toMin = (t) => {
  const [h, m] = String(t).split(':').map(Number);
  return h * 60 + m;
};
export const fromMin = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
export const initials = (name = '') => name.split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
export const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const plural = (n, word, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;
