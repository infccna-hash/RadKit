import { Router } from 'express';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import { one, q } from '../db.js';
import { ah, str, bad, HttpError } from '../lib/http.js';
import { setSession, clearSession, requireAuth } from '../lib/auth.js';
import { audit } from '../lib/audit.js';

const r = Router();

const loginLimiter = rateLimit({ windowMs: 15 * 60e3, limit: 20, standardHeaders: true, legacyHeaders: false });

r.post(
  '/login',
  loginLimiter,
  ah(async (req, res) => {
    const email = str(req.body.email, { required: true, name: 'Email', max: 200 }).toLowerCase();
    const password = str(req.body.password, { required: true, name: 'Mot de passe', max: 200 });
    const u = await one('SELECT * FROM users WHERE email=$1', [email]);
    const ok = u && u.active && (await bcrypt.compare(password, u.password_hash));
    if (!ok) {
      await audit(req, 'login_failed', email);
      throw new HttpError(401, 'Email ou mot de passe incorrect');
    }
    await q('UPDATE users SET last_login_at=now() WHERE id=$1', [u.id]);
    setSession(res, u);
    req.user = u;
    await audit(req, 'login', u.id);
    res.json({ user: publicUser(u) });
  })
);

r.post('/logout', (req, res) => {
  clearSession(res);
  res.json({ ok: true });
});

r.get('/me', requireAuth, (req, res) => res.json({ user: publicUser(req.user) }));

r.post(
  '/password',
  requireAuth,
  ah(async (req, res) => {
    const current = str(req.body.current, { required: true, name: 'Mot de passe actuel' });
    const next = str(req.body.next, { required: true, name: 'Nouveau mot de passe', max: 200 });
    if (next.length < 10) throw bad('Le nouveau mot de passe doit contenir au moins 10 caractères');
    const u = await one('SELECT password_hash FROM users WHERE id=$1', [req.user.id]);
    if (!(await bcrypt.compare(current, u.password_hash))) throw bad('Mot de passe actuel incorrect');
    await q('UPDATE users SET password_hash=$2, must_change_password=false WHERE id=$1', [
      req.user.id,
      await bcrypt.hash(next, 12),
    ]);
    await audit(req, 'password_changed', req.user.id);
    res.json({ ok: true });
  })
);

export function publicUser(u) {
  return {
    id: u.id,
    email: u.email,
    fullName: u.full_name,
    role: u.role,
    organization: u.organization,
    mustChangePassword: u.must_change_password,
  };
}

export default r;
