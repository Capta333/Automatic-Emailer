import { db } from '../db.js';
import { config } from '../config.js';
import { enqueueCampaign, resolveAudience, recomputeCampaignStats } from '../services/sender.js';
import { render, withFooter } from '../services/personalize.js';
import { sendTimeForStep } from '../services/schedule.js';

export default async function campaignsRoutes(app) {
  app.get('/api/campaigns', async () => ({
    campaigns: db.prepare('SELECT * FROM campaigns ORDER BY created_at DESC').all(),
  }));

  app.post('/api/campaigns', async (req, reply) => {
    const {
      name, template_id, audience_tag = '',
      followup1_template_id = null, followup2_template_id = null, gap_days = 3,
    } = req.body || {};
    if (!name || !template_id) return reply.code(400).send({ error: 'name and template_id required' });
    const info = db
      .prepare(
        `INSERT INTO campaigns (name, template_id, followup1_template_id, followup2_template_id, gap_days, audience_tag)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(
        name, Number(template_id),
        followup1_template_id ? Number(followup1_template_id) : null,
        followup2_template_id ? Number(followup2_template_id) : null,
        Number(gap_days) || 3, audience_tag
      );
    return db.prepare('SELECT * FROM campaigns WHERE id = ?').get(info.lastInsertRowid);
  });

  app.delete('/api/campaigns/:id', async (req) => {
    const id = Number(req.params.id);
    db.prepare('DELETE FROM queue WHERE campaign_id = ?').run(id);
    db.prepare('DELETE FROM campaigns WHERE id = ?').run(id);
    return { ok: true };
  });

  // Audience size, the planned drip schedule, and a preview of the initial email.
  app.get('/api/campaigns/:id/preview', async (req, reply) => {
    const c = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(Number(req.params.id));
    if (!c) return reply.code(404).send({ error: 'not found' });
    const t = db.prepare('SELECT * FROM templates WHERE id = ?').get(c.template_id);
    const audience = resolveAudience(c.audience_tag);
    const sample = audience[0] || { email: 'sample@example.com', first_name: 'Sam', company: 'Acme', id: 0, custom: '{}' };

    // Describe each configured step and when it would go out.
    const now = new Date();
    const gap = c.gap_days || 3;
    const stepDefs = [
      { step: 0, label: 'Initial email', templateId: c.template_id },
      { step: 1, label: `Follow-up 1 (+${gap} business days)`, templateId: c.followup1_template_id },
      { step: 2, label: `Follow-up 2 (+${gap * 2} business days)`, templateId: c.followup2_template_id },
    ].filter((s) => s.templateId);
    const schedule = stepDefs.map((s) => ({
      label: s.label,
      template: db.prepare('SELECT name FROM templates WHERE id = ?').get(s.templateId)?.name || '(missing)',
      when: sendTimeForStep(s.step, gap, now).toISOString(),
    }));

    return {
      audienceSize: audience.length,
      dryRun: config.dryRun,
      spacingSeconds: config.sendSpacingSeconds,
      schedule,
      preview: t
        ? { subject: render(t.subject, sample), body: withFooter(render(t.body, sample), sample) }
        : null,
    };
  });

  // Launch: enqueue all recipient×step jobs. The worker drains them over time.
  app.post('/api/campaigns/:id/send', async (req, reply) => {
    const id = Number(req.params.id);
    const c = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(id);
    if (!c) return reply.code(404).send({ error: 'not found' });
    try {
      const r = enqueueCampaign(id);
      return { ok: true, ...r, dryRun: config.dryRun };
    } catch (err) {
      return reply.code(409).send({ error: err.message });
    }
  });

  // Recent events for a campaign (live progress view).
  app.get('/api/campaigns/:id/events', async (req) => {
    const id = Number(req.params.id);
    const events = db
      .prepare('SELECT * FROM events WHERE campaign_id = ? ORDER BY id DESC LIMIT 200')
      .all(id);
    const campaign = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(id);
    return { campaign, events };
  });

  // Per-recipient tracking: status, opens, clicks. Powers the Tracking view.
  app.get('/api/campaigns/:id/tracking', async (req) => {
    const id = Number(req.params.id);
    const stats = recomputeCampaignStats(id);
    const rows = db
      .prepare(
        `SELECT c.id, c.email, c.first_name, c.last_name, c.company, c.unsubscribed,
                MAX(CASE WHEN q.status='sent' THEN 1 ELSE 0 END)                            AS sent,
                MAX(CASE WHEN q.status='failed' THEN 1 ELSE 0 END)                          AS failed,
                MAX(q.step)                                                                 AS last_step,
                (SELECT COUNT(*) FROM events e WHERE e.campaign_id=q.campaign_id AND e.contact_id=c.id AND e.type='open')  AS opens,
                (SELECT COUNT(*) FROM events e WHERE e.campaign_id=q.campaign_id AND e.contact_id=c.id AND e.type='click') AS clicks,
                (SELECT MAX(created_at) FROM events e WHERE e.campaign_id=q.campaign_id AND e.contact_id=c.id AND e.type='open') AS last_open
         FROM queue q JOIN contacts c ON c.id = q.contact_id
         WHERE q.campaign_id = ?
         GROUP BY c.id
         ORDER BY opens DESC, clicks DESC, c.email`
      )
      .all(id);

    const recipients = rows.map((r) => {
      let status = 'pending';
      if (r.unsubscribed) status = 'unsubscribed';
      else if (r.clicks > 0) status = 'clicked';
      else if (r.opens > 0) status = 'opened';
      else if (r.failed) status = 'failed';
      else if (r.sent) status = 'sent';
      return { ...r, status };
    });
    return { stats, recipients };
  });
}
