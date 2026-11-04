// CMS: site settings — brand and contact details, announcement bar, homepage text, website theme, age notice,
// booking rules and policy, fees shown before confirmation, and the email connection.
import { Router } from 'express';
import { one, q, run } from '../db/index.js';
import { HttpError, idParam, wrap } from '../lib/http.js';
import { insertRow, reorder, updateRow, validate } from '../lib/validate.js';
import { THEME_IDS, THEME_MODES, themeList } from '../lib/themes.js';
import { mailConfigured, sendMail } from '../lib/mailer.js';
import { testEmail } from '../lib/emails.js';
import { geminiConfigured, geminiModel } from '../lib/gemini.js';
import { loadSettings } from '../services/settings.js';

const router = Router();

const url = { type: 'string', max: 300, pattern: /^https?:\/\/\S+$/, patternMessage: 'Enter a full link starting with https://' };
const numberText = (min, max, label) => ({ type: 'string', max: 6, label, check: (v) => (Number.isFinite(Number(v)) && Number(v) >= min && Number(v) <= max ? null : `Enter ${min} to ${max}.`) });
const flag = { type: 'enum', values: ['0', '1'] };
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const deskHours = { type: 'string', max: 600, label: 'Desk hours', check: (v) => {
  let h;
  try { h = JSON.parse(v); } catch { return 'Desk hours are not valid.'; }
  if (!h || typeof h !== 'object' || Array.isArray(h)) return 'Desk hours are not valid.';
  for (const [day, span] of Object.entries(h)) {
    if (!/^[0-6]$/.test(day) || !Array.isArray(span) || span.length !== 2 || !span.every((t) => TIME.test(t))) return 'Use times like 09:00 for every open day.';
    if (span[0] === span[1]) return 'Opening and closing times must differ.';
  }
  return null;
} };
const settingsSchema = {
  siteName: { type: 'string', required: true, max: 120, label: 'Site name' },
  logoText: { type: 'string', required: true, max: 20, label: 'Logo text' },
  logoSubtext: { type: 'string', max: 60 },
  tagline: { type: 'string', max: 250 },
  about: { type: 'string', max: 600 },
  email: { type: 'email' },
  phone: { type: 'string', max: 40 },
  messaging: { type: 'string', max: 200 },
  hours: { type: 'string', max: 200 },
  instagramUrl: url,
  xUrl: url,
  telegramUrl: url,
  whatsappUrl: url,
  announcement1: { type: 'string', max: 140 },
  announcement2: { type: 'string', max: 140 },
  announcement3: { type: 'string', max: 140 },
  heroTitle: { type: 'string', max: 120 },
  heroText: { type: 'string', max: 300 },
  theme: { type: 'enum', values: THEME_IDS, label: 'Theme' },
  themeMode: { type: 'enum', values: THEME_MODES, label: 'Appearance' },
  themeSwitch: flag,
  currency: { type: 'enum', values: ['PHP', 'USD', 'EUR', 'GBP', 'SGD', 'HKD', 'AUD', 'THB'], label: 'Currency' },
  ageGateEnabled: flag,
  ageGateText: { type: 'string', max: 600 },
  liveChatEnabled: flag,
  liveChatGreeting: { type: 'string', max: 400 },
  liveChatHoursEnabled: flag,
  liveChatHours: deskHours,
  liveChatOfflineMessage: { type: 'string', max: 400 },
  liveChatTranscripts: flag,
  liveChatRetentionDays: { type: 'enum', values: ['0', '30', '90', '180', '365'], label: 'Keep chats' },
  liveChatAi: flag,
  liveChatAiWait: { type: 'enum', values: ['0', '30', '60', '120', '300'], label: 'Wait for the desk' },
  liveChatAiInstructions: { type: 'string', max: 2000, label: 'Instructions' },
  autoConfirm: flag,
  bookingLeadHours: numberText(0, 168, 'Lead time'),
  bookingWindowDays: numberText(1, 365, 'Booking window'),
  cancelCutoffHours: numberText(0, 168, 'Cancellation cut-off'),
  rescheduleLimit: numberText(0, 10, 'Reschedule limit'),
  slotMinutes: { type: 'enum', values: ['15', '30', '60'] },
  bufferMinutes: numberText(0, 240, 'Buffer'),
  bookingPolicy: { type: 'string', max: 2000 },
  staffIdleMinutes: numberText(0, 1440, 'Staff idle sign-out'),
  staffTwoStepRequired: flag,
};

const listFees = () => q('SELECT f.*, l.name AS location_name FROM fees f LEFT JOIN locations l ON l.id = f.location_id ORDER BY f.sort_order, f.id');

const everything = async () => ({
  settings: await loadSettings(), themes: themeList(), fees: await listFees(),
  email: { configured: mailConfigured(), sender: process.env.GMAIL_USER || null },
  ai: { configured: geminiConfigured(), model: geminiConfigured() ? geminiModel() : null },
});

router.get('/', wrap(async (_req, res) => res.json(await everything())));

router.put('/', wrap(async (req, res) => {
  const data = validate(req.body, settingsSchema, { partial: true });
  // so whoever turns the rule on has already been through the setup they're asking everyone else to do
  if (data.staffTwoStepRequired === '1' && !req.admin.twoStepEnabled) {
    throw new HttpError(409, 'Turn on two-step sign-in for your own account first (account menu → Two-step sign-in).', { staffTwoStepRequired: 'Set it up for your own account first.' });
  }
  for (const [k, v] of Object.entries(data)) {
    await run('INSERT INTO site_settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()', [k, v ?? '']);
  }
  res.json(await everything());
}));

// Sends a test message (default: to the signed-in staff member).
router.post('/email/test', wrap(async (req, res) => {
  const to = String(req.body.to || req.admin.email || '').trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) throw new HttpError(422, 'Enter a valid email address.', { to: 'Enter a valid email address.' });
  try {
    await sendMail({ ...testEmail(await loadSettings()), to });
  } catch (err) {
    throw new HttpError(502, `Sending failed: ${err.message}`);
  }
  res.json({ sent: true, to });
}));

// ---------- Fees ----------
const feeSchema = {
  name: { type: 'string', required: true, max: 80, label: 'Name' },
  description: { type: 'string', max: 300 },
  feeType: { type: 'enum', values: ['fixed', 'percent'], default: 'fixed' },
  amount: { type: 'decimal', required: true, min: 0, label: 'Amount', check: (v, b) => (b.feeType === 'percent' && v > 100 ? 'Up to 100%.' : null) },
  locationId: { type: 'int', min: 1 },
  isActive: { type: 'bool', default: true },
};

router.post('/fees', wrap(async (req, res) => {
  const { n } = await one('SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM fees');
  const id = await insertRow('fees', feeSchema, validate(req.body, feeSchema), { sort_order: n });
  res.status(201).json({ id, fees: await listFees() });
}));
router.put('/fees', wrap(async (req, res) => {
  await reorder('fees', req.body.order);
  res.json(await listFees());
}));
router.put('/fees/:id', wrap(async (req, res) => {
  await updateRow('fees', feeSchema, idParam(req), validate(req.body, feeSchema));
  res.json(await listFees());
}));
router.patch('/fees/:id', wrap(async (req, res) => {
  await updateRow('fees', feeSchema, idParam(req), validate(req.body, { isActive: feeSchema.isActive }, { partial: true }));
  res.json(await listFees());
}));
// Bookings keep the fees they were quoted, so deleting a fee never changes past bookings.
router.delete('/fees/:id', wrap(async (req, res) => {
  if (!(await run('DELETE FROM fees WHERE id = $1', [idParam(req)]))) throw new HttpError(404, 'Fee not found.');
  res.status(204).end();
}));

export default router;
