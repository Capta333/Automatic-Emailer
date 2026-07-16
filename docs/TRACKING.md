# Email tracking — what's possible, and what isn't

This answers the boss's question: *"Can I see if emails go to spam, get read, or get
deleted?"* Short version: **opens and clicks, yes. Spam-placement and deletion, no —
not from a sending app.** Here's the honest breakdown and how to cover the gaps.

## What this app tracks (built in)

| Signal | How | Reliability |
| --- | --- | --- |
| **Sent** | SMTP accepted the message | High |
| **Opened** | Invisible 1×1 tracking pixel loads from `/t/o/<token>.gif` | **Directional** — see caveat |
| **Clicked** | Links are rewritten through `/t/c/<token>` then 302-redirected | High |
| **Unsubscribed** | Footer unsubscribe link | High |
| **Bounced** | Posted in by a Make.com bounce scenario (see below) | Depends on setup |

You can see all of this per-recipient in the **📈 Tracking** view, and in aggregate on
the Dashboard.

### The open-tracking caveat
Open tracking works by embedding a tiny invisible image with a unique URL. When the
recipient's mail client loads that image, we record an open. But:

- **Apple Mail Privacy Protection** pre-loads images for *all* mail → shows as an "open"
  even if the human never looked. Inflates opens.
- **Gmail / Outlook image proxies** cache images and may block or delay loads → can
  *miss* real opens, or attribute them to a proxy.
- A recipient reading in plain-text mode, or with images off, never loads the pixel.

So treat opens as a **trend signal**, not a precise per-person fact. Clicks are far more
reliable (a click is a real human action).

## What no sending app can tell you

- **"Went to spam"** — mail providers do **not** report inbox-vs-spam placement back to
  the sender. A pixel in a spam-foldered email simply never loads, which is
  indistinguishable from "delivered but unopened."
- **"Deleted unread"** — there is no signal for this at all.

Anyone claiming a self-hosted tool can directly detect spam-foldering or deletion is
mistaken. The real ways to monitor placement and reputation:

### 1. Google Postmaster Tools (free, do this first)
Domain-level reputation, spam-rate, and delivery errors for mail you send to Gmail.
Requires sending from your own domain with SPF + DKIM + DMARC set up.
→ https://postmaster.google.com

### 2. Seed-list / inbox-placement testing
Send a campaign to a panel of seed inboxes across Gmail/Outlook/Yahoo and get an
inbox-vs-spam-vs-promotions report. Tools: **GlockApps, MailReach, Mailtrap**. This is
the closest you get to "is it landing in spam."

### 3. Authentication (the biggest lever on whether you hit spam)
Set up **SPF, DKIM, and DMARC** on the sending domain. Without these, you'll spam-folder
regardless of content. Your SMTP/ESP provider has setup docs.

### 4. Feedback Loops (FBLs) + bounce handling
Hard bounces and spam-complaint feedback should suppress the address. This app exposes a
Make.com `bounce` action (below) so those can flow back in and auto-unsubscribe.

## Wiring bounces back in via Make.com
Create a Make.com scenario that watches the sending mailbox for bounce / mailer-daemon
messages, parses the failed address, and POSTs:

```
POST /webhooks/make      header: x-make-secret: <MAKE_INBOUND_SECRET>
{ "action": "bounce", "data": { "email": "x@y.com", "hard": true, "reason": "550 no such user" } }
```

Hard bounces auto-unsubscribe the contact and cancel their pending follow-ups.

## Practical reading of the numbers
- **High opens, low clicks** → subject works, body/CTA doesn't.
- **Low opens across the board** → likely deliverability/spam (check Postmaster Tools),
  *or* Apple/Gmail blocking pixels. Run a seed test to confirm.
- **Rising bounces / complaints** → list quality problem; slow down and clean the list.
