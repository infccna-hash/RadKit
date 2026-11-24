import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { one } from '../db.js';
import { HttpError, forbidden } from './http.js';

export const SESSION_COOKIE = 'rk_session';
export const SHARE_COOKIE = 'rk_share';

const cookieBase = () => ({
  httpOnly: true,
  sameSite: 'lax',
  secure: config.cookieSecure,
  path: '/',
});

export function setSession(res, user) {
  const token = jwt.sign({ sub: user.id, role: user.role }, config.jwtSecret, {
    expiresIn: `${config.sessionHours}h`,
  });
  res.cookie(SESSION_COOKIE, token, { ...cookieBase(), maxAge: config.sessionHours * 3600e3 });
}

export function clearSession(res) {
  res.clearCookie(SESSION_COOKIE, cookieBase());
}

export function readSession(req) {
  const token = req.cookies?.[SESSION_COOKIE];
  if (!token) return null;
  try {
    return jwt.verify(token, config.jwtSecret);
  } catch {
    return null;
  }
}

/** Share cookie: list of anonymized StudyInstanceUIDs this browser may view */
export function readShareGrants(req) {
  const token = req.cookies?.[SHARE_COOKIE];
  if (!token) return [];
  try {
    const p = jwt.verify(token, config.shareSecret);
    return Array.isArray(p.g) ? p.g : [];
  } catch {
    return [];
  }
}

export function addShareGrant(req, res, grant) {
  const grants = readShareGrants(req).filter((g) => g.s !== grant.s);
  grants.unshift(grant);
  const token = jwt.sign({ g: grants.slice(0, 10) }, config.shareSecret, { expiresIn: '7d' });
  res.cookie(SHARE_COOKIE, token, { ...cookieBase(), maxAge: 7 * 24 * 3600e3 });
}

/** Loads req.user from the session cookie (and checks the account is still active) */
export async function loadUser(req, _res, next) {
  try {
    const s = readSession(req);
    if (s) {
      const u = await one(
        'SELECT id, email, full_name, role, organization, active, must_change_password FROM users WHERE id=$1',
        [s.sub]
      );
      if (u && u.active) req.user = u;
    }
    next();
  } catch (e) {
    next(e);
  }
}

export function requireAuth(req, _res, next) {
  if (!req.user) return next(new HttpError(401, 'Non authentifié'));
  next();
}

export const requireRole =
  (...roles) =>
  (req, _res, next) => {
    if (!req.user) return next(new HttpError(401, 'Non authentifié'));
    if (!roles.includes(req.user.role)) return next(forbidden());
    next();
  };

/** Basic CSRF defense: state-changing requests must carry a custom header,
 *  which browsers never add on cross-site form posts. */
export function csrfGuard(req, _res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.get('X-RadKit') !== '1') return next(forbidden('En-tête X-RadKit manquant'));
  next();
}
