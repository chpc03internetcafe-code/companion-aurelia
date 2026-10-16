// Weekly availability and time off, validated and saved the same way from the CMS and the companion portal.
import { HttpError } from '../lib/http.js';
import { validate } from '../lib/validate.js';
import { isIsoDate, toMin } from '../lib/dates.js';

/** blocks: [{ weekday, start: 'HH:MM', end: 'HH:MM' | '24:00' }] → validated, no overlaps within a day. */
export function parseBlocks(list) {
  if (!Array.isArray(list)) list = [];
  if (list.length > 42) throw new HttpError(422, 'Up to 6 blocks per day.');
  const blocks = list.map((b) => validate(b, {
    weekday: { type: 'int', required: true, min: 0, max: 6 },
    start: { type: 'time', required: true, label: 'Start' },
    end: { type: 'time', required: true, allowMidnight: true, label: 'End', check: (v, x) => (toMin(v) <= toMin(x.start) ? 'End must be after start.' : null) },
  }));
  for (let d = 0; d < 7; d++) {
    const day = blocks.filter((b) => b.weekday === d).sort((a, b) => toMin(a.start) - toMin(b.start));
    for (let i = 1; i < day.length; i++) if (toMin(day[i].start) < toMin(day[i - 1].end)) throw new HttpError(422, 'Two availability blocks on the same day overlap.');
  }
  return blocks;
}

/** items: [{ startDate, endDate, note }] */
export const parseTimeOff = (list) => (Array.isArray(list) ? list : []).slice(0, 50).map((t) => validate(t, {
  startDate: { type: 'date', required: true, label: 'From' },
  endDate: { type: 'date', required: true, label: 'To', check: (v, x) => (isIsoDate(x.startDate) && v < x.startDate ? 'Must be on or after the start.' : null) },
  note: { type: 'string', max: 200 },
}));

/** db = tx helpers */
export async function saveSchedule(db, profileId, blocks) {
  await db.run('DELETE FROM profile_schedules WHERE profile_id = $1', [profileId]);
  for (const b of blocks) await db.run('INSERT INTO profile_schedules (profile_id, weekday, start_time, end_time) VALUES ($1, $2, $3, $4)', [profileId, b.weekday, b.start, b.end]);
  await db.run('UPDATE profiles SET updated_at = now(), last_active_at = now() WHERE id = $1', [profileId]);
}

export async function saveTimeOff(db, profileId, items) {
  await db.run('DELETE FROM profile_time_off WHERE profile_id = $1', [profileId]);
  for (const t of items) await db.run('INSERT INTO profile_time_off (profile_id, start_date, end_date, note) VALUES ($1, $2, $3, $4)', [profileId, t.startDate, t.endDate, t.note]);
  await db.run('UPDATE profiles SET updated_at = now() WHERE id = $1', [profileId]);
}

export const loadSchedule = (db, profileId) => db.q(`SELECT id, weekday, to_char(start_time, 'HH24:MI') AS start,
    CASE WHEN end_time = '24:00' THEN '24:00' ELSE to_char(end_time, 'HH24:MI') END AS end
  FROM profile_schedules WHERE profile_id = $1 ORDER BY weekday, start_time`, [profileId]);
