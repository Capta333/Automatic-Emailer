// Storage via Node's built-in SQLite (node:sqlite). No native build step required.
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { config } from './config.js';

const dataDir = config.dataDir;
mkdirSync(dataDir, { recursive: true });

export const db = new DatabaseSync(join(dataDir, 'campaigner.db'));

db.exec(`
PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS contacts (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  email       TEXT NOT NULL UNIQUE,
  first_name  TEXT DEFAULT '',
  last_name   TEXT DEFAULT '',
  company     TEXT DEFAULT '',
  tags        TEXT DEFAULT '',           -- comma separated
  source      TEXT DEFAULT 'manual',     -- manual | csv | scrape | webhook
  consent     INTEGER DEFAULT 0,         -- 1 = explicit opt-in on record
  unsubscribed INTEGER DEFAULT 0,
  custom      TEXT DEFAULT '{}',         -- JSON extra merge fields
  created_at  TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS templates (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  subject    TEXT DEFAULT '',
  body       TEXT DEFAULT '',            -- HTML or text with {{merge}} fields
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS campaigns (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  name         TEXT NOT NULL,
  template_id  INTEGER,                  -- step 0: initial email
  followup1_template_id INTEGER,         -- step 1: first follow-up (optional)
  followup2_template_id INTEGER,         -- step 2: second follow-up (optional)
  gap_days     INTEGER DEFAULT 3,        -- business days between steps
  audience_tag TEXT DEFAULT '',          -- '' = all eligible contacts
  status       TEXT DEFAULT 'draft',     -- draft | queued | running | done | failed
  scheduled_at TEXT,
  created_at   TEXT DEFAULT (datetime('now')),
  stats        TEXT DEFAULT '{}'         -- JSON {sent,failed,skipped}
);

-- Per-recipient, per-step send jobs. The background worker drains this queue,
-- spacing sends out over time (anti-spam) and honoring each job's send_after.
CREATE TABLE IF NOT EXISTS queue (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign_id INTEGER,
  contact_id  INTEGER,
  step        INTEGER DEFAULT 0,         -- 0 = initial, 1 = follow-up 1, 2 = follow-up 2
  template_id INTEGER,
  send_after  TEXT,                      -- ISO time this job becomes eligible
  status      TEXT DEFAULT 'pending',    -- pending | sent | failed | skipped | canceled
  attempts    INTEGER DEFAULT 0,
  sent_at     TEXT,
  detail      TEXT DEFAULT '',
  created_at  TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_queue_due ON queue (status, send_after);
CREATE INDEX IF NOT EXISTS idx_queue_campaign ON queue (campaign_id);

CREATE TABLE IF NOT EXISTS events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign_id INTEGER,
  contact_id  INTEGER,
  type        TEXT,                      -- sent | failed | skipped | open | click | unsub
  detail      TEXT DEFAULT '',
  created_at  TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);

-- Individual user accounts for the hosted (web) version.
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  email         TEXT NOT NULL UNIQUE,
  name          TEXT DEFAULT '',
  password_hash TEXT NOT NULL,            -- scrypt$salt$hash
  role          TEXT DEFAULT 'user',      -- 'admin' | 'user'
  created_at    TEXT DEFAULT (datetime('now'))
);

-- Server-side sessions. We store only a hash of the cookie token, so a DB leak
-- can't be replayed as a live session.
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_events_lookup ON events (campaign_id, contact_id, type);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions (user_id);
`);

// ── Lightweight migrations for databases created before these columns existed ──
function ensureColumns(table, cols) {
  const have = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name));
  for (const [name, def] of cols) {
    if (!have.has(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${def}`);
  }
}
ensureColumns('campaigns', [
  ['followup1_template_id', 'INTEGER'],
  ['followup2_template_id', 'INTEGER'],
  ['gap_days', 'INTEGER DEFAULT 3'],
]);
// Verticals: a top-level segment label (e.g. "Medical", "Dental") that keeps each
// of the boss's books of business separate from the others.
ensureColumns('contacts', [
  ['vertical', "TEXT DEFAULT ''"],
]);

// ── Settings helpers (single JSON blob under key 'app') ──
export function getSettings() {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('app');
  if (!row) return null;
  try {
    return JSON.parse(row.value);
  } catch {
    return null;
  }
}

export function saveSettings(obj) {
  const json = JSON.stringify(obj);
  db.prepare(
    `INSERT INTO settings (key, value) VALUES ('app', ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run(json);
  return obj;
}

export function logEvent({ campaignId = null, contactId = null, type, detail = '' }) {
  db.prepare(
    'INSERT INTO events (campaign_id, contact_id, type, detail) VALUES (?, ?, ?, ?)'
  ).run(campaignId, contactId, type, String(detail).slice(0, 1000));
}
