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

// ---------- Booking chat (no message text in the email, only a link back) ----------
/** b: SELECT_BOOKING row. Sent for the first unread message, so a conversation doesn't flood the inbox. */
export function chatMessageToClient(site, b) {
  return {
    to: b.clientEmail,
    subject: `New message about your booking ${b.reference}`,
    html: layout(site, {
      heading: 'You have a new message',
      intro: `Hi ${esc(firstName(b.clientName))}, there’s a new message in the chat for booking ${esc(b.reference)}.`,
      cta: statusLink(b),
      footnote: 'For your privacy the message itself isn’t included in this email. Open your booking to read and reply.',
    }),
    text: text([`Hi ${firstName(b.clientName)},`, `There’s a new message in the chat for booking ${b.reference}.`, statusLink(b)?.url]),
  };
}

// Live chat: the visitor left before the concierge answered. The chat opens only in the browser that started it.
export function liveChatReply(site, c) {
  const url = siteUrl() ? `${siteUrl()}/?chat=open` : null;
  return {
    to: c.visitorEmail,
    subject: `The concierge replied to your chat — ${site.siteName}`,
    html: layout(site, {
      heading: 'You have a reply',
      intro: `Hi ${esc(firstName(c.visitorName))}, our concierge answered your live chat (${esc(c.reference)}).`,
      cta: url ? { label: 'Open the chat', url } : null,
      footnote: 'For your privacy the reply isn’t included in this email. Open the website on the same device and browser you chatted from to read it.',
    }),
    text: text([`Hi ${firstName(c.visitorName)},`, `Our concierge answered your live chat (${c.reference}). Open the website on the same device and browser you chatted from to read it.`, url]),
  };
}

export function testEmail(site) {
  return {
    subject: `Test email from ${site.siteName}`,
    html: layout(site, { heading: 'Email is working', intro: 'This test message was sent from the CMS. Booking, membership and contact emails will be delivered from this account.' }),
    text: 'Email is working.',
  };
}
