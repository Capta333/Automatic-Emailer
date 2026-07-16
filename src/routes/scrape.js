import { scrapeUrl } from '../services/scraper.js';
import { upsertContact } from './contacts.js';

export default async function scrapeRoutes(app) {
  // Preview: scrape one or more URLs, return discovered contacts WITHOUT saving.
  app.post('/api/scrape/preview', async (req, reply) => {
    const { urls } = req.body || {};
    const list = Array.isArray(urls) ? urls : [urls].filter(Boolean);
    if (!list.length) return reply.code(400).send({ error: 'urls required' });
    const results = [];
    for (const url of list.slice(0, 25)) {
      try {
        results.push(await scrapeUrl(url));
      } catch (err) {
        results.push({ url, error: err.message, contacts: [] });
      }
    }
    const all = results.flatMap((r) => r.contacts || []);
    return { results, contacts: dedupe(all), found: all.length };
  });

  // Save selected scraped contacts. consent defaults to 0 (must be reviewed before sending).
  app.post('/api/scrape/save', async (req, reply) => {
    const { contacts, tags = 'scraped' } = req.body || {};
    if (!Array.isArray(contacts) || !contacts.length)
      return reply.code(400).send({ error: 'contacts array required' });
    let saved = 0;
    for (const c of dedupe(contacts)) {
      if (!c.email) continue;
      upsertContact({ ...c, tags: [tags, c.tags].filter(Boolean).join(','), source: 'scrape', consent: 0 });
      saved++;
    }
    return { saved };
  });
}

function dedupe(contacts) {
  const seen = new Map();
  for (const c of contacts) {
    const key = (c.email || '').toLowerCase();
    if (key && !seen.has(key)) seen.set(key, c);
  }
  return [...seen.values()];
}
