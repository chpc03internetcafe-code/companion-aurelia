// Outgoing email through a Gmail account (SMTP + app password).
// Set GMAIL_USER and GMAIL_APP_PASSWORD; when they're missing, emails are skipped and logged instead.
import nodemailer from 'nodemailer';
import { isProduction, maskEmail } from './security.js';

let transport;

export const mailConfigured = () => !!(process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD);

function getTransport() {
  transport ||= nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 587, // STARTTLS: 465 is blocked on some office networks
    secure: false,
    requireTLS: true,
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 30000,
    auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD.replace(/\s+/g, '') },
  });
  return transport;
}

/** Sends one email. Throws on failure — use `notify` for emails that must never break a request. */
export async function sendMail({ to, subject, html, text, replyTo, fromName }) {
  if (!mailConfigured()) throw new Error('Email is not set up: add GMAIL_USER and GMAIL_APP_PASSWORD to the API environment.');
  const name = (fromName || process.env.MAIL_FROM_NAME || 'Aurelia').replace(/["<>]/g, '');
  const message = { from: `"${name}" <${process.env.GMAIL_USER}>`, to, subject, html, text, replyTo: replyTo || undefined };
  try {
    return await getTransport().sendMail(message);
  } catch (err) {
    if (!['ECONNECTION', 'ETIMEDOUT', 'ESOCKET'].includes(err.code)) throw err;
    transport = null; // one retry on a dropped connection
    return getTransport().sendMail(message);
  }
}

/** Best-effort email: failures are logged, never thrown. Awaited so the send finishes before a serverless function freezes. */
export async function notify(message) {
  if (!message?.to) return false;
  if (!mailConfigured()) {
    // subjects can contain booking references and names, so production logs keep only a masked address
    console.warn(isProduction() ? `[mail] not configured — skipped a message to ${maskEmail(message.to)}` : `[mail] not configured — skipped "${message.subject}" to ${message.to}`);
    return false;
  }
  try {
    await sendMail(message);
    return true;
  } catch (err) {
    console.error(`[mail] failed to send to ${isProduction() ? maskEmail(message.to) : message.to}:`, err.message);
    return false;
  }
}
