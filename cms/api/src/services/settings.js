// Site settings (key/value), with defaults so new settings never need a schema change.
import { q } from '../db/index.js';
import { cached } from '../lib/cache.js';
import { DEFAULT_THEME } from '../lib/themes.js';

export const defaultSettings = {
  // brand and contact
  siteName: 'Aurelia Companions',
  logoText: 'Aurelia',
  logoSubtext: 'Companions',
  tagline: 'A verified directory of refined, discreet companionship.',
  about: 'A curated, verified directory with clear published rates, live availability and a simple booking request system.',
  email: 'concierge@aurelia.example',
  phone: '',
  messaging: '',            // e.g. "Telegram @aurelia · WhatsApp +63 917 000 0000"
  hours: 'Concierge desk: daily 10:00 AM – 2:00 AM',
  instagramUrl: '',
  xUrl: '',
  telegramUrl: '',
  whatsappUrl: '',
  announcement1: 'Every profile is **ID-verified** and adults only (18+)',
  announcement2: 'Book in 2 minutes — **reference number** and live status updates',
  announcement3: 'Questions? **Chat with our concierge** — bottom right of every page',
  heroTitle: 'Exceptional company, verified and on your schedule.',
  heroText: 'Browse verified profiles by city and availability, see published rates up front, and send a booking request in minutes.',
  theme: DEFAULT_THEME,
  currency: 'PHP',
  // adults-only notice shown before the site opens (remembered per browser)
  ageGateEnabled: '1',
  ageGateText: 'This website contains profiles of adult companions and is intended for adults aged 18 or over. By entering you confirm you are of legal age in your location and agree to our terms.',
  // booking rules
  autoConfirm: '0',           // 1 = online requests are confirmed straight away
  bookingLeadHours: '3',      // earliest online booking from now
  bookingWindowDays: '30',    // how far ahead clients can book
  cancelCutoffHours: '24',    // clients can cancel / reschedule online until this many hours before
  rescheduleLimit: '2',       // online reschedules per booking
  slotMinutes: '30',          // start-time grid
  bufferMinutes: '30',        // gap kept free between two bookings of the same profile
  // live chat widget on the website (answered in CMS → Live chat)
  liveChatEnabled: '1',
  liveChatGreeting: 'Hi! Ask us anything about companions, bookings or VIP membership. Our concierge usually replies within a few minutes during desk hours.',
  bookingPolicy: 'Requests are confirmed by our concierge, usually within an hour during desk hours. You can cancel or reschedule online up to the cut-off shown on your booking. Fees are shown before you confirm and are settled directly as agreed with the concierge.',
  // CMS sign-out after this many minutes without activity (0 = never)
  staffIdleMinutes: '30',     // CMS
  // SEO
  seoTitleSuffix: ' · Aurelia Companions',
  seoDefaultDescription: 'Verified companion directory with published rates, live availability, city guides and online booking requests.',
  seoOgImage: '',
  structuredData: '1',        // JSON-LD for organisation, breadcrumbs, FAQs, articles and profiles
  searchIndexing: '1',        // 0 = ask search engines not to index the site (staging)
};

// Read on almost every request, so cached briefly (cleared whenever settings are saved).
export async function loadSettings() {
  const saved = await cached('settings', 60_000, async () => {
    const rows = await q('SELECT key, value FROM site_settings');
    const out = { ...defaultSettings };
    for (const r of rows) if (r.key in out) out[r.key] = r.value ?? '';
    return out;
  });
  return { ...saved };
}

export const num = (v, fallback) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

/** CMS idle sign-out, in minutes (0 = off). */
export const idleMinutes = (s) => ({ staff: Math.max(0, Math.round(num(s.staffIdleMinutes, 30))) });

/** The parts of the settings the booking rules use, as numbers/booleans. */
export async function bookingRules(settings) {
  const s = settings || (await loadSettings());
  return {
    autoConfirm: s.autoConfirm === '1',
    leadHours: num(s.bookingLeadHours, 3),
    windowDays: num(s.bookingWindowDays, 30),
    cancelCutoffHours: num(s.cancelCutoffHours, 24),
    rescheduleLimit: num(s.rescheduleLimit, 2),
    slotMinutes: [15, 30, 60].includes(num(s.slotMinutes, 30)) ? num(s.slotMinutes, 30) : 30,
    bufferMinutes: num(s.bufferMinutes, 30),
  };
}
