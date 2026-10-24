# Aurelia Companions: directory website, booking requests, VIP portal & CMS

A verified companion directory with published rates, live availability, online booking requests, a VIP member portal and a staff CMS. It uses the same architecture as `D:\DENTAL_v2`.

| App | Folder | Port | What it is |
| --- | --- | --- | --- |
| **Website + member portal** | `./` (`src/`) | 5173 | Homepage, directory with filters, profile pages, booking wizard, booking status, locations, guides, VIP page, member account |
| **CMS (staff)** | `cms/admin` | 5180 | Bookings, profiles, members & memberships, locations & categories, VIP tiers & collections, content, SEO & redirects, settings, users & roles, audit trail |
| **API** | `cms/api` | 4000 | Node + Express REST API on PostgreSQL (Supabase), or an embedded PostgreSQL (PGlite) when no database is configured |

The brand name, colours, texts and rules are all set in the CMS (Site Settings). "Aurelia" is only the placeholder.

## Quick start

You need Node 20.12 or newer (22 is recommended). You don't need to install a database.

```bash
npm run setup      # installs the website, API and CMS
npm run dev:all    # starts all three
```

- Website: http://localhost:5173
- CMS: http://localhost:5180
- API: http://localhost:4000/api/health

On its first start, the API creates the database in `cms/api/data/` and loads **demo data**:
- 3 categories
- 6 cities with 16 service areas
- 3 VIP tiers
- 14 profiles (one draft, one VIP-only for Gold members, one Silver, one retired), with generated placeholder portraits, rates, weekly availability and time off
- booking fees
- 14 members, including pending membership requests
- about 60 bookings (past and upcoming)
- pages, guides, FAQs, redirects and contact messages

Dates are relative to today, so availability and the dashboard always look current.

### Demo sign-ins

| Who | Email | Password |
| --- | --- | --- |
| Member (Gold VIP) | `demo@aurelia.example` | `password` |
| Companion portal (`/companion`) | `companion@aurelia.example` | `password` |
| CMS: Administrator | `admin@aurelia.example` | `aurelia2026` |
| CMS: Manager | `manager@aurelia.example` | `aurelia2026` |
| CMS: Booking Coordinator | `bookings@aurelia.example` | `aurelia2026` |
| CMS: Profile Editor | `profiles@aurelia.example` | `aurelia2026` |
| CMS: Membership Manager | `members@aurelia.example` | `aurelia2026` |
| CMS: Content Editor | `content@aurelia.example` | `aurelia2026` |

Demo staff accounts are only created outside production. **Change or delete them before going live.**

### Useful commands (in `cms/api`)

```bash
npm run db:reset      # drop everything and reload demo data (local only)
npm run db:seed       # load demo data into an empty database
npm run db:init       # create missing tables/roles/settings (safe to re-run)
npm run test:smoke    # 16 end-to-end API checks (stop the dev server first when using the embedded DB)
npm run admin:list    # list staff accounts
npm run admin:reset -- someone@example.com   # print a new temporary password
```

> **Careful:** every command above uses `DATABASE_URL` from `cms/api/.env`. If that points at Supabase, `db:reset` wipes it and `test:smoke` writes test records and sends real email. To test locally, blank those variables for the command, e.g. `DATABASE_URL= GMAIL_USER= GMAIL_APP_PASSWORD= npm run test:smoke`.

## Features

### 1. Homepage
- Hero with search by city/area, category and "available today".
- Featured profiles and recently updated profiles.
- Counts for profiles, verified profiles, available today and cities.
- Category tiles and popular locations (each location's "Popular" flag is set in the CMS).
- "How it works" steps, a VIP call-to-action, the latest guides and the homepage FAQs.
- A rotating announcement bar, plus "Available today" and contact buttons.
- An adults-only (18+) notice on first visit. It can be switched on or off in Settings.

### 2. Profile directory
- Separate category pages at `/female`, `/male` and `/transgender`. Categories, their URLs and their texts are editable.
- Standard profile pages showing:
  - photo gallery with videos (YouTube, Vimeo or MP4)
  - biography, languages, location and service areas
  - a list of facts
  - weekly availability and time off
  - published rates with session lengths
  - verified badge, "last updated" date and "available today"
  - similar profiles
- Favourites: saved in the browser for guests and in the account for members (merged when they sign in).
- Sharing via the phone's share sheet, copy link, WhatsApp, Telegram, X or email.

### 3. Search & filters
- Filters: location (the city includes its areas and the profiles that serve them), category, budget (presets or min/max), session length, available today / tomorrow / a chosen date, verified, featured, VIP-only (members), and text search.
- Sort by featured, newest, recently active, or price.
- Filters are kept in the URL, so filtered views can be shared and bookmarked.

### 4. Booking requests & inquiries
- The wizard has three steps: choose a published session, pick an open date and time, then enter details.
- Only times that really fit are offered. A time has to:
  - fit inside the weekly hours
  - avoid time off and "away" dates
  - fall within the lead time and booking window
  - not overlap another booking, with a buffer kept between bookings
- The rate and **applicable fees are shown before confirming**. Fees can be fixed or a percentage, and can apply to every booking or one location.
- The client gets a reference number right away and email updates.
- The status page (reference + email) shows a timeline, and the client can **cancel or reschedule online** before the cut-off, up to the reschedule limit.
- "Send an inquiry" is for questions about a profile; the date is optional.
- Optional settings: auto-confirm, and members-only booking.
- No online payment at launch. Fees are settled with the concierge.

### 5. VIP member portal
- Registration with email confirmation and a date of birth check (18+), sign-in, and password reset.
- Account pages: overview with a member card, bookings, favourites, VIP collections, membership, details and security.
- Tiers have an access level (rank). A member's tier controls:
  - VIP-only profiles (hidden from the directory and sitemap for everyone else)
  - private photos and videos
  - collections
  - members-only articles
- These rules are applied on the server: locked media URLs are never sent to the browser.
- Membership requests: the member chooses a tier and enters a payment reference, then staff approve or reject it in the CMS.
- Renewals extend from the current expiry date. Upgrades start the same day.
- Staff can grant memberships, end them, and send renewal reminders by email.
- Security: list of signed-in devices with "sign out this device" and "sign out all other devices". Changing the password signs out other devices. Sessions use httpOnly cookies stored as SHA-256 hashes.

- Two-step sign-in with an authenticator app (Google Authenticator, Microsoft Authenticator, Authy…): QR code setup, 10 one-time backup codes, and a staff reset in the CMS for members who lose their phone.

### Companion portal (`/companion`)
- Staff invite a companion from **CMS → Profiles → (profile) → Portal access**. The companion gets an email link to choose a password (valid 72 hours). One sign-in per profile.
- **Booking requests:** companions see their own requests (date, session, area, client first name and notes, never client email or phone) and accept or decline them. The client is emailed and staff are notified. Companions are emailed when a new request arrives.
- **Availability (live straight away):** weekly hours, time off, and "away until".
- **Profile updates (staff approve first):** tagline, about, languages, nationality, height and new photos go to **CMS → Profile updates**, which shows current and proposed text side by side. Approving publishes the change; rejecting emails the companion the reason.
- Same security as members: password change, two-step sign-in, signed-in devices. Staff can pause access, reset two-step, sign out devices or remove access.

### 6. Content & SEO
- Location landing pages for cities and areas, each with an intro, image, content sections and its directory.
- Content pages (About, Verification & safety, Booking policy, Terms, Privacy).
- Guides, announcements and member news. Each can be public or members-only (with a minimum tier) and can be linked to a location.
- FAQs with groups and "show on homepage".
- Every profile, location, category, page and article has its own **URL, page title and meta description**. Editors see a length counter and a search-result preview.
- Alt text on every photo and cover image.
- Structured data (JSON-LD): Organization, WebSite, BreadcrumbList, FAQPage, Article, ProfilePage and CollectionPage. It can be switched off.
- Canonical URLs and Open Graph tags.
- `sitemap.xml` and `robots.txt`, with a switch to stop search engines indexing the site (for a staging copy).
- **Redirects**: managed in the CMS, with visit counts and loop protection.
  - They are added automatically when a profile, location, page or article URL changes.
  - Retired profiles can redirect anywhere. Without a redirect, they show a "no longer available" page with similar profiles.
- The SEO health check lists missing titles, descriptions, alt text and retired profiles without redirects.

### CMS (staff)
| Section | What staff can do |
| --- | --- |
| **Dashboard** | Today's bookings, requests waiting for a reply, requests over 14 days, last 30 days, most requested profiles, profile and member health |
| **Bookings** | List with filters and CSV export; detail with Confirm / Decline / Cancel / Complete / No-show / Reopen; messages to the client (shown on their status page and optionally emailed) or internal notes; reschedule with live slots or a staff override (never double-books); new phone or messaging bookings |
| **Profiles** | Details and facts, service areas, government-ID (18+) check required before publishing, verified badge, status, featured, VIP tier, online booking on/off, away dates; photo upload (main photo, VIP-only, alt text, ordering), video links; rates; weekly availability and time off; SEO fields; retire / restore / delete |
| **Members** | List, CSV export, approval queue, member detail (memberships, bookings, favourites, devices), grant / renew / end membership, password link, suspend |
| **Locations & categories** | City and area tree with landing-page editor and image; popular and published flags; categories with their own SEO |
| **VIP tiers & collections** | Tiers (price, length, access level, perks, colour, listed or unlisted); collections with a profile picker and ordering |
| **Content & FAQs** | Page and article editors with live preview, cover images, members-only audience; FAQs |
| **SEO & redirects** | Health check, redirects, SEO defaults |
| **Messages** | Contact form messages |
| **Site settings** | Brand and contact details, currency, homepage hero, announcement bar, 18+ notice, 6 website themes, booking rules and policy, member payment instructions, fees, email test |
| **Users, roles, audit trail, notifications** | Same as DENTAL_v2: role permissions (No access / View / Manage per section) with 6 starter roles; full audit trail with before → after values; live notifications for booking requests, cancellations, reschedules, membership requests, new members and messages |

### Safeguards built in
- Profiles must be 18 or over. The database rejects a lower age, and publishing requires the ID check (database constraint).
- Members must be 18 or over to register. Booking requires confirming 18+ and accepting the policy.
- Wording throughout: "rates are for time and companionship only".
- A "Profile correction or removal" contact subject for reporting concerns.
- Rate limits on sign-in, registration, booking and contact. Honeypot fields on public forms. The role is checked on every CMS request.

## Configuration (add later)
Copy `cms/api/.env.example` to `cms/api/.env`. Everything is optional for local development:
- **Supabase:** `DATABASE_URL`, plus `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` and `SUPABASE_BUCKET` for photo storage (the bucket is created on first upload).
- **Gmail sending:** `GMAIL_USER`, `GMAIL_APP_PASSWORD` (an app password) and `MAIL_FROM_NAME`. Without them, emails are skipped and logged, and in development the account screens show confirmation/reset links directly.
- **Site:** `SITE_URL` (used in email links and the sitemap) and `ADMIN_SETUP_KEY` (for the first admin on a hosted deployment).

## Deploying (Vercel + Supabase)
1. Create a Supabase project. Put its connection string in `cms/api/.env` as `DATABASE_URL` and run `npm run db:init` from `cms/api`. Also run `npm run db:seed` if you want the demo content.
2. **Website + API project** (root directory `./`):
   - Set `DATABASE_URL` (Transaction pooler, port 6543), `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `ADMIN_SETUP_KEY`, `GMAIL_USER`, `GMAIL_APP_PASSWORD` and `SITE_URL`.
   - `api/index.js` serves the API at `/api`.
   - `vercel.json` also routes `/sitemap.xml` and `/robots.txt` to the API.
3. **CMS project** (root directory `cms/admin`):
   - Replace `YOUR-WEBSITE-PROJECT` in `cms/admin/vercel.json` with the website project's URL.
   - Optionally set `VITE_WEBSITE_URL`.
4. Open the CMS. With no staff accounts, it shows a one-time setup screen that asks for `ADMIN_SETUP_KEY`.

The embedded database is for local development only. The API refuses to start on Vercel without `DATABASE_URL`.

## Performance
- **CDN and load balancing:** on Vercel, the edge network serves the built files and the platform runs as many API instances as traffic needs. `vercel.json` caches hashed `/assets/*` for a year. Public API responses that are the same for everyone (bootstrap, pages, categories, locations) are cached at the CDN for 30 s (`s-maxage`). Uploaded images are named uniquely and cached for a year. `CDN_URL` (website build) serves JS/CSS from a separate CDN host if you use one.
- **Self-hosting:** `WEB_CONCURRENCY=4` (or `auto`) runs that many API workers behind Node's cluster balancer, which restarts crashed workers. This needs `DATABASE_URL`; the embedded database runs one process. Use `GET /api/health` as the load-balancer health check.
- **Database:** connection pooling through `pg.Pool` (`PG_POOL_MAX`, default 10, or 3 on Vercel). On Vercel, use Supabase's transaction pooler (port 6543). Indexes for the busy filters, sorts and foreign keys are in `schema.sql` / `supabase-setup.sql`; re-run it on an existing database to add them.
- **Server cache:** site settings, the website bootstrap, homepage lists, sitemap and CMS option lists are kept in memory for 30 s to 5 min (`cms/api/src/lib/cache.js`). Any successful save clears this cache on the instance that handled it, so other instances can show old values until their copy expires.
- **Payloads and images:** API responses over 1 KB are gzip/brotli compressed. Uploaded photos are resized to at most 1600 px, converted to WebP and stripped of metadata (`sharp`).
- **Front end:** each page is its own chunk (React and the router in a long-cached `vendor` chunk). JS, CSS and HTML are minified in production builds. Images below the fold load lazily. Web fonts don't block the first paint. Loading skeletons show while content loads, search inputs are debounced, and long lists are paginated.
- **Audit:** `npm run build`, `npm run preview` (with the API running), then `npm run lighthouse` (or `npm run lighthouse -- https://your-site`). It needs Chrome. Reports go to `lighthouse-reports/`. `LH_PRESET=desktop` runs the desktop profile.

## Security
- **Sessions:** httpOnly, SameSite=Lax cookies (members, companions, staff); only a SHA-256 of each token is stored. Nothing secret is kept in `localStorage`/`sessionStorage`; a guest's booking reference + email is kept in memory only.
- **Passwords:** scrypt (N=2^16, r=8, p=2) with a random salt. Older hashes are upgraded at the next sign-in. Common passwords and passwords containing the email are refused. Unknown emails take as long to check as wrong passwords.
- **Rate limits:** sign-in (per IP + email and per account), sign-up, password reset, booking lookup, booking and contact forms are counted in the `rate_limits` table, shared by every instance. A per-IP ceiling (`RATE_LIMIT_READS`/`RATE_LIMIT_WRITES` per minute) applies to all API calls. Set `TRUST_PROXY` when self-hosting behind a proxy.
- **Database:** every query uses `$n` parameters. Row level security is on for every table with no policies, and Supabase's `anon`/`authenticated` roles have no grants. The API connects as the owner. Re-run `supabase-setup.sql` on an existing database to apply this.
- **Permissions:** checked on the server for every request (CMS role per section, member/companion ownership). Changes from other websites are refused (Origin check), and CORS allows only `CORS_ORIGIN`.
- **Input:** schema validation on every form (text only for text fields, control characters removed, strict email syntax). At sign-up, the email domain must be able to receive mail (`EMAIL_DNS_CHECK`), and the account exists only once the emailed link is opened. CSV exports neutralise formulas.
- **Uploads:** JPG/PNG/WEBP only, checked from the file's bytes, at most 4 MB and 40 megapixels. Every image is decoded and re-encoded, which strips metadata and anything hidden in the file.
- **XSS:** React escapes all content. Production builds add a Content Security Policy (own scripts only). The API and pages send `nosniff`, `X-Frame-Options: DENY`, HSTS and a referrer policy.
- **Production:** generic error messages, no stack traces or SQL in responses, `x-powered-by` off, no source maps. Email links are shown on screen only on a developer's machine (embedded database, or `SHOW_DEV_LINKS=1`). Logs mask email addresses and never contain passwords, tokens or two-step secrets (also stripped from the audit trail).
- **Encrypted messages:** booking chats (client, companion, concierge), timeline messages and notes, and the client's note on a booking request are stored with AES-256-GCM (`cms/api/src/lib/encryption.js`). Only the server, holding `MESSAGE_ENCRYPTION_KEY`, can read them; the database, its backups and the Supabase dashboard show ciphertext. Use the same key locally and on Vercel, and keep a copy: without it the messages can't be recovered. `npm run db:encrypt-messages` encrypts older plain-text rows and re-encrypts after a key change (old key in `MESSAGE_ENCRYPTION_KEYS_OLD`).
- **Secrets:** only in environment variables on the server (`cms/api/.env` locally, Vercel settings when deployed). None are sent to the browser.
- **Webhooks:** none are received yet. `cms/api/src/lib/webhooks.js` verifies HMAC-SHA256 signatures with a time window and replay check; mount new webhooks under `/api/webhooks/`.
- **Dependencies:** `npm audit` reports no known vulnerabilities in the website, API or CMS. Re-check with `npm audit` in each folder.

## Project layout
```
src/                 website + member portal (React + Vite): pages/, components/, context/, utils/ (api, seo, theme, format)
api/index.js         Vercel entry for the API
cms/api/src/
  app.js             routes, permissions, error handling
  db/                schema.sql, database driver (pg / PGlite), init, seed (+ placeholder portraits), smoke test
  lib/               auth (members), admin-auth (staff roles), audit, notifications, emails, storage, themes, validation
  services/          availability, bookings, profiles (directory search + VIP rules), members (memberships), settings
  routes/            site (public), account (member portal), and one file per CMS section
cms/admin/src/       CMS (React + Vite): pages/, components/ (kit, sections editor, layout), lib/
scripts/dev.js       runs all three apps
```

## Not included yet
- Online payments: booking fees and memberships are settled offline, using a payment reference that staff check.
- Server-side rendering: titles, descriptions and JSON-LD are set in the browser. Google renders JavaScript, but some other crawlers and link previews only see the defaults in `index.html`.
- Server-side 301 responses: redirects are followed by the website itself. For true HTTP 301s on Vercel, add the important ones to `vercel.json`.
- SMS or messaging-app notifications.
