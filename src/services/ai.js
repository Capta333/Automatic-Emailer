// AI copy generation. Supports local Ollama (free) or Claude API.
import { config } from '../config.js';

const SYSTEM = `You are an expert email marketing copywriter.
Write concise, warm, high-converting outreach emails.
Rules:
- Use {{firstName}} and {{company}} merge tokens where natural (do not invent other tokens).
- No spammy phrasing, no ALL CAPS, no excessive exclamation marks.
- Keep it skimmable. One clear call to action.
- Return STRICT JSON: {"subject": "...", "body": "..."} where body is simple HTML
  (<p>, <a>, <ul>) with no <html>/<head> wrapper. No commentary outside the JSON.`;

export async function generateEmail({ prompt, tone = 'friendly', goal = '' }) {
  const userMsg = `Write a marketing/outreach email.
Tone: ${tone}
Goal / call to action: ${goal || 'start a conversation'}
Brief from the user:
${prompt}`;

  const raw =
    config.ai.provider === 'claude'
      ? await viaClaude(SYSTEM, userMsg)
      : await viaOllama(SYSTEM, userMsg);

  return parseEmailJson(raw);
}

function parseEmailJson(raw) {
  // Models sometimes wrap JSON in prose or ```json fences. Extract the object.
  const match = raw.match(/\{[\s\S]*\}/);
  const text = match ? match[0] : raw;
  try {
    const obj = JSON.parse(text);
    return { subject: obj.subject || '', body: obj.body || '', raw };
  } catch {
    // Fallback: first line = subject, rest = body.
    const lines = raw.trim().split('\n');
    return { subject: lines[0].slice(0, 120), body: `<p>${raw.trim()}</p>`, raw };
  }
}

async function viaOllama(system, user) {
  const res = await fetch(`${config.ai.ollamaUrl}/api/generate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: config.ai.ollamaModel,
      system,
      prompt: user,
      stream: false,
      options: { temperature: 0.7 },
    }),
  });
  if (!res.ok) throw new Error(`Ollama error ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.response || '';
}

async function viaClaude(system, user) {
  if (!config.ai.anthropicKey) throw new Error('ANTHROPIC_API_KEY not set');
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': config.ai.anthropicKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: config.ai.claudeModel,
      max_tokens: 1024,
      system,
      messages: [{ role: 'user', content: user }],
    }),
  });
  if (!res.ok) throw new Error(`Claude error ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.content?.[0]?.text || '';
}

export async function aiHealth() {
  if (config.ai.provider === 'claude') {
    return { provider: 'claude', ok: !!config.ai.anthropicKey, model: config.ai.claudeModel };
  }
  try {
    const res = await fetch(`${config.ai.ollamaUrl}/api/tags`, { signal: AbortSignal.timeout(2500) });
    const data = await res.json();
    const models = (data.models || []).map((m) => m.name);
    return { provider: 'ollama', ok: true, model: config.ai.ollamaModel, available: models };
  } catch (err) {
    return { provider: 'ollama', ok: false, error: err.message };
  }
}
