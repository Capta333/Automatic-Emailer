// SMTP transport wrapper around nodemailer, with dry-run support.
import nodemailer from 'nodemailer';
import { config } from '../config.js';

let transporter = null;
let transporterKey = '';

function buildTransporter() {
  const key = JSON.stringify(config.smtp);
  if (transporter && key === transporterKey) return transporter;
  transporter = nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.secure,
    auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined,
  });
  transporterKey = key;
  return transporter;
}

// Pass `overrideSmtp` to test arbitrary (e.g. unsaved form) settings without
// touching the cached transporter used for real sends.
export async function verifySmtp(overrideSmtp) {
  const smtp = overrideSmtp || config.smtp;
  if (!smtp.host) return { ok: false, error: 'No SMTP host configured' };
  try {
    const t = overrideSmtp
      ? nodemailer.createTransport({
          host: smtp.host,
          port: smtp.port,
          secure: smtp.secure,
          auth: smtp.user ? { user: smtp.user, pass: smtp.pass } : undefined,
        })
      : buildTransporter();
    await t.verify();
    return { ok: true, host: smtp.host, port: smtp.port };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// Returns { sent: true } or { sent: false, dryRun: true } or throws.
export async function sendMail({ to, subject, html }) {
  const from = `"${config.sender.name}" <${config.sender.email}>`;
  if (config.dryRun) {
    return { sent: false, dryRun: true, to, subject };
  }
  if (!config.smtp.host) throw new Error('SMTP not configured (set host in Settings)');
  const info = await buildTransporter().sendMail({ from, to, subject, html });
  return { sent: true, messageId: info.messageId, to, subject };
}
