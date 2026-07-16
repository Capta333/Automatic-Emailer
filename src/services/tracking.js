// Email open/click tracking.
//
// Each queued send gets a token that encodes which (queue job, campaign, contact,
// step) it belongs to. We embed:
//   • a 1x1 transparent GIF whose URL contains the token  → fires an 'open' event
//   • link rewrites that route clicks through us, then 302 → fires a 'click' event
//
// IMPORTANT (what this can and cannot tell you):
//   ✓ opened (image loaded), clicked  — directly observable
//   ✗ "went to spam", "deleted unread" — NOT observable from a sending app.
//     See docs/TRACKING.md for the realistic way to monitor those (Google
//     Postmaster Tools, seed-list/inbox-placement testing, bounce + FBL handling).
import { config } from '../config.js';

// 1x1 transparent GIF.
export const PIXEL = Buffer.from(
  'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
  'base64'
);

export function encodeToken({ queueId, campaignId, contactId, step }) {
  return Buffer.from(`${queueId}:${campaignId}:${contactId}:${step}`).toString('base64url');
}

export function decodeToken(token) {
  try {
    const [queueId, campaignId, contactId, step] = Buffer.from(token, 'base64url')
      .toString('utf8')
      .split(':');
    return {
      queueId: Number(queueId),
      campaignId: Number(campaignId),
      contactId: Number(contactId),
      step: Number(step),
    };
  } catch {
    return null;
  }
}

// Rewrite http(s) links in the body so clicks pass through our redirector.
// Run this on the body BEFORE the compliance footer is appended, so the
// unsubscribe link stays a direct link.
export function rewriteLinks(html, token) {
  const base = config.publicBaseUrl.replace(/\/$/, '');
  return String(html || '').replace(
    /href\s*=\s*"(https?:\/\/[^"]+)"/gi,
    (_m, url) => `href="${base}/t/c/${token}?u=${encodeURIComponent(url)}"`
  );
}

// Append the invisible open-tracking pixel. Run this last (after the footer).
export function appendPixel(html, token) {
  const base = config.publicBaseUrl.replace(/\/$/, '');
  return `${html}\n<img src="${base}/t/o/${token}.gif" width="1" height="1" alt="" style="display:none" />`;
}
