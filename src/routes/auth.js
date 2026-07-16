import { config } from '../config.js';
import {
  getUserByEmail, verifyPassword, createSession, destroySession,
  setSessionCookie, clearSessionCookie, sessionCookieToken,
  userCount, createUser, listUsers, deleteUser, setPassword,
  LOCAL_ADMIN,
} from '../services/auth.js';

export default async function authRoutes(app) {
  // Status for the login page + the app: who am I, is auth even on, is setup needed.
  app.get('/api/auth/me', async (req) => {
    if (config.authDisabled) return { authDisabled: true, user: LOCAL_ADMIN, needsSetup: false };
    return { authDisabled: false, user: req.user || null, needsSetup: userCount() === 0 };
  });

  // First-run: create the initial admin (only allowed while there are zero users).
  app.post('/api/auth/setup', async (req, reply) => {
    if (config.authDisabled) return reply.code(400).send({ error: 'auth is disabled' });
    if (userCount() > 0) return reply.code(409).send({ error: 'already set up' });
    const { email, name, password } = req.body || {};
    try {
      const user = createUser({ email, name, password, role: 'admin' });
      setSessionCookie(reply, createSession(user.id));
      return { ok: true, user };
    } catch (err) {
      return reply.code(400).send({ error: err.message });
    }
  });

  app.post('/api/auth/login', async (req, reply) => {
    if (config.authDisabled) return { ok: true, user: LOCAL_ADMIN };
    const { email, password } = req.body || {};
    const row = getUserByEmail(email);
    if (!row || !verifyPassword(password, row.password_hash)) {
      return reply.code(401).send({ error: 'invalid email or password' });
    }
    setSessionCookie(reply, createSession(row.id));
    return { ok: true, user: { id: row.id, email: row.email, name: row.name, role: row.role } };
  });

  app.post('/api/auth/logout', async (req, reply) => {
    destroySession(sessionCookieToken(req));
    clearSessionCookie(reply);
    return { ok: true };
  });

  // ── Admin-only user management ──
  const requireAdmin = (req, reply) => {
    if (config.authDisabled) return true;
    if (!req.user || req.user.role !== 'admin') {
      reply.code(403).send({ error: 'admin only' });
      return false;
    }
    return true;
  };

  app.get('/api/users', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    return { users: listUsers() };
  });

  app.post('/api/users', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const { email, name, password, role } = req.body || {};
    try {
      return createUser({ email, name, password, role });
    } catch (err) {
      return reply.code(400).send({ error: err.message });
    }
  });

  app.put('/api/users/:id/password', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    try {
      setPassword(Number(req.params.id), (req.body || {}).password);
      return { ok: true };
    } catch (err) {
      return reply.code(400).send({ error: err.message });
    }
  });

  app.delete('/api/users/:id', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const id = Number(req.params.id);
    if (req.user && req.user.id === id) return reply.code(400).send({ error: "you can't delete your own account" });
    if (listUsers().length <= 1) return reply.code(400).send({ error: 'cannot delete the last user' });
    deleteUser(id);
    return { ok: true };
  });
}
