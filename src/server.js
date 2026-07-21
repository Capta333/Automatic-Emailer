import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import fastifyMultipart from '@fastify/multipart';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { config, applySettingsOverride } from './config.js';
import { db, getSettings } from './db.js';
import { ensureWorker } from './services/sender.js';
import { userForToken, sessionCookieToken, LOCAL_ADMIN } from './services/auth.js';

import authRoutes from './routes/auth.js';
import contactsRoutes from './routes/contacts.js';
import templatesRoutes from './routes/templates.js';
import campaignsRoutes from './routes/campaigns.js';
import aiRoutes from './routes/ai.js';
import scrapeRoutes from './routes/scrape.js';
import settingsRoutes from './routes/settings.js';
import webhookRoutes from './routes/webhooks.js';
import sendRoutes from './routes/send.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Apply persisted settings (DB) over .env defaults at boot.
applySettingsOverride(getSettings());

const app = Fastify({ logger: { transport: undefined, level: 'info' } });

app.register(fastifyStatic, { root: join(__dirname, '..', 'public'), prefix: '/' });
app.register(fastifyMultipart, { limits: { fileSize: 15 * 1024 * 1024, files: 1 } });

// ── Auth gate ──────────────────────────────────────────────────────────────
// Everything requires a logged-in user except: the login page, the auth API,
// and the public email-facing routes (tracking pixel, click redirect,
// unsubscribe, inbound Make.com webhook).
app.addHook('onRequest', async (req, reply) => {
  if (config.authDisabled) { req.user = LOCAL_ADMIN; return; }
  const path = req.url.split('?')[0];
  const isPublic =
    path === '/login' ||
    path.startsWith('/api/auth/') ||
    path === '/api/health' ||
    path === '/unsubscribe' ||
    path.startsWith('/t/') ||
    path === '/webhooks/make';
  if (isPublic) return;
  const user = userForToken(sessionCookieToken(req));
  if (user) { req.user = user; return; }
  if (path.startsWith('/api/')) return reply.code(401).send({ error: 'unauthorized' });
  return reply.redirect('/login');
});

// Serve the login / first-admin-setup page.
app.get('/login', (req, reply) => reply.sendFile('login.html'));

// Dashboard summary.
app.get('/api/stats', async () => {
  const count = (sql) => db.prepare(sql).get().n;
  const sent = db.prepare("SELECT COUNT(*) n FROM events WHERE type='sent'").get().n;
  const failed = db.prepare("SELECT COUNT(*) n FROM events WHERE type='failed'").get().n;
  const unsub = db.prepare("SELECT COUNT(*) n FROM events WHERE type='unsub'").get().n;
  const opens = db.prepare("SELECT COUNT(DISTINCT campaign_id || '-' || contact_id) n FROM events WHERE type='open'").get().n;
  const clicks = db.prepare("SELECT COUNT(DISTINCT campaign_id || '-' || contact_id) n FROM events WHERE type='click'").get().n;
  const queued = db.prepare("SELECT COUNT(*) n FROM queue WHERE status='pending'").get().n;
  return {
    contacts: count('SELECT COUNT(*) n FROM contacts'),
    eligible: count('SELECT COUNT(*) n FROM contacts WHERE unsubscribed=0'),
    unsubscribed: count('SELECT COUNT(*) n FROM contacts WHERE unsubscribed=1'),
    templates: count('SELECT COUNT(*) n FROM templates'),
    campaigns: count('SELECT COUNT(*) n FROM campaigns'),
    sent,
    failed,
    opens,
    clicks,
    queued,
    unsubEvents: unsub,
    dryRun: config.dryRun,
  };
});

app.get('/api/health', async () => ({ ok: true, dryRun: config.dryRun, spacingSeconds: config.sendSpacingSeconds, version: '0.1.0' }));

for (const route of [
  authRoutes, contactsRoutes, templatesRoutes, campaignsRoutes,
  aiRoutes, scrapeRoutes, settingsRoutes, webhookRoutes, sendRoutes,
]) {
  app.register(route);
}

app.listen({ port: config.port, host: '0.0.0.0' }).then(() => {
  ensureWorker(); // resume draining any queued/scheduled sends after a restart
  console.log(`\n  Email Campaigner running → ${config.publicBaseUrl}`);
  console.log(`  Mode: ${config.dryRun ? 'DRY RUN (no real sends)' : 'LIVE SENDING'} | spacing: ~${config.sendSpacingSeconds}s between sends`);
  console.log(`  Auth: ${config.authDisabled ? 'DISABLED (local mode)' : 'enabled (login required)'}\n`);
}).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
