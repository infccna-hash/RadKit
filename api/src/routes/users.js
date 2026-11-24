import { Router } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { one, many, q, tx } from '../db.js';
import { ah, str, oneOf, uuid, bad, notFound } from '../lib/http.js';
import { requireRole } from '../lib/auth.js';
import { audit } from '../lib/audit.js';
import { invalidateAuthCache } from './internal.js';

const r = Router();

const tempPassword = () => crypto.randomBytes(9).toString('base64url');

// ---------------- Admin ----------------
r.get(
  '/admin/users',
  requireRole('admin'),
  ah(async (_req, res) => {
    const users = await many(
      `SELECT u.id, u.email, u.full_name, u.role, u.organization, u.phone, u.active, u.created_at, u.last_login_at,
         (SELECT count(*) FROM studies s WHERE s.owner_id=u.id)::int AS studies
       FROM users u ORDER BY u.role, u.full_name`
    );
    res.json({ users });
  })
);

r.post(
  '/admin/users',
  requireRole('admin'),
  ah(async (req, res) => {
    const email = str(req.body.email, { required: true, name: 'Email', max: 200 }).toLowerCase();
    const fullName = str(req.body.fullName, { required: true, name: 'Nom', max: 200 });
    const role = oneOf(req.body.role, ['admin', 'radiologist', 'client'], 'Rôle');
    const organization = str(req.body.organization, { max: 200 });
    if (await one('SELECT 1 FROM users WHERE email=$1', [email])) throw bad('Cet email existe déjà');
    const pw = tempPassword();
    const u = await one(
      `INSERT INTO users (email, password_hash, full_name, role, organization, must_change_password)
       VALUES ($1,$2,$3,$4,$5,true) RETURNING id, email, full_name, role`,
      [email, await bcrypt.hash(pw, 12), fullName, role, organization]
    );
    await audit(req, 'user_created', u.id, { role });
    res.status(201).json({ user: u, tempPassword: pw });
  })
);

r.patch(
  '/admin/users/:id',
  requireRole('admin'),
  ah(async (req, res) => {
    const id = uuid(req.params.id);
    if (id === req.user.id && req.body.active === false) throw bad('Vous ne pouvez pas désactiver votre propre compte');
    const u = await one('SELECT id FROM users WHERE id=$1', [id]);
    if (!u) throw notFound();
    let tempPw = null;
    if (typeof req.body.active === 'boolean') await q('UPDATE users SET active=$2 WHERE id=$1', [id, req.body.active]);
    invalidateAuthCache();
    if (req.body.resetPassword) {
      tempPw = tempPassword();
      await q('UPDATE users SET password_hash=$2, must_change_password=true WHERE id=$1', [id, await bcrypt.hash(tempPw, 12)]);
    }
    await audit(req, 'user_updated', id, { active: req.body.active, reset: Boolean(tempPw) });
    res.json({ ok: true, tempPassword: tempPw });
  })
);

r.get(
  '/admin/audit',
  requireRole('admin'),
  ah(async (_req, res) => {
    const rows = await many(
      `SELECT a.id, a.action, a.target, a.detail, a.ip, a.at, u.email
       FROM audit_log a LEFT JOIN users u ON u.id=a.user_id ORDER BY a.at DESC LIMIT 300`
    );
    res.json({ entries: rows });
  })
);

// ---------------- Radiologist ↔ clients ----------------
r.get(
  '/clients',
  requireRole('radiologist'),
  ah(async (req, res) => {
    const clients = await many(
      `SELECT u.id, u.email, u.full_name, u.organization, u.phone, u.active, u.last_login_at, cl.created_at AS linked_at,
         (SELECT count(*) FROM studies s WHERE s.client_id=u.id AND s.owner_id=$1)::int AS studies,
         (SELECT count(*) FROM studies s WHERE s.client_id=u.id AND s.owner_id=$1 AND s.status<>'reported')::int AS open_studies
       FROM client_links cl JOIN users u ON u.id=cl.client_id
       WHERE cl.radiologist_id=$1 ORDER BY u.organization NULLS LAST, u.full_name`,
      [req.user.id]
    );
    res.json({ clients });
  })
);

/** Create a clinic account (or link an existing client account by email) */
r.post(
  '/clients',
  requireRole('radiologist'),
  ah(async (req, res) => {
    const email = str(req.body.email, { required: true, name: 'Email', max: 200 }).toLowerCase();
    const fullName = str(req.body.fullName, { name: 'Nom du contact', max: 200 });
    const organization = str(req.body.organization, { required: true, name: 'Établissement', max: 200 });
    const phone = str(req.body.phone, { max: 50 });

    const result = await tx(async (c) => {
      const existing = (await c.query('SELECT id, role FROM users WHERE email=$1', [email])).rows[0];
      let clientId, tempPw = null, created = false;
      if (existing) {
        if (existing.role !== 'client') throw bad('Cet email appartient à un compte non-client');
        clientId = existing.id;
      } else {
        tempPw = tempPassword();
        clientId = (
          await c.query(
            `INSERT INTO users (email, password_hash, full_name, role, organization, phone, must_change_password)
             VALUES ($1,$2,$3,'client',$4,$5,true) RETURNING id`,
            [email, await bcrypt.hash(tempPw, 12), fullName || organization, organization, phone]
          )
        ).rows[0].id;
        created = true;
      }
      await c.query('INSERT INTO client_links (client_id, radiologist_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [
        clientId,
        req.user.id,
      ]);
      return { clientId, tempPw, created };
    });
    await audit(req, 'client_linked', result.clientId, { created: result.created });
    res.status(201).json({ clientId: result.clientId, created: result.created, tempPassword: result.tempPw });
  })
);

r.delete(
  '/clients/:id',
  requireRole('radiologist'),
  ah(async (req, res) => {
    const id = uuid(req.params.id);
    await q('DELETE FROM client_links WHERE client_id=$1 AND radiologist_id=$2', [id, req.user.id]);
    invalidateAuthCache();
    await audit(req, 'client_unlinked', id);
    res.json({ ok: true });
  })
);

// ---------------- Client ----------------
r.get(
  '/my-radiologists',
  requireRole('client'),
  ah(async (req, res) => {
    const radiologists = await many(
      `SELECT u.id, u.full_name, u.organization FROM client_links cl JOIN users u ON u.id=cl.radiologist_id
       WHERE cl.client_id=$1 AND u.active ORDER BY u.full_name`,
      [req.user.id]
    );
    res.json({ radiologists });
  })
);

export default r;
