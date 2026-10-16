// Display helpers. Booking dates and times are Manila wall-clock values.
let currency = 'PHP';
export const setCurrency = (c) => { currency = c || 'PHP'; };
export const money = (n) => new Intl.NumberFormat('en-PH', { style: 'currency', currency, maximumFractionDigits: Number(n) % 1 ? 2 : 0 }).format(Number(n) || 0);

// 'YYYY-MM-DD' → formatted without a timezone shift
export const day = (iso, opts = { month: 'short', day: 'numeric', year: 'numeric' }) =>
  iso ? new Date(`${String(iso).slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-PH', { ...opts, timeZone: 'UTC' }) : '';
export const dayLong = (iso) => day(iso, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
export const dayShort = (iso) => day(iso, { weekday: 'short', month: 'short', day: 'numeric' });
export const dateTime = (d) => (d ? new Date(d).toLocaleString('en-PH', { timeZone: 'Asia/Manila', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '');
export const time12 = (t) => {
  if (!t) return '';
  if (t === '24:00') return 'midnight';
  const [h, m] = String(t).split(':').map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
};
export const todayIso = () => new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
export const addDays = (iso, n) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
export const weekday = (iso) => new Date(`${iso}T00:00:00Z`).getUTCDay();
export const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const WEEKDAYS_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const duration = (m) => {
  if (!m) return '';
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return `${h} hr${h > 1 ? 's' : ''}${m % 60 ? ` ${m % 60} min` : ''}`;
};

const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
export function timeAgo(d) {
  if (!d) return '';
  const s = (new Date(d).getTime() - Date.now()) / 1000;
  for (const [unit, secs] of [['year', 31536000], ['month', 2592000], ['week', 604800], ['day', 86400], ['hour', 3600], ['minute', 60]]) {
    if (Math.abs(s) >= secs) return rtf.format(Math.round(s / secs), unit);
  }
  return 'just now';
}

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
/** "**bold**" markup from the CMS announcement bar → safe HTML. */
export const boldHtml = (s) => String(s || '').replace(/[&<>"']/g, (c) => ESC[c]).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
export const initials = (name = '') => name.split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
