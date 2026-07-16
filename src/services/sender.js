// Campaign send engine.
//
// Sending is queue-based: launching a campaign enqueues one job per recipient
// per step (initial + optional follow-ups), each with a send_after time. A single
// background worker drains the queue, sending at most one email per spacing
// interval (anti-spam) and never before a job's send_after (the drip schedule).
import { db, logEvent } from '../db.js';
import { config } from '../config.js';
import { sendMail } from './mailer.js';
import { render, withFooter } from './personalize.js';
import { notifyMake } from './make.js';
import { encodeToken, rewriteLinks, appendPixel } from './tracking.js';
import { sendTimeForStep } from './schedule.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function resolveAudience(tag) {
  // Only eligible contacts: not unsubscribed. Tag '' => everyone eligible.
  if (!tag) {
    return db.prepare('SELECT * FROM contacts WHERE unsubscribed = 0').all();
  }
  return db
    .prepare(
      `SELECT * FROM contacts
       WHERE unsubscribed = 0
       AND (',' || replace(tags,' ','') || ',') LIKE ?`
    )
    .all(`%,${tag.trim()},%`);
}

// Which steps a campaign actually has, in order. Step 0 is always the initial
// template; steps 1/2 only exist if a follow-up template is configured.
function campaignSteps(campaign) {
  const steps = [{ step: 0, templateId: campaign.template_id }];
  if (campaign.followup1_template_id) steps.push({ step: 1, templateId: campaign.followup1_template_id });
  if (campaign.followup2_template_id) steps.push({ step: 2, templateId: campaign.followup2_template_id });
  return steps;
}

// Enqueue every (recipient × step) job for a campaign. Returns how many jobs were
// queued. Idempotent-ish: refuses to double-queue a campaign that still has
// pending jobs.
export function enqueueCampaign(campaignId) {
  const campaign = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(campaignId);
  if (!campaign) throw new Error('Campaign not found');
  if (!campaign.template_id) throw new Error('Campaign has no initial template');

  const pending = db
    .prepare("SELECT COUNT(*) n FROM queue WHERE campaign_id = ? AND status = 'pending'")
    .get(campaignId).n;
  if (pending > 0) throw new Error('Campaign already has pending sends queued');

  const audience = resolveAudience(campaign.audience_tag);
  const steps = campaignSteps(campaign);
  const gapDays = campaign.gap_days || 3;
  const launch = new Date();

  const insert = db.prepare(
    `INSERT INTO queue (campaign_id, contact_id, step, template_id, send_after)
     VALUES (?, ?, ?, ?, ?)`
  );
  let queued = 0;
  for (const contact of audience) {
    for (const { step, templateId } of steps) {
      insert.run(campaignId, contact.id, step, templateId, sendTimeForStep(step, gapDays, launch).toISOString());
      queued++;
    }
  }

  db.prepare('UPDATE campaigns SET status = ? WHERE id = ?').run(queued ? 'queued' : 'done', campaignId);
  recomputeCampaignStats(campaignId);
  notifyMake('campaign.queued', { campaignId, recipients: audience.length, steps: steps.length, jobs: queued });
  ensureWorker();
  return { queued, recipients: audience.length, steps: steps.length };
}

// Cancel a contact's not-yet-sent follow-ups (e.g. after they unsubscribe).
export function cancelPendingForContact(contactId) {
  return db
    .prepare("UPDATE queue SET status = 'canceled' WHERE contact_id = ? AND status = 'pending'")
    .run(contactId).changes;
}

// ── Background worker ──────────────────────────────────────────────────────
let timer = null;
let working = false;

function spacingMs() {
  if (config.dryRun) return 1000; // keep dry-run tests snappy
  const base = Math.max(0, config.sendSpacingSeconds) * 1000;
  const jitter = Math.random() * Math.max(0, config.sendJitterSeconds) * 1000;
  return base + jitter;
}

const POLL_MS = 10000; // how often to look for newly-due jobs when idle

function nextDueJob() {
  return db
    .prepare(
      `SELECT * FROM queue
       WHERE status = 'pending' AND send_after <= ?
       ORDER BY send_after, id LIMIT 1`
    )
    .get(new Date().toISOString());
}

async function processJob(job) {
  const contact = db.prepare('SELECT * FROM contacts WHERE id = ?').get(job.contact_id);
  const template = db.prepare('SELECT * FROM templates WHERE id = ?').get(job.template_id);

  // Recipient gone or opted out, or template deleted → skip cleanly.
  if (!contact || contact.unsubscribed) {
    finishJob(job, 'skipped', contact ? 'unsubscribed' : 'contact deleted');
    logEvent({ campaignId: job.campaign_id, contactId: job.contact_id, type: 'skipped', detail: 'unsub/missing' });
    return;
  }
  if (!template) {
    finishJob(job, 'failed', 'template missing');
    logEvent({ campaignId: job.campaign_id, contactId: job.contact_id, type: 'failed', detail: 'template missing' });
    return;
  }

  const token = encodeToken({ queueId: job.id, campaignId: job.campaign_id, contactId: contact.id, step: job.step });
  const subject = render(template.subject, contact);
  let body = render(template.body, contact);
  body = rewriteLinks(body, token);   // clicks pass through our redirector
  body = withFooter(body, contact);   // CAN-SPAM footer + unsubscribe (left direct)
  body = appendPixel(body, token);    // invisible open pixel, last

  try {
    const result = await sendMail({ to: contact.email, subject, html: body });
    const detail = result.dryRun ? 'DRY_RUN (not sent)' : result.messageId || '';
    finishJob(job, 'sent', detail);
    logEvent({ campaignId: job.campaign_id, contactId: contact.id, type: 'sent', detail });
    notifyMake('email.sent', { campaignId: job.campaign_id, email: contact.email, step: job.step, dryRun: !!result.dryRun });
  } catch (err) {
    finishJob(job, 'failed', err.message);
    logEvent({ campaignId: job.campaign_id, contactId: contact.id, type: 'failed', detail: err.message });
  }
}

function finishJob(job, status, detail) {
  db.prepare("UPDATE queue SET status = ?, attempts = attempts + 1, sent_at = ?, detail = ? WHERE id = ?")
    .run(status, new Date().toISOString(), String(detail || '').slice(0, 500), job.id);
  recomputeCampaignStats(job.campaign_id);
}

async function tick() {
  if (working) return;
  working = true;
  let didSend = false;
  try {
    const job = nextDueJob();
    if (job) {
      await processJob(job);
      didSend = true;
    }
  } catch (err) {
    console.error('worker tick error:', err);
  } finally {
    working = false;
    // After an actual send, wait the spacing interval; otherwise poll sooner.
    schedule(didSend ? spacingMs() : POLL_MS);
  }
}

function schedule(ms) {
  clearTimeout(timer);
  timer = setTimeout(tick, ms);
}

// Start the worker (idempotent). Called at boot and whenever jobs are queued.
export function ensureWorker() {
  if (!timer && !working) schedule(500);
}

// ── Stats ──────────────────────────────────────────────────────────────────
export function recomputeCampaignStats(campaignId) {
  // Guard against stale/garbage tracking tokens pointing at a deleted campaign.
  if (!db.prepare('SELECT 1 FROM campaigns WHERE id = ?').get(campaignId)) return null;
  const q = db
    .prepare(
      `SELECT
         SUM(status='sent')     AS sent,
         SUM(status='failed')   AS failed,
         SUM(status='skipped')  AS skipped,
         SUM(status='canceled') AS canceled,
         SUM(status='pending')  AS pending,
         COUNT(*)               AS total
       FROM queue WHERE campaign_id = ?`
    )
    .get(campaignId);
  const opens = db
    .prepare("SELECT COUNT(DISTINCT contact_id) n FROM events WHERE campaign_id = ? AND type = 'open'")
    .get(campaignId).n;
  const clicks = db
    .prepare("SELECT COUNT(DISTINCT contact_id) n FROM events WHERE campaign_id = ? AND type = 'click'")
    .get(campaignId).n;

  const stats = {
    sent: q.sent || 0,
    failed: q.failed || 0,
    skipped: q.skipped || 0,
    canceled: q.canceled || 0,
    pending: q.pending || 0,
    total: q.total || 0,
    opens,
    clicks,
    dryRun: config.dryRun,
  };

  // A queued campaign becomes 'running' once anything has gone out, and 'done'
  // when nothing is left pending.
  const current = db.prepare('SELECT status FROM campaigns WHERE id = ?').get(campaignId)?.status;
  let status = current;
  if (current === 'queued' || current === 'running' || current === 'done') {
    if (stats.pending > 0) status = stats.sent + stats.failed + stats.skipped > 0 ? 'running' : 'queued';
    else if (stats.total > 0) status = 'done';
  }
  db.prepare('UPDATE campaigns SET status = ?, stats = ? WHERE id = ?').run(status, JSON.stringify(stats), campaignId);
  return stats;
}
