# Responsible & legal sending

Bulk email and contact scraping are regulated. Staying compliant also means better
deliverability (less spam-foldering). This is a practical checklist, not legal advice.

## Built-in protections in this app
- **Dry-run by default** — you must consciously turn on live sending.
- **Unsubscribe link** auto-injected into every email; clicks set `unsubscribed=1`.
- **Suppression** — unsubscribed contacts are excluded from all audiences automatically.
- **Physical-address footer** — set your mailing address in Settings (CAN-SPAM requires it).
- **Rate limiting** — per-minute throttle to protect sender reputation.
- **Consent flag** — contacts track whether they explicitly opted in; scraped leads are
  saved with consent = false so you can review before contacting.

## CAN-SPAM (US) — the basics
1. Don't use false/misleading headers or subject lines.
2. Identify the message as an ad if it is one.
3. Include a valid physical postal address.
4. Provide a clear way to opt out, and honor it within 10 business days.
5. Monitor what others send on your behalf.

## GDPR / CASL (EU / Canada)
- These generally require **prior consent** (opt-in) before emailing individuals.
- Scraped addresses usually do **not** constitute consent — be especially careful with
  EU/Canada recipients. Prefer B2B role addresses with a legitimate business interest,
  and always honor objections.

## Scraping etiquette
- The scraper honors `robots.txt` global disallows and identifies itself via User-Agent.
- Only collect **publicly published business** contact info you have a real reason to use.
- Don't hammer sites; the UI caps batches and the scraper times out politely.
- When in doubt, don't. A small list of interested people beats a big list of annoyed ones.
