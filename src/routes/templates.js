import { db } from '../db.js';

export default async function templatesRoutes(app) {
  app.get('/api/templates', async () => ({
    templates: db.prepare('SELECT * FROM templates ORDER BY updated_at DESC').all(),
  }));

  app.get('/api/templates/:id', async (req, reply) => {
    const t = db.prepare('SELECT * FROM templates WHERE id = ?').get(Number(req.params.id));
    return t || reply.code(404).send({ error: 'not found' });
  });

  app.post('/api/templates', async (req, reply) => {
    const { name, subject = '', body = '' } = req.body || {};
    if (!name) return reply.code(400).send({ error: 'name required' });
    const info = db.prepare('INSERT INTO templates (name, subject, body) VALUES (?, ?, ?)').run(name, subject, body);
    return db.prepare('SELECT * FROM templates WHERE id = ?').get(info.lastInsertRowid);
  });

  app.put('/api/templates/:id', async (req, reply) => {
    const id = Number(req.params.id);
    const t = db.prepare('SELECT * FROM templates WHERE id = ?').get(id);
    if (!t) return reply.code(404).send({ error: 'not found' });
    const { name = t.name, subject = t.subject, body = t.body } = req.body || {};
    db.prepare("UPDATE templates SET name=?, subject=?, body=?, updated_at=datetime('now') WHERE id=?")
      .run(name, subject, body, id);
    return db.prepare('SELECT * FROM templates WHERE id = ?').get(id);
  });

  app.delete('/api/templates/:id', async (req) => {
    db.prepare('DELETE FROM templates WHERE id = ?').run(Number(req.params.id));
    return { ok: true };
  });
}
