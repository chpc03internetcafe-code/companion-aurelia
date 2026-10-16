// Companion portal helpers shared by the portal (/api/companion) and the CMS (/api/companions).
import { one } from '../db/index.js';
import { notify } from '../lib/mailer.js';
import { companionNewRequest } from '../lib/emails.js';

// Profile wording a companion may propose: [key, column, label]. Everything else stays staff-only.
export const DETAIL_FIELDS = [
  ['tagline', 'tagline', 'Tagline'],
  ['bio', 'bio', 'About'],
  ['languages', 'languages', 'Languages'],
  ['nationality', 'nationality', 'Nationality'],
  ['heightCm', 'height_cm', 'Height (cm)'],
];

export const detailsSchema = {
  tagline: { type: 'string', max: 160, label: 'Tagline' },
  bio: { type: 'string', max: 6000, label: 'About' },
  languages: { type: 'string', max: 200, label: 'Languages' },
  nationality: { type: 'string', max: 60, label: 'Nationality' },
  heightCm: { type: 'int', min: 120, max: 230, label: 'Height' },
};

/** Emails the companion about a new booking request, when they have an active portal account. b: SELECT_BOOKING row. */
export async function emailCompanion(site, b) {
  const a = await one(`SELECT ca.email, p.display_name AS name FROM companion_accounts ca JOIN profiles p ON p.id = ca.profile_id
    WHERE ca.profile_id = $1 AND ca.status = 'Active'`, [b.profileId]);
  if (a) await notify(companionNewRequest(site, a, b));
}
