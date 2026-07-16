import { db, logEvent } from '../db.js';
import { sendMail } from '../services/mailer.js';
import { render, withFooter } from '../services/personalize.js';

// Send one email immediately, bypassing campaigns and the queue. Handy for
// testing SMTP from a simple standpoint and for ad-hoc one-off sends. Respects
// DRY RUN like everything else.
export default async function sendRoutes(app) {
  app.post('/api/send-single', async (req, reply) => {
    const { to, subject = '', html = '', templateId, contactId, footer = false } = req.body || {};
    if (!to || !String(to).includes('@')) {
      return reply.code(400).send({ error: 'a valid "to" address is required' });
    }

    let finalSubject = subject;
    let finalHtml = html;

    // Optionally render a saved template (with a real contact, or a stand-in).
    if (templateId) {
      const t = db.prepare('SELECT * FROM templates WHERE id = ?').get(Number(templateId));
      if (!t) return reply.code(404).send({ error: 'template not found' });
      const contact = contactId
        ? db.prepare('SELECT * FROM contacts WHERE id = ?').get(Number(contactId))
        : { id: 0, email: to, first_name: 'there', last_name: '', company: '', custom: '{}' };
      finalSubject = render(t.subject, contact);
      finalHtml = render(t.body, contact);
      if (footer) finalHtml = withFooter(finalHtml, contact);
    }

    if (!finalSubject && !finalHtml) {
      return reply.code(400).send({ error: 'subject or body is required' });
    }

    try {
      const result = await sendMail({ to, subject: finalSubject || '(no subject)', html: finalHtml || '' });
      logEvent({ type: 'sent', detail: `single → ${to}${result.dryRun ? ' (DRY_RUN)' : ''}` });
      return { ok: true, dryRun: !!result.dryRun, messageId: result.messageId || null, to };
    } catch (err) {
      logEvent({ type: 'failed', detail: `single → ${to}: ${err.message}` });
      return reply.code(502).send({ error: err.message });
    }
  });
}
