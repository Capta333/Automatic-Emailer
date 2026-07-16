// Lightweight web scraper for lead discovery from PUBLIC business pages
// (e.g. a company "contact" / "team" page you have a legitimate reason to reach).
//
// Uses fetch + cheerio (static HTML). For JS-heavy sites, swap in Playwright later
// — see docs. Respects robots.txt by default and skips obvious noise addresses.
import * as cheerio from 'cheerio';

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const SKIP_SUBSTR = ['example.com', 'sentry.', 'wixpress.com', '.png', '.jpg', '.gif', '.webp'];
const SKIP_PREFIX = ['noreply', 'no-reply', 'donotreply', 'mailer-daemon', 'postmaster'];

export async function scrapeUrl(url, { respectRobots = true } = {}) {
  const base = new URL(url);
  if (respectRobots) {
    const allowed = await robotsAllows(base);
    if (!allowed) {
      return { url, blockedByRobots: true, emails: [], contacts: [] };
    }
  }

  const res = await fetch(url, {
    headers: { 'user-agent': 'EmailCampaigner/0.1 (+contact-discovery)' },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`Fetch failed ${res.status} for ${url}`);
  const html = await res.text();
  const $ = cheerio.load(html);

  const found = new Map(); // email -> {email, context}

  // 1) mailto: links carry the most reliable addresses (+ nearby name text)
  $('a[href^="mailto:"]').each((_, el) => {
    const href = $(el).attr('href') || '';
    const email = decodeURIComponent(href.replace(/^mailto:/i, '').split('?')[0]).trim();
    const context = $(el).text().trim() || $(el).closest('li,div,td,p').text().trim().slice(0, 120);
    addEmail(found, email, context);
  });

  // 2) raw addresses anywhere in the visible text
  const bodyText = $('body').text();
  for (const m of bodyText.matchAll(EMAIL_RE)) addEmail(found, m[0], '');

  const pageTitle = $('title').first().text().trim();
  const company = guessCompany(pageTitle, base);

  const contacts = [...found.values()].map((f) => ({
    email: f.email,
    ...splitName(f.context),
    company,
    source: 'scrape',
    sourceUrl: url,
  }));

  return { url, title: pageTitle, company, emails: [...found.keys()], contacts };
}

function addEmail(map, email, context) {
  email = (email || '').trim().toLowerCase();
  if (!email || !EMAIL_RE.test(email)) return;
  if (SKIP_SUBSTR.some((s) => email.includes(s))) return;
  if (SKIP_PREFIX.some((p) => email.startsWith(p))) return;
  if (!map.has(email)) map.set(email, { email, context: context || '' });
  else if (context && !map.get(email).context) map.get(email).context = context;
}

function splitName(context) {
  // Heuristic: a short "Firstname Lastname" near a mailto link.
  const m = (context || '').match(/\b([A-Z][a-z]+)\s+([A-Z][a-z]+)\b/);
  if (m) return { first_name: m[1], last_name: m[2] };
  return { first_name: '', last_name: '' };
}

function guessCompany(title, base) {
  if (title) return title.split(/[|\-–—]/)[0].trim().slice(0, 80);
  return base.hostname.replace(/^www\./, '');
}

async function robotsAllows(base) {
  try {
    const res = await fetch(`${base.origin}/robots.txt`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return true; // no robots.txt => allowed
    const txt = await res.text();
    // Minimal check: a global "Disallow: /" under User-agent: * blocks us.
    const lines = txt.split('\n').map((l) => l.trim().toLowerCase());
    let inStar = false;
    for (const line of lines) {
      if (line.startsWith('user-agent:')) inStar = line.includes('*');
      if (inStar && line === 'disallow: /') return false;
    }
    return true;
  } catch {
    return true;
  }
}
