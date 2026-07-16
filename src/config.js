// Loads .env (if present) and exposes typed config. No external dotenv dep —
// Node 22+ provides process.loadEnvFile().
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const ROOT = join(__dirname, '..');

const envPath = join(ROOT, '.env');
if (existsSync(envPath)) {
  try {
    process.loadEnvFile(envPath);
  } catch (err) {
    console.warn('Could not load .env:', err.message);
  }
}

const bool = (v, d = false) =>
  v === undefined ? d : ['1', 'true', 'yes', 'on'].includes(String(v).toLowerCase());
const num = (v, d) => (v === undefined || v === '' ? d : Number(v));

export const config = {
  port: num(process.env.PORT, 4787),
  publicBaseUrl: process.env.PUBLIC_BASE_URL || `http://localhost:${num(process.env.PORT, 4787)}`,
  dataDir: process.env.DATA_DIR || join(ROOT, 'data'),

  sender: {
    name: process.env.SENDER_NAME || 'Your Name',
    email: process.env.SENDER_EMAIL || 'you@example.com',
    address: process.env.SENDER_ADDRESS || '',
  },

  smtp: {
    host: process.env.SMTP_HOST || '',
    port: num(process.env.SMTP_PORT, 587),
    secure: bool(process.env.SMTP_SECURE, false),
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
  },

  dryRun: bool(process.env.DRY_RUN, true),
  ratePerMin: num(process.env.RATE_PER_MIN, 20),

  // Authentication. Enabled by default; set AUTH_DISABLED=1 for frictionless
  // local use (the desktop launcher does this). MUST stay enabled when hosted.
  authDisabled: bool(process.env.AUTH_DISABLED, false),

  // Anti-spam pacing: minimum seconds between two outgoing emails (the worker
  // sends at most one email per interval). A little random jitter is added on
  // top so the cadence doesn't look perfectly machine-timed.
  sendSpacingSeconds: num(process.env.SEND_SPACING_SECONDS, 45),
  sendJitterSeconds: num(process.env.SEND_JITTER_SECONDS, 15),

  // Business-hours window follow-ups are clamped into (local time, 24h).
  sendWindowStartHour: num(process.env.SEND_WINDOW_START_HOUR, 9),
  sendWindowEndHour: num(process.env.SEND_WINDOW_END_HOUR, 17),

  ai: {
    provider: (process.env.AI_PROVIDER || 'ollama').toLowerCase(),
    ollamaUrl: process.env.OLLAMA_URL || 'http://localhost:11434',
    ollamaModel: process.env.OLLAMA_MODEL || 'qwen2.5-coder:7b',
    anthropicKey: process.env.ANTHROPIC_API_KEY || '',
    claudeModel: process.env.CLAUDE_MODEL || 'claude-opus-4-8',
  },

  make: {
    webhookUrl: process.env.MAKE_WEBHOOK_URL || '',
    inboundSecret: process.env.MAKE_INBOUND_SECRET || '',
  },
};

// Settings stored in DB override env at runtime (see db settings table).
export function applySettingsOverride(settings) {
  if (!settings) return;
  if (settings.sender) Object.assign(config.sender, settings.sender);
  if (settings.smtp) Object.assign(config.smtp, settings.smtp);
  if (settings.ai) Object.assign(config.ai, settings.ai);
  if (settings.make) Object.assign(config.make, settings.make);
  if (settings.dryRun !== undefined) config.dryRun = !!settings.dryRun;
  if (settings.ratePerMin !== undefined) config.ratePerMin = Number(settings.ratePerMin);
  if (settings.sendSpacingSeconds !== undefined) config.sendSpacingSeconds = Number(settings.sendSpacingSeconds);
  if (settings.sendJitterSeconds !== undefined) config.sendJitterSeconds = Number(settings.sendJitterSeconds);
}
