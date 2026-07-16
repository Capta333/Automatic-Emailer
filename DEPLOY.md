# Deploy Email Campaigner

This app is a Node web service with a SQLite database and background sending worker. It must be deployed on a host that supports long-running Node processes and persistent disk storage.

## Recommended host: Render

1. Create a GitHub repository for this folder and push the code.
2. In Render, choose **New +** -> **Blueprint**.
3. Connect the GitHub repository.
4. Render will read `render.yaml` and create a web service with a 1 GB persistent disk mounted at `/var/data/email-campaigner`.
5. Fill in the environment variables Render marks as unsynced:

| Key | Value |
| --- | --- |
| `PUBLIC_BASE_URL` | The final Render/custom-domain URL, such as `https://email-campaigner.onrender.com` |
| `SENDER_NAME` | The sender display name |
| `SENDER_EMAIL` | The sender email address |
| `SENDER_ADDRESS` | Physical mailing address for CAN-SPAM footer |
| `SMTP_HOST` | SMTP provider host, such as `smtp-relay.brevo.com` |
| `SMTP_USER` | SMTP username |
| `SMTP_PASS` | SMTP password/API key |
| `ANTHROPIC_API_KEY` | Optional, only needed for Claude AI copy |
| `MAKE_WEBHOOK_URL` | Optional Make.com outbound webhook |
| `MAKE_INBOUND_SECRET` | Optional shared inbound Make.com secret |

## First launch

1. Keep `DRY_RUN=true` for the first deployment.
2. Open the public URL.
3. Create the first admin account on the setup screen.
4. Add SMTP settings and send one test email.
5. Confirm tracking, unsubscribe links, and campaign previews use the public URL.
6. Change `DRY_RUN=false` only after the test is clean.

## Important settings

- Do not set `AUTH_DISABLED` on the public service. Login is enabled by default.
- Keep `DATA_DIR=/var/data/email-campaigner`; this is where `campaigner.db` persists.
- Do not commit `.env`, `data/`, or `node_modules/`.
- If you add a custom domain later, update `PUBLIC_BASE_URL` to that domain.
