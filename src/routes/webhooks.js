import { db, logEvent } from '../db.js';
import { config } from '../config.js';
import { decodeUnsubToken } from '../services/personalize.js';
import { enqueueCampaign, cancelPendingForContact, recomputeCampaignStats } from '../services/sender.js';
import { decodeToken, PIXEL } from '../services/tracking.js';
import { notifyMake } from '../services/make.js';
import { upsertContact } from './contacts.js';

export default async function webhookRoutes(app) {
  // Public unsubscribe link (GET so it works from an email click).
  app.get('/unsubscribe', async (req, reply) => {
    const decoded = decodeUnsubToken(req.query.t || '');
    if (!decoded) return reply.code(400).type('text/html').send('<h2>Invalid unsubscribe link</h2>');
    db.prepare('UPDATE contacts SET unsubscribed = 1 WHERE id = ? AND email = ?').run(decoded.id, decoded.email);
    cancelPendingForContact(decoded.id); // stop any scheduled follow-ups
    logEvent({ contactId: decoded.id, type: 'unsub', detail: decoded.email });
    return reply.type('text/html').send(
      `<div style="font-family:Arial;max-width:480px;margin:80px auto;text-align:center">
        <h2>You're unsubscribed</h2>
        <p>${decoded.email} will no longer receive emails from us.</p>
      </div>`
    );
  });

  // Inbound Make.com webhook: trigger a campaign or add a contact.
  // Secured by a shared secret header (set MAKE_INBOUND_SECRET).
  app.post('/webhooks/make', async (req, reply) => {
    const secret = req.headers['x-make-secret'];
    if (!config.make.inboundSecret || secret !== config.make.inboundSecret) {
      return reply.code(401).send({ error: 'unauthorized' });
    }
    const { action, data = {} } = req.body || {};
    switch (action) {
      case 'add_contact':
        if (!data.email) return reply.code(400).send({ error: 'email required' });
        return { ok: true, contact: upsertContact({ ...data, source: 'webhook' }) };
      case 'bounce': {
        // Make.com can parse mailer-daemon / bounce notifications and POST them
        // here so bounces show up in tracking. Hard bounces also unsubscribe.
        if (!data.email) return reply.code(400).send({ error: 'email required' });
        const ct = db.prepare('SELECT id FROM contacts WHERE email = ?').get(String(data.email).toLowerCase());
        if (ct && data.hard) {
          db.prepare('UPDATE contacts SET unsubscribed = 1 WHERE id = ?').run(ct.id);
          cancelPendingForContact(ct.id);
        }
        logEvent({ campaignId: data.campaignId || null, contactId: ct?.id || null, type: 'bounced', detail: data.reason || (data.hard ? 'hard' : 'soft') });
        return { ok: true };
      }
      case 'run_campaign':
        if (!data.campaignId) return reply.code(400).send({ error: 'campaignId required' });
        try {
          return { ok: true, started: true, ...enqueueCampaign(Number(data.campaignId)) };
        } catch (err) {
          return reply.code(409).send({ error: err.message });
        }
      default:
        return reply.code(400).send({ error: 'unknown action' });
    }
  });

  // ── Open tracking: 1x1 pixel. Loading the image logs an 'open' event. ──
  app.get('/t/o/:token.gif', async (req, reply) => {
    const tok = decodeToken(req.params.token);
    if (tok) {
      try {
        logEvent({ campaignId: tok.campaignId, contactId: tok.contactId, type: 'open', detail: `step ${tok.step}` });
        recomputeCampaignStats(tok.campaignId);
        notifyMake('email.opened', { campaignId: tok.campaignId, contactId: tok.contactId, step: tok.step });
      } catch (err) {
        app.log.warn({ err }, 'open-tracking log failed');
      }
    }
    reply
      .header('content-type', 'image/gif')
      .header('cache-control', 'no-store, no-cache, must-revalidate, private')
      .header('pragma', 'no-cache');
    return reply.send(PIXEL);
  });

  // ── Click tracking: log then 302 to the real URL. ──
  app.get('/t/c/:token', async (req, reply) => {
    const tok = decodeToken(req.params.token);
    const url = req.query.u;
    if (!url) return reply.code(400).send('missing url');
    if (tok) {
      try {
        logEvent({ campaignId: tok.campaignId, contactId: tok.contactId, type: 'click', detail: String(url).slice(0, 300) });
        recomputeCampaignStats(tok.campaignId);
        notifyMake('email.clicked', { campaignId: tok.campaignId, contactId: tok.contactId, step: tok.step, url });
      } catch (err) {
        app.log.warn({ err }, 'click-tracking log failed');
      }
    }
    return reply.redirect(url);
  });
}
