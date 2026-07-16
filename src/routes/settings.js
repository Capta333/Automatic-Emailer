import { config, applySettingsOverride } from '../config.js';
import { getSettings, saveSettings } from '../db.js';
import { verifySmtp } from '../services/mailer.js';

// Redact secrets when returning settings to the browser.
function publicConfig() {
  return {
    sender: config.sender,
    smtp: { ...config.smtp, pass: config.smtp.pass ? '••••••' : '' },
    ai: { ...config.ai, anthropicKey: config.ai.anthropicKey ? '••••••' : '' },
    make: config.make,
    dryRun: config.dryRun,
    ratePerMin: config.ratePerMin,
    sendSpacingSeconds: config.sendSpacingSeconds,
    sendJitterSeconds: config.sendJitterSeconds,
  };
}

export default async function settingsRoutes(app) {
  app.get('/api/settings', async () => publicConfig());

  app.put('/api/settings', async (req) => {
    const incoming = req.body || {};
    // Don't overwrite secrets with the redacted placeholder.
    if (incoming.smtp?.pass === '••••••') delete incoming.smtp.pass;
    if (incoming.ai?.anthropicKey === '••••••') delete incoming.ai.anthropicKey;

    const merged = { ...(getSettings() || {}), ...incoming };
    if (incoming.smtp) merged.smtp = { ...(getSettings()?.smtp || {}), ...incoming.smtp };
    if (incoming.ai) merged.ai = { ...(getSettings()?.ai || {}), ...incoming.ai };
    if (incoming.sender) merged.sender = { ...(getSettings()?.sender || {}), ...incoming.sender };
    if (incoming.make) merged.make = { ...(getSettings()?.make || {}), ...incoming.make };

    saveSettings(merged);
    applySettingsOverride(merged);
    return publicConfig();
  });

  app.post('/api/settings/test-smtp', async () => verifySmtp());
}
