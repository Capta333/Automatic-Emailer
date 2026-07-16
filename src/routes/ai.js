import { generateEmail, aiHealth } from '../services/ai.js';

export default async function aiRoutes(app) {
  app.get('/api/ai/health', async () => aiHealth());

  app.post('/api/ai/generate', async (req, reply) => {
    const { prompt, tone, goal } = req.body || {};
    if (!prompt) return reply.code(400).send({ error: 'prompt required' });
    try {
      return await generateEmail({ prompt, tone, goal });
    } catch (err) {
      return reply.code(502).send({ error: err.message });
    }
  });
}
