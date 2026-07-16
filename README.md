# ✉️ Email Campaigner

An all-in-one, self-hosted email campaign tool with a clean GUI:

- **Contacts** — add, **upload Excel/CSV** or paste CSV, export, tag, consent + unsubscribe
- **Find Leads** — scrape public business pages for contact addresses (review before use)
- **Templates** — reusable emails with `{{firstName}}` / `{{company}}` merge fields
- **✨ AI compose** — generate subject + body with local Ollama (free) or Claude API
- **Campaigns + drip** — initial email plus up to **two follow-ups** auto-scheduled a set
  number of **business days** apart; **preview** the schedule before launch
- **Anti-spam pacing** — a background worker sends **one email per spacing interval**
  (~45s default, with jitter) so blasts look human-paced
- **📈 Tracking** — open pixel + click redirect → per-recipient opens/clicks, plus bounce
  & unsubscribe status. See [`docs/TRACKING.md`](docs/TRACKING.md) for what is/isn't detectable
- **Make.com** — outbound event webhooks (sent/opened/clicked/bounced) + inbound triggers
- **Single send** — fire one email immediately (Settings or the template editor) for testing
- **Accounts** — individual logins with hashed passwords + roles, for the hosted version
  (auto-disabled for local desktop use)
- **Safety first** — starts in **DRY RUN** (nothing actually sends),
  auto unsubscribe links + CAN-SPAM footer, suppression of unsubscribed contacts

Everything runs **locally** on your machine. Contacts live in a local SQLite file
(`data/campaigner.db`). No cloud account required.

---

## Quick start

```bash
cd email-campaigner
npm install
cp .env.example .env       # then edit .env (or configure later in the Settings UI)
npm start
```

Open **http://localhost:4787**.

> It boots in **DRY RUN** mode — you can click through, build campaigns, and run them
> without sending a single real email. Flip the switch in **Settings → Sending safety**
> once your SMTP works and you've previewed real output.

---

## Configure sending (SMTP)

In **Settings → SMTP**, enter your provider's credentials and click **Test connection**:

| Provider          | Host                    | Port | Notes                              |
|-------------------|-------------------------|------|------------------------------------|
| Gmail / Workspace | smtp.gmail.com          | 587  | Use an **App Password**, not login |
| Brevo (Sendinblue)| smtp-relay.brevo.com    | 587  | Free tier ~300/day                 |
| SendGrid          | smtp.sendgrid.net       | 587  | Username is literally `apikey`     |
| Mailgun           | smtp.mailgun.org        | 587  |                                    |

For real bulk sending, use a transactional provider (Brevo/SendGrid/Mailgun) rather than
a personal Gmail — better deliverability and you won't get rate-limited or flagged.

---

## AI copy

Default provider is **Ollama** (local, free). Make sure Ollama is running and the model
in Settings is pulled:

```bash
ollama pull qwen2.5-coder:7b
```

Or switch to **Claude API** in Settings and paste an Anthropic key for higher-quality copy.

---

## Responsible use ⚖️

This tool can scrape addresses and send bulk mail — that power comes with rules. See
[`docs/COMPLIANCE.md`](docs/COMPLIANCE.md). In short: only email people you have a
legitimate reason to contact, always include a working unsubscribe (this app does it for
you), honor opt-outs, and follow CAN-SPAM / GDPR / CASL. Scraped contacts are saved
**without consent** and excluded from nothing automatically — review them first.

---

## Architecture

```
src/
  server.js          Fastify app + static GUI + /api/stats
  config.js          env + runtime settings
  db.js              node:sqlite schema + helpers
  routes/            REST API (contacts, templates, campaigns, ai, scrape, settings, webhooks)
  services/
    auth.js          scrypt password hashing + cookie sessions (built-in crypto)
    mailer.js        nodemailer SMTP (+ dry-run)
    sender.js        enqueue campaigns + background worker (drains queue, paces sends)
    schedule.js      business-day math for the follow-up drip
    tracking.js      open-pixel + click-link tokens/injection
    spreadsheet.js   Excel/CSV parsing (exceljs + csv-parse)
    scraper.js       fetch + cheerio lead discovery (robots-aware)
    ai.js            Ollama / Claude copy generation
    personalize.js   merge fields + unsubscribe + footer
    make.js          outbound webhook notifier
public/              vanilla SPA GUI (no build step)
data/                local SQLite db (gitignored)
```

### How sending works now
Launching a campaign **enqueues** one job per recipient per step (initial + follow-ups)
into a `queue` table, each stamped with a `send_after` time. A single background worker
picks the next due job, sends it, then waits the spacing interval before the next — so
sends are both **drip-scheduled** (business-day gaps) and **rate-paced** (anti-spam) at
once. The queue is persistent, so a restart resumes where it left off.

No build step, no framework lock-in. To extend scraping to JS-heavy sites, drop in
Playwright in `scraper.js` (see code comment).

### Authentication & hosting
The app is a standard Node web server, so the same codebase runs locally *and* deploys
to the web (the cross-platform answer — your boss opens a URL, no install).

- **Login** is on by default. On first run you create the initial **admin**; admins add
  teammates under **Settings → Users**. Passwords are scrypt-hashed; sessions are
  httpOnly cookies (only a token *hash* is stored server-side).
- **Local desktop use** sets `AUTH_DISABLED=1` (the launcher does this) to skip login.
  **Never set that on a public deployment.**
- Public, unauthenticated routes (by design): the open pixel `/t/o/*`, click redirect
  `/t/c/*`, `/unsubscribe`, and the inbound `/webhooks/make` hook.
- **Hosting needs:** a **persistent disk** (the SQLite file lives on disk) and an
  **always-on process** (the drip worker runs continuously) — so a small VPS or an
  always-on host (Railway/Render/Fly), *not* scale-to-zero serverless. Set
  `PUBLIC_BASE_URL` to your https domain so tracking/unsubscribe links resolve.

## Roadmap / next steps

- Reply detection (IMAP) to auto-stop follow-ups once someone responds
- A/B subject testing
- Google Postmaster Tools / seed-list integration for real spam-placement visibility
- Packaging as a desktop app (Electron/Tauri) for a one-click `.exe`
