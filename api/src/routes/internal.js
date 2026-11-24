import { Router } from 'express';
import { one } from '../db.js';
import { ah } from '../lib/http.js';
import { readSession, readShareGrants } from '../lib/auth.js';
import { userCanViewUid } from '../lib/access.js';

const r = Router();

// Short cache: OHIF fires hundreds of requests per study
const cache = new Map();
const TTL = 30_000;
/** Called when access changes (share revoked, study deleted, client unlinked) */
export function invalidateAuthCache() {
  cache.clear();
}

function cached(key) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.t < TTL) return hit.ok;
  return undefined;
}
function remember(key, ok) {
  if (cache.size > 5000) cache.clear();
  cache.set(key, { ok, t: Date.now() });
  return ok;
}

/** Extract the StudyInstanceUID a DICOMweb request targets */
export function studyUidFromUri(uri) {
  if (!uri) return null;
  const [pathPart, query = ''] = uri.split('?');
  const m = pathPart.match(/\/dicom-web\/studies\/([^/]+)/);
  if (m) return decodeURIComponent(m[1]);
  const params = new URLSearchParams(query);
  const v = params.get('StudyInstanceUID') || params.get('0020000D');
  if (v && !v.includes(',') && !v.includes('*') && !v.includes('\\')) return v;
  return null;
}

/** nginx auth_request target: 204 = allow, 401/403 = deny */
r.get(
  '/internal/dicomweb-auth',
  ah(async (req, res) => {
    const method = req.get('X-Original-Method') || 'GET';
    if (!['GET', 'HEAD'].includes(method)) return res.sendStatus(403);
    const uid = studyUidFromUri(req.get('X-Original-URI'));
    if (!uid || uid.length > 128) return res.sendStatus(403);

    const session = readSession(req);
    if (session) {
      const key = `u:${session.sub}:${uid}`;
      let ok = cached(key);
      if (ok === undefined) {
        const user = await one('SELECT id, role, active FROM users WHERE id=$1', [session.sub]);
        ok = remember(key, Boolean(user?.active) && (await userCanViewUid(user, uid)));
      }
      if (ok) return res.sendStatus(204);
    }

    const grants = readShareGrants(req);
    const grant = grants.find((g) => g.s === uid);
    if (grant) {
      const key = `s:${grant.i}:${uid}`;
      let ok = cached(key);
      if (ok === undefined) {
        const sh = await one(
          'SELECT 1 FROM shares WHERE id=$1 AND anon_study_uid=$2 AND revoked_at IS NULL AND expires_at > now()',
          [grant.i, uid]
        );
        ok = remember(key, Boolean(sh));
      }
      if (ok) return res.sendStatus(204);
    }
    res.sendStatus(session || grants.length ? 403 : 401);
  })
);

export default r;
