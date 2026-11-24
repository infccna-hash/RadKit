import { q } from '../db.js';

export async function audit(req, action, target, detail) {
  try {
    await q('INSERT INTO audit_log (user_id, action, target, detail, ip) VALUES ($1,$2,$3,$4,$5)', [
      req?.user?.id || null,
      action,
      target ? String(target) : null,
      detail ? JSON.stringify(detail) : null,
      req?.ip || null,
    ]);
  } catch (e) {
    console.error('audit failed', e.message);
  }
}
