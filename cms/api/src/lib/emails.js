// Client, member and staff emails. Each builder returns { to, subject, html, text } for `notify`.
// Wording stays discreet: subjects never include profile names.
import { longDate, time12 } from './dates.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export const money = (n, currency = 'PHP') => new Intl.NumberFormat('en-PH', { style: 'currency', currency, maximumFractionDigits: 2 }).format(Number(n || 0));
export const siteUrl = () => (process.env.SITE_URL || '').replace(/\/+$/, '');
const firstName = (name) => String(name || '').trim().split(/\s+/)[0] || 'there';

// Plain, table-based card that renders in Gmail, Outlook and phone mail apps.
function layout(site, { heading, intro, body = '', cta, footnote }) {
  const contact = [site.email, site.phone, site.messaging].filter(Boolean).map(esc).join(' · ');
  const button = cta?.url
    ? `<p style="margin:24px 0 8px"><a href="${esc(cta.url)}" style="background:#d4af6a;color:#17130b;text-decoration:none;padding:12px 24px;border-radius:999px;display:inline-block;font-weight:700">${esc(cta.label)}</a></p>`
    : '';
  return `<!doctype html><html><body style="margin:0;background:#f3efe7;font-family:Arial,Helvetica,sans-serif;color:#231d18">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3efe7;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#fff;border-radius:14px;overflow:hidden">
<tr><td style="background:#111114;color:#d4af6a;padding:20px 28px;font-size:20px;font-weight:700;letter-spacing:.04em">${esc(site.siteName)}</td></tr>
<tr><td style="padding:28px">
<h1 style="margin:0 0 12px;font-size:22px;color:#111114">${esc(heading)}</h1>
<p style="margin:0 0 16px;line-height:1.55">${intro}</p>
${body}${button}
${footnote ? `<p style="margin:20px 0 0;color:#7d7266;font-size:13px;line-height:1.5">${footnote}</p>` : ''}
</td></tr>
<tr><td style="padding:16px 28px;background:#faf7f1;color:#7d7266;font-size:12px;line-height:1.5">${contact || esc(site.siteName)}<br>This is an automated message. Reply to this email if you need help.</td></tr>
</table></td></tr></table></body></html>`;
}

const rows = (pairs) => `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;margin:8px 0 16px;font-size:14px">${pairs
  .filter(([, v]) => v !== '' && v != null)
  .map(([k, v]) => `<tr><td style="padding:5px 14px 5px 0;color:#7d7266;white-space:nowrap;vertical-align:top">${esc(k)}</td><td style="padding:5px 0">${esc(v)}</td></tr>`)
  .join('')}</table>`;

const text = (lines) => lines.filter((l) => l != null && l !== false).join('\n');
const pairsText = (pairs) => pairs.filter(([, v]) => v !== '' && v != null).map(([k, v]) => `${k}: ${v}`);
const quote = (s) => `<blockquote style="margin:0 0 16px;padding:12px 16px;background:#faf7f1;border-left:3px solid #d4af6a;white-space:pre-wrap">${esc(s)}</blockquote>`;

// ---------- Bookings ----------
// b: publicBooking() shape + clientEmail
const bookingPairs = (b, currency) => [
  ['Reference', b.reference],
  ['Companion', b.profile?.name],
  b.kind === 'Booking' ? ['Session', b.rateLabel] : null,
  ['Date', b.date ? `${longDate(b.date)}${b.time ? `, ${time12(b.time)}` : ''}` : (b.kind === 'Inquiry' ? 'Not set' : '')],
  ['Location', [b.locationName, b.meetingPlace].filter(Boolean).join(' — ')],
  b.kind === 'Booking' ? ['Rate', money(b.ratePrice, currency)] : null,
  ...(b.kind === 'Booking' ? (b.fees || []).map((f) => [f.name, money(f.amount, currency)]) : []),
  b.kind === 'Booking' ? ['Total', money(b.total, currency)] : null,
].filter(Boolean);
const statusLink = (b) => (siteUrl() ? { label: 'View your booking status', url: `${siteUrl()}/booking-status/${encodeURIComponent(b.reference)}` } : null);

export function bookingReceived(site, b, to) {
  const inquiry = b.kind === 'Inquiry';
  const confirmed = b.status === 'Confirmed';
  const heading = inquiry ? 'We received your inquiry' : confirmed ? 'Your booking is confirmed' : 'We received your booking request';
  return {
    to,
    subject: `${heading} — ${b.reference}`,
    html: layout(site, {
      heading,
      intro: inquiry
        ? `Hi ${esc(firstName(b.clientName))}, thank you for your message. Our concierge will reply shortly using your preferred contact method.`
        : confirmed
          ? `Hi ${esc(firstName(b.clientName))}, your booking is confirmed. The details are below.`
          : `Hi ${esc(firstName(b.clientName))}, thank you. Our concierge will review your request and confirm it shortly. You’ll get an email as soon as the status changes.`,
      body: rows(bookingPairs(b, site.currency)),
      cta: statusLink(b),
      footnote: esc(site.bookingPolicy || ''),
    }),
    text: text([`Hi ${firstName(b.clientName)},`, heading, '', ...pairsText(bookingPairs(b, site.currency)), statusLink(b)?.url]),
  };
}

const STATUS_COPY = {
  Confirmed: ['Your booking is confirmed', 'Good news: your booking has been confirmed.'],
  Declined: ['We couldn’t accept your request', 'Unfortunately we can’t accept this request. You are welcome to choose another time or companion.'],
  Cancelled: ['Your booking was cancelled', 'Your booking has been cancelled.'],
  Completed: ['Thank you', 'Thank you for booking with us. We hope to see you again soon.'],
  Answered: ['We replied to your inquiry', 'Our concierge has replied to your inquiry.'],
  Rescheduled: ['Your booking has a new time', 'Your booking has been moved. The new details are below.'],
};

export function bookingStatusChanged(site, b, to, { status, message } = {}) {
  const copy = STATUS_COPY[status || b.status];
  if (!copy) return null;
  const reason = (status || b.status) === 'Cancelled' && b.cancelReason ? ` Reason: ${esc(b.cancelReason)}` : '';
  return {
    to,
    subject: `${copy[0]} — ${b.reference}`,
    html: layout(site, {
      heading: copy[0],
      intro: `Hi ${esc(firstName(b.clientName))}, ${copy[1]}${reason}`,
      body: (message ? quote(message) : '') + rows(bookingPairs(b, site.currency)),
      cta: ['Declined', 'Cancelled'].includes(status || b.status) ? (siteUrl() ? { label: 'Browse companions', url: `${siteUrl()}/companions` } : null) : statusLink(b),
    }),
    text: text([`Hi ${firstName(b.clientName)},`, copy[1], message, '', ...pairsText(bookingPairs(b, site.currency)), statusLink(b)?.url]),
  };
}

/** A message from the concierge about a booking (shown on the status page too). */
export function bookingMessage(site, b, to, message) {
  return {
    to,
    subject: `Message about your booking ${b.reference}`,
    html: layout(site, { heading: 'A message from our concierge', intro: `Hi ${esc(firstName(b.clientName))},`, body: quote(message) + rows(bookingPairs(b, site.currency)), cta: statusLink(b) }),
    text: text([`Hi ${firstName(b.clientName)},`, '', message, '', statusLink(b)?.url]),
  };
}

export function bookingToDesk(site, b, to) {
  return {
    to,
    replyTo: b.clientEmail,
    subject: `[${b.kind === 'Inquiry' ? 'Inquiry' : 'Booking request'}] ${b.reference}`,
    html: layout(site, {
      heading: `${b.kind === 'Inquiry' ? 'New inquiry' : 'New booking request'} ${b.reference}`,
      intro: 'A new request arrived from the website. Open the CMS to confirm or reply.',
      body: rows([['Client', b.clientName], ['Email', b.clientEmail], ['Phone', b.clientPhone], ['Contact by', b.preferredContact], ...bookingPairs(b, site.currency)]) + (b.notes ? quote(b.notes) : ''),
    }),
    text: text([`${b.reference} from ${b.clientName} <${b.clientEmail}>`, ...pairsText(bookingPairs(b, site.currency)), b.notes]),
  };
}

// ---------- Contact messages ----------
export function inquiryReceipt(site, i) {
  return {
    to: i.email,
    subject: `We got your message — ${i.reference}`,
    html: layout(site, {
      heading: 'Thanks for reaching out',
      intro: `Hi ${esc(firstName(i.name))}, we received your message and will get back to you as soon as possible.`,
      body: rows([['Reference', i.reference], ['Subject', i.subject]]) + quote(i.message),
    }),
    text: text([`We received your message (${i.reference}).`, '', i.message]),
  };
}

export function inquiryToDesk(site, i, to) {
  return {
    to,
    replyTo: i.email,
    subject: `[Website message] ${i.subject} — ${i.name}`,
    html: layout(site, {
      heading: `New message ${i.reference}`,
      intro: 'A new message arrived from the website contact form. Reply to this email to answer directly.',
      body: rows([['Name', i.name], ['Email', i.email], ['Phone', i.phone], ['Subject', i.subject]]) + quote(i.message),
    }),
    text: text([`From: ${i.name} <${i.email}> ${i.phone || ''}`, `Subject: ${i.subject}`, '', i.message]),
  };
}

// ---------- Member accounts ----------
export function verifyEmail(site, { name, email, url }) {
  return {
    to: email,
    subject: `Confirm your email — ${site.siteName}`,
    html: layout(site, {
      heading: 'Confirm your email',
      intro: `Hi ${esc(firstName(name))}, please confirm your email to open your member account, where you can manage bookings, keep favourites and request VIP membership.`,
      cta: { label: 'Confirm my email', url },
      footnote: 'This link works once and expires in 24 hours. If you didn’t sign up, you can ignore this email.',
    }),
    text: text(['Confirm your email to open your member account:', url]),
  };
}

export function passwordReset(site, { name, email, url }) {
  return {
    to: email,
    subject: `Reset your password — ${site.siteName}`,
    html: layout(site, {
      heading: 'Reset your password',
      intro: `Hi ${esc(firstName(name))}, use the button below to choose a new password.`,
      cta: { label: 'Reset password', url },
      footnote: 'This link works once and expires in 2 hours. If you didn’t ask for this, you can ignore this email.',
    }),
    text: text(['Reset your password:', url]),
  };
}

export function passwordChanged(site, { name, email }) {
  return {
    to: email,
    subject: `Your password was changed — ${site.siteName}`,
    html: layout(site, { heading: 'Password changed', intro: `Hi ${esc(firstName(name))}, the password for your member account was just changed and other devices were signed out. If this wasn’t you, contact us right away.` }),
    text: 'Your member account password was changed. If this was not you, contact us.',
  };
}

export function twoStepChanged(site, { name, email, enabled, byStaff = false }) {
  const what = enabled ? 'turned on' : 'turned off';
  return {
    to: email,
    subject: `Two-step sign-in ${what} — ${site.siteName}`,
    html: layout(site, {
      heading: `Two-step sign-in ${what}`,
      intro: enabled
        ? `Hi ${esc(firstName(name))}, signing in to your member account now also needs a code from your authenticator app. Keep your backup codes somewhere safe.`
        : `Hi ${esc(firstName(name))}, two-step sign-in was ${byStaff ? 'reset by our team at your request' : 'turned off'} for your member account, so only your password is needed to sign in. If this wasn’t you, contact us right away.`,
    }),
    text: `Two-step sign-in was ${what} for your member account. If this was not you, contact us.`,
  };
}

// ---------- Companion portal ----------
const portalLink = (path = '') => `${siteUrl() || 'http://localhost:5173'}/companion${path}`;

export function companionInvite(site, { name, email, url }) {
  return {
    to: email,
    subject: `Your companion portal access — ${site.siteName}`,
    html: layout(site, {
      heading: 'Set up your companion portal',
      intro: `Hi ${esc(firstName(name))}, our team has given you access to the companion portal. There you can answer booking requests, keep your availability up to date and send profile updates for review.`,
      cta: { label: 'Choose my password', url },
      footnote: 'This link works once and expires in 72 hours. If you weren’t expecting this, you can ignore this email.',
    }),
    text: text(['Set up your companion portal by choosing a password:', url]),
  };
}

// a: { name, email }, b: booking row (SELECT_BOOKING shape)
export function companionNewRequest(site, a, b) {
  const pairs = [['Reference', b.reference], ['Session', b.rateLabel], ['Date', b.bookingDate ? `${longDate(b.bookingDate)}, ${time12(b.startTime)}` : 'Not set'],
    ['Location', [b.locationName, b.meetingPlace].filter(Boolean).join(' — ')]];
  return {
    to: a.email,
    subject: `New booking request ${b.reference} — ${site.siteName}`,
    html: layout(site, {
      heading: 'New booking request',
      intro: `Hi ${esc(firstName(a.name))}, you have a new request. Please accept or decline it in the portal.`,
      body: rows(pairs),
      cta: { label: 'Open the companion portal', url: portalLink('/bookings') },
    }),
    text: text(['New booking request:', ...pairsText(pairs), '', portalLink('/bookings')]),
  };
}

export function companionChangeDecided(site, a, { kind, approved, note }) {
  const what = kind === 'photo' ? 'new photo' : 'profile update';
  return {
    to: a.email,
    subject: `Your ${what} was ${approved ? 'approved' : 'not approved'} — ${site.siteName}`,
    html: layout(site, {
      heading: approved ? `Your ${what} is live` : `Your ${what} wasn’t approved`,
      intro: approved
        ? `Hi ${esc(firstName(a.name))}, our team approved your ${what} and it now shows on your profile.`
        : `Hi ${esc(firstName(a.name))}, our team couldn’t approve your ${what} this time.`,
      body: note ? quote(note) : '',
      cta: { label: 'Open the companion portal', url: portalLink('/profile') },
    }),
    text: text([`Your ${what} was ${approved ? 'approved' : 'not approved'}.`, note || null, portalLink('/profile')]),
  };
}

// ---------- Memberships ----------
// ms: { membershipNo, tierName, kind, amount, startsOn, endsOn, staffNote }
export function membershipRequested(site, m, ms) {
  return {
    to: m.email,
    subject: `Membership request received — ${ms.membershipNo}`,
    html: layout(site, {
      heading: 'We received your membership request',
      intro: `Hi ${esc(firstName(m.fullName))}, thank you. We’ll activate your ${esc(ms.tierName)} membership as soon as we’ve checked your payment.`,
      body: rows([['Request', ms.membershipNo], ['Tier', ms.tierName], ['Type', ms.kind], ['Amount', money(ms.amount, site.currency)], ['Payment reference', ms.paymentReference]]),
      footnote: esc(site.memberPaymentInstructions || ''),
    }),
    text: text([`Membership request ${ms.membershipNo} received for ${ms.tierName}.`]),
  };
}

export function membershipActivated(site, m, ms) {
  return {
    to: m.email,
    subject: `Your ${ms.tierName} membership is active`,
    html: layout(site, {
      heading: `Welcome to ${ms.tierName}`,
      intro: `Hi ${esc(firstName(m.fullName))}, your membership is now active. VIP collections and members-only content are unlocked in your account.`,
      body: rows([['Tier', ms.tierName], ['Valid from', longDate(ms.startsOn)], ['Valid until', longDate(ms.endsOn)]]) + (ms.staffNote ? quote(ms.staffNote) : ''),
      cta: siteUrl() ? { label: 'Open my account', url: `${siteUrl()}/account` } : null,
    }),
    text: text([`Your ${ms.tierName} membership is active until ${ms.endsOn}.`]),
  };
}

export function membershipRejected(site, m, ms) {
  return {
    to: m.email,
    subject: `About your membership request ${ms.membershipNo}`,
    html: layout(site, {
      heading: 'We couldn’t activate your membership',
      intro: `Hi ${esc(firstName(m.fullName))}, we couldn’t match your request ${esc(ms.membershipNo)} to a payment${ms.staffNote ? '' : '. Please check the reference number or contact us'}.`,
      body: ms.staffNote ? quote(ms.staffNote) : '',
      cta: siteUrl() ? { label: 'Open my account', url: `${siteUrl()}/account/membership` } : null,
    }),
    text: text([`We couldn't activate membership request ${ms.membershipNo}.`, ms.staffNote]),
  };
}

export function renewalReminder(site, m) {
  return {
    to: m.email,
    subject: `Your ${m.tierName} membership ends on ${longDate(m.membershipExpiresOn)}`,
    html: layout(site, {
      heading: 'Time to renew',
      intro: `Hi ${esc(firstName(m.fullName))}, your ${esc(m.tierName)} membership ends on <b>${esc(longDate(m.membershipExpiresOn))}</b>. Renew from your account to keep access to VIP collections and members-only content.`,
      cta: siteUrl() ? { label: 'Renew my membership', url: `${siteUrl()}/account/membership` } : null,
    }),
    text: text([`Your ${m.tierName} membership ends on ${m.membershipExpiresOn}. Renew from your account.`]),
  };
}

export function testEmail(site) {
  return {
    subject: `Test email from ${site.siteName}`,
    html: layout(site, { heading: 'Email is working', intro: 'This test message was sent from the CMS. Booking, membership and contact emails will be delivered from this account.' }),
    text: 'Email is working.',
  };
}
