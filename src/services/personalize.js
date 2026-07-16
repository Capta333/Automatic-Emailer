// Merge-field rendering + compliance footer + unsubscribe link injection.
import { config } from '../config.js';

// Replace {{field}} tokens from a contact record. Unknown tokens become ''.
export function render(template, contact) {
  const fields = {
    firstName: contact.first_name || '',
    lastName: contact.last_name || '',
    fullName: [contact.first_name, contact.last_name].filter(Boolean).join(' '),
    email: contact.email || '',
    company: contact.company || '',
    senderName: config.sender.name,
    senderEmail: config.sender.email,
    ...safeJson(contact.custom),
  };
  return String(template || '').replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, key) =>
    fields[key] !== undefined ? String(fields[key]) : ''
  );
}

function safeJson(s) {
  try {
    return JSON.parse(s || '{}');
  } catch {
    return {};
  }
}

// Build the unsubscribe URL for a given contact.
export function unsubscribeUrl(contact) {
  const token = Buffer.from(`${contact.id}:${contact.email}`).toString('base64url');
  return `${config.publicBaseUrl}/unsubscribe?t=${token}`;
}

export function decodeUnsubToken(token) {
  try {
    const [id, email] = Buffer.from(token, 'base64url').toString('utf8').split(':');
    return { id: Number(id), email };
  } catch {
    return null;
  }
}

// Append the legally-required footer (physical address + unsubscribe) to a body.
export function withFooter(html, contact) {
  const addr = config.sender.address
    ? `<div style="margin-bottom:6px">${escapeHtml(config.sender.address)}</div>`
    : '';
  const footer = `
<hr style="border:none;border-top:1px solid #ddd;margin:24px 0 12px">
<div style="font-size:12px;color:#888;font-family:Arial,sans-serif;line-height:1.5">
  ${addr}
  <div>You're receiving this because you're on ${escapeHtml(config.sender.name)}'s contact list.
  <a href="${unsubscribeUrl(contact)}" style="color:#888">Unsubscribe</a></div>
</div>`;
  return `${html}\n${footer}`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
