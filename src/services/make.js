// Make.com (Integromat) outbound webhook notifier. Fire-and-forget; never blocks sending.
import { config } from '../config.js';

export function notifyMake(event, payload) {
  if (!config.make.webhookUrl) return;
  fetch(config.make.webhookUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ event, at: new Date().toISOString(), ...payload }),
    signal: AbortSignal.timeout(8000),
  }).catch(() => {
    /* swallow — Make.com delivery is best-effort */
  });
}
