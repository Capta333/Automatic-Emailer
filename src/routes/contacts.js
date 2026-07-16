import { parse } from 'csv-parse/sync';
import { stringify } from 'csv-stringify/sync';
import { db } from '../db.js';
import { parseSpreadsheet } from '../services/spreadsheet.js';

// Map a loosely-structured row (CSV/Excel) onto our contact fields. Tuned for the
// Apollo "medical list" export, whose fixed header row is:
//   First Name | Last Name | Job Title | Company Name | Email | City | State | Email #1 | Email #2 | Email #3
// (the sheet ships "Email" and "City" with a trailing space — header parsing trims
// these, so the names below match). Generic header spellings are still tolerated as
// fallbacks. Returns null if there's no usable email.
function mapRecord(r, tags = '', vertical = '') {
  const pick = (...keys) => {
    for (const k of keys) if (r[k] != null && String(r[k]).trim() !== '') return String(r[k]).trim();
    return '';
  };
  // Primary "Email" column first, then Apollo's alternate Email #1/#2/#3 columns.
  const email = pick(
    'email', 'Email', 'EMAIL', 'e-mail', 'E-mail', 'Email Address', 'email_address',
    'Email #1', 'Email #2', 'Email #3', 'Email 1', 'Email 2', 'Email 3'
  );
  if (!email || !email.includes('@')) return null;

  // Extra Apollo columns become custom merge fields: {{jobTitle}}, {{city}}, {{state}}.
  const custom = {};
  const jobTitle = pick('Job Title', 'job_title', 'jobtitle', 'Title', 'title', 'Position');
  const city = pick('City', 'city');
  const state = pick('State', 'state', 'Province', 'Region');
  if (jobTitle) custom.jobTitle = jobTitle;
  if (city) custom.city = city;
  if (state) custom.state = state;

  return {
    email,
    first_name: pick('first_name', 'firstname', 'FirstName', 'First Name', 'first', 'fname'),
    last_name: pick('last_name', 'lastname', 'LastName', 'Last Name', 'last', 'lname'),
    company: pick('company', 'Company', 'Company Name', 'organization', 'Organization', 'org', 'business'),
    tags: [tags, pick('tags', 'Tags')].filter(Boolean).join(','),
    source: 'import',
    consent: pick('consent', 'Consent', 'opt_in', 'opted_in') ? 1 : 0,
    custom: Object.keys(custom).length ? JSON.stringify(custom) : '{}',
    vertical: vertical || pick('vertical', 'Vertical'),
  };
}

// Upsert a batch of mapped rows; report how many were added/updated/skipped.
function ingest(records, tags, vertical = '') {
  let added = 0, updated = 0, skipped = 0;
  for (const r of records) {
    const mapped = mapRecord(r, tags, vertical);
    if (!mapped) { skipped++; continue; }
    const before = db.prepare('SELECT id FROM contacts WHERE email = ?').get(mapped.email.toLowerCase());
    upsertContact({ ...mapped, source: 'csv' });
    before ? updated++ : added++;
  }
  return { added, updated, skipped, total: records.length };
}

// ── Verticals: persisted in the settings table so an empty vertical (one a user
// created but hasn't filled yet) survives a reload, unioned with whatever
// verticals contacts are actually tagged with. ──
function getVerticalList() {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'verticals'").get();
  try { return row ? JSON.parse(row.value) : []; } catch { return []; }
}
function saveVerticalList(arr) {
  db.prepare(
    "INSERT INTO settings (key, value) VALUES ('verticals', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
  ).run(JSON.stringify(arr));
}
function rememberVertical(name) {
  const n = String(name || '').trim();
  if (!n) return;
  const list = getVerticalList();
  if (!list.includes(n)) { list.push(n); saveVerticalList(list); }
}

export default async function contactsRoutes(app) {
  app.get('/api/contacts', async (req) => {
    const { tag, q, vertical } = req.query;
    let rows = db.prepare('SELECT * FROM contacts ORDER BY created_at DESC').all();
    if (vertical !== undefined) rows = rows.filter((r) => (r.vertical || '') === vertical);
    if (tag) rows = rows.filter((r) => (r.tags || '').split(',').map((t) => t.trim()).includes(tag));
    if (q) {
      const s = q.toLowerCase();
      rows = rows.filter((r) =>
        [r.email, r.first_name, r.last_name, r.company].some((v) => (v || '').toLowerCase().includes(s))
      );
    }
    return { contacts: rows, total: rows.length };
  });

  app.post('/api/contacts', async (req, reply) => {
    const c = req.body || {};
    if (!c.email) return reply.code(400).send({ error: 'email required' });
    return upsertContact(c);
  });

  app.put('/api/contacts/:id', async (req, reply) => {
    const id = Number(req.params.id);
    const existing = db.prepare('SELECT * FROM contacts WHERE id = ?').get(id);
    if (!existing) return reply.code(404).send({ error: 'not found' });
    const c = { ...existing, ...req.body };
    db.prepare(
      `UPDATE contacts SET email=?, first_name=?, last_name=?, company=?, tags=?,
        consent=?, unsubscribed=?, custom=?, vertical=? WHERE id=?`
    ).run(
      c.email, c.first_name || '', c.last_name || '', c.company || '', c.tags || '',
      c.consent ? 1 : 0, c.unsubscribed ? 1 : 0, c.custom || '{}', c.vertical || '', id
    );
    return db.prepare('SELECT * FROM contacts WHERE id = ?').get(id);
  });

  app.delete('/api/contacts/:id', async (req) => {
    db.prepare('DELETE FROM contacts WHERE id = ?').run(Number(req.params.id));
    return { ok: true };
  });

  // CSV import (pasted text) — body: { csv, tags, vertical }
  app.post('/api/contacts/import', async (req, reply) => {
    const { csv, tags = '', vertical = '' } = req.body || {};
    if (!csv) return reply.code(400).send({ error: 'csv text required' });
    let records;
    try {
      records = parse(csv, { columns: true, skip_empty_lines: true, trim: true });
    } catch (err) {
      return reply.code(400).send({ error: 'CSV parse failed: ' + err.message });
    }
    if (vertical) rememberVertical(vertical);
    return ingest(records, tags, vertical);
  });

  // File upload — multipart with a file part (.xlsx/.xls/.csv) and optional `tags` / `vertical` fields.
  app.post('/api/contacts/upload', async (req, reply) => {
    if (!req.isMultipart || !req.isMultipart()) {
      return reply.code(400).send({ error: 'expected a multipart file upload' });
    }
    let buffer = null, filename = '', tags = '', vertical = '';
    try {
      for await (const part of req.parts()) {
        if (part.type === 'file') {
          filename = part.filename || '';
          buffer = await part.toBuffer();
        } else if (part.fieldname === 'tags') {
          tags = String(part.value || '');
        } else if (part.fieldname === 'vertical') {
          vertical = String(part.value || '');
        }
      }
    } catch (err) {
      return reply.code(400).send({ error: 'upload failed: ' + err.message });
    }
    if (!buffer || !buffer.length) return reply.code(400).send({ error: 'no file received' });

    let records;
    try {
      records = await parseSpreadsheet(buffer, filename);
    } catch (err) {
      return reply.code(400).send({ error: 'could not read sheet: ' + err.message });
    }
    if (!records.length) return reply.code(400).send({ error: 'no rows found (is row 1 a header with an "email" column?)' });
    if (vertical) rememberVertical(vertical);
    return { filename, ...ingest(records, tags, vertical) };
  });

  // Bulk delete — body: { ids: [...] }  OR  { all: true, vertical?: "Medical" }.
  // `all` with no vertical wipes every contact; with a vertical wipes just that one.
  app.post('/api/contacts/bulk-delete', async (req) => {
    const { ids, all, vertical } = req.body || {};
    if (Array.isArray(ids) && ids.length) {
      let deleted = 0;
      // Chunk to stay well under SQLite's bound-parameter limit.
      for (let i = 0; i < ids.length; i += 400) {
        const chunk = ids.slice(i, i + 400).map(Number).filter((n) => Number.isFinite(n));
        if (!chunk.length) continue;
        const ph = chunk.map(() => '?').join(',');
        deleted += db.prepare(`DELETE FROM contacts WHERE id IN (${ph})`).run(...chunk).changes || 0;
      }
      return { deleted };
    }
    if (all) {
      const r = vertical
        ? db.prepare('DELETE FROM contacts WHERE vertical = ?').run(vertical)
        : db.prepare('DELETE FROM contacts').run();
      return { deleted: r.changes || 0 };
    }
    return { deleted: 0 };
  });

  // Verticals list with per-vertical contact counts (for the sidebar sub-menu).
  app.get('/api/verticals', async () => {
    const names = new Set(getVerticalList());
    const counts = {};
    for (const r of db.prepare("SELECT vertical, COUNT(*) AS n FROM contacts GROUP BY vertical").all()) {
      const name = r.vertical || '';
      counts[name] = r.n;
      if (name) names.add(name);
    }
    const verticals = [...names].sort((a, b) => a.localeCompare(b)).map((name) => ({ name, count: counts[name] || 0 }));
    const total = db.prepare('SELECT COUNT(*) AS n FROM contacts').get().n;
    return { verticals, total };
  });

  // Create (label) a new vertical so it shows even before any contacts are in it.
  app.post('/api/verticals', async (req, reply) => {
    const name = String((req.body || {}).name || '').trim();
    if (!name) return reply.code(400).send({ error: 'name required' });
    rememberVertical(name);
    return { ok: true, name };
  });

  // Remove a vertical label. By default contacts are kept but un-filed (vertical
  // cleared); pass ?deleteContacts=1 to delete the contacts in it too.
  app.delete('/api/verticals/:name', async (req) => {
    const name = req.params.name;
    saveVerticalList(getVerticalList().filter((v) => v !== name));
    let deleted = 0;
    if (req.query.deleteContacts === '1') {
      deleted = db.prepare('DELETE FROM contacts WHERE vertical = ?').run(name).changes || 0;
    } else {
      db.prepare("UPDATE contacts SET vertical = '' WHERE vertical = ?").run(name);
    }
    return { ok: true, deleted };
  });

  app.get('/api/contacts/export', async (req, reply) => {
    const rows = db.prepare('SELECT email,first_name,last_name,company,tags,consent,unsubscribed FROM contacts').all();
    reply.header('content-type', 'text/csv');
    reply.header('content-disposition', 'attachment; filename="contacts.csv"');
    return stringify(rows, { header: true });
  });

  // Distinct tag list for the UI filters/audience picker.
  app.get('/api/tags', async () => {
    const rows = db.prepare('SELECT tags FROM contacts').all();
    const set = new Set();
    for (const r of rows) (r.tags || '').split(',').map((t) => t.trim()).filter(Boolean).forEach((t) => set.add(t));
    return { tags: [...set].sort() };
  });
}

export function upsertContact(c) {
  db.prepare(
    `INSERT INTO contacts (email, first_name, last_name, company, tags, source, consent, custom, vertical)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(email) DO UPDATE SET
       first_name = CASE WHEN excluded.first_name != '' THEN excluded.first_name ELSE contacts.first_name END,
       last_name  = CASE WHEN excluded.last_name  != '' THEN excluded.last_name  ELSE contacts.last_name END,
       company    = CASE WHEN excluded.company    != '' THEN excluded.company    ELSE contacts.company END,
       tags       = excluded.tags,
       vertical   = CASE WHEN excluded.vertical != '' THEN excluded.vertical ELSE contacts.vertical END`
  ).run(
    c.email.trim().toLowerCase(),
    c.first_name || '', c.last_name || '', c.company || '',
    c.tags || '', c.source || 'manual', c.consent ? 1 : 0, c.custom || '{}', c.vertical || ''
  );
  return db.prepare('SELECT * FROM contacts WHERE email = ?').get(c.email.trim().toLowerCase());
}
