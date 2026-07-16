# Make.com integration

Two directions, both optional. Configure URLs/secret in **Settings → Make.com**.

## 1. Outbound — Campaigner ➜ Make.com (events)

When set, the app POSTs JSON to your **Make.com Custom Webhook** URL on key events:

| event           | payload                                            |
|-----------------|----------------------------------------------------|
| `email.sent`    | `{ campaignId, email, dryRun }`                     |
| `campaign.done` | `{ campaignId, stats: { sent, failed, skipped } }` |

All payloads include `event` and `at` (ISO timestamp).

**Setup in Make.com:**
1. Create a scenario → add **Webhooks › Custom webhook** as the trigger.
2. Copy the generated URL into Settings → Make.com → *Outbound webhook URL*.
3. Run a dry-run campaign so Make.com captures the data structure.
4. Add downstream modules — e.g. log to Google Sheets, post to Slack, update a CRM.

## 2. Inbound — Make.com ➜ Campaigner (triggers)

Make.com (or anything) can drive the app via:

```
POST /webhooks/make
Header: x-make-secret: <your MAKE_INBOUND_SECRET>
Body:
  { "action": "add_contact", "data": { "email": "...", "first_name": "...", "tags": "lead" } }
  { "action": "run_campaign", "data": { "campaignId": 3 } }
```

Set the shared secret in Settings → Make.com → *Inbound secret*. Requests without the
matching `x-make-secret` header get `401`.

**Example scenarios:**
- New row in a Google Sheet → `add_contact`
- Typeform submission → `add_contact` with tags
- Scheduled trigger (Make.com cron) → `run_campaign` for a recurring newsletter

## Note on make.com vs. this tool

Make.com is great as the *glue* (triggers, CRM sync, logging) but isn't built to author
and send personalized bulk campaigns with previews and an audience UI — that's what this
app is for. Use them together: this app owns contacts + sending; Make.com owns automation
around it.
