// Authentication: scrypt password hashing (no native dep), server-side sessions
// stored as a token hash, and small cookie helpers. Used by routes/auth.js and
// the onRequest gate in server.js.
import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import { db } from '../db.js';
import { config } from '../config.js';

const COOKIE = 'ec_session';
const SESSION_DAYS = 30;

// ── Passwords ──────────────────────────────────────────────────────────────
export function hashPassword(pw) {
  const salt = randomBytes(16);
  const hash = scryptSync(String(pw), salt, 64);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export function verifyPassword(pw, stored) {
  const [algo, saltHex, hashHex] = String(stored || '').split('$');
  if (algo !== 'scrypt' || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = scryptSync(String(pw), Buffer.from(saltHex, 'hex'), expected.length);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

// ── Users ──────────────────────────────────────────────────────────────────
export function userCount() {
  return db.prepare('SELECT COUNT(*) n FROM users').get().n;
}

export function getUserByEmail(email) {
  return db.prepare('SELECT * FROM users WHERE email = ?').get(String(email || '').trim().toLowerCase());
}

export function createUser({ email, name = '', password, role = 'user' }) {
  const e = String(email || '').trim().toLowerCase();
  if (!e || !e.includes('@')) throw new Error('valid email required');
  if (!password || String(password).length < 8) throw new Error('password must be at least 8 characters');
  if (getUserByEmail(e)) throw new Error('a user with that email already exists');
  const info = db
    .prepare('INSERT INTO users (email, name, password_hash, role) VALUES (?, ?, ?, ?)')
    .run(e, name, hashPassword(password), role === 'admin' ? 'admin' : 'user');
  return publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid));
}

export function setPassword(userId, password) {
  if (!password || String(password).length < 8) throw new Error('password must be at least 8 characters');
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(password), Number(userId));
  // Force re-login everywhere after a password change.
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(Number(userId));
}

export function deleteUser(userId) {
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(Number(userId));
  db.prepare('DELETE FROM users WHERE id = ?').run(Number(userId));
}

export function listUsers() {
  return db.prepare('SELECT id, email, name, role, created_at FROM users ORDER BY id').all();
}

export const publicUser = (u) => (u ? { id: u.id, email: u.email, name: u.name, role: u.role } : null);

// ── Sessions ───────────────────────────────────────────────────────────────
const tokenHash = (t) => createHash('sha256').update(String(t)).digest('hex');

export function createSession(userId) {
  const token = randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + SESSION_DAYS * 86400_000).toISOString();
  db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)')
    .run(tokenHash(token), Number(userId), expires);
  return token;
}

export function destroySession(token) {
  if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash(token));
}

export function userForToken(token) {
  if (!token) return null;
  const row = db
    .prepare(
      `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ? AND s.expires_at > ?`
    )
    .get(tokenHash(token), new Date().toISOString());
  return row ? publicUser(row) : null;
}

// ── Cookies ────────────────────────────────────────────────────────────────
export function parseCookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export function sessionCookieToken(req) {
  return parseCookies(req)[COOKIE] || null;
}

export function setSessionCookie(reply, token) {
  const secure = config.publicBaseUrl.startsWith('https');
  reply.header(
    'set-cookie',
    `${COOKIE}=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}${secure ? '; Secure' : ''}`
  );
}

export function clearSessionCookie(reply) {
  reply.header('set-cookie', `${COOKIE}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`);
}

// Synthetic admin used when AUTH_DISABLED=1 (local mode) so admin-only UI works.
export const LOCAL_ADMIN = { id: 0, email: 'local', name: 'Local', role: 'admin' };
