import { Router } from 'express';
import crypto from 'node:crypto';
import rateLimit from 'express-rate-limit';
import { one, many, q } from '../db.js';
import { ah, str, uuid, bad, notFound, HttpError, streamTo } from '../lib/http.js';
import { requireRole, addShareGrant } from '../lib/auth.js';
import { ownStudy } from '../lib/access.js';
import { orthanc } from '../lib/orthanc.js';
import { audit } from '../lib/audit.js';
import { appOrigin, viewerUrlFor } from '../lib/urls.js';
import { ageBand } from '../lib/ai.js';
import { config } from '../config.js';
import { invalidateAuthCache } from './internal.js';
import { enqueuePrepare } from '../lib/shareJobs.js';
import { sendArchive } from '../lib/archive.js';
import { safeDescription } from '../lib/deid.js';

const r = Router();

// Modalities where patient names are often burned into the pixels
const BURNED_IN_MODALITIES = ['US', 'SC', 'OT', 'XC', 'ES', 'XA', 'RF', 'ECG', 'DOC'];

const hashToken = (t) => crypto.createHash('sha256').update(t).digest('hex');

/** Create an anonymized, revocable share link */
r.post(
  '/studies/:id/shares',
  requireRole('radiologist'),
  ah(async (req, res) => {
    const s = await ownStudy(req.user, req.params.id);
    const recipient = str(req.body.recipient, { max: 200 });
    const message = str(req.body.message, { max: 4000 });
    const days = Math.max(1, Math.min(90, Number(req.body.days) || config.shareDefaultDays));
    const includeReport = Boolean(req.body.includeReport);

    // Burned-in annotation risk
    let burned = s.modalities.some((m) => BURNED_IN_MODALITIES.includes(m));
    const series = await orthanc.studySeries(s.orthanc_id);
    for (const se of series) {
      const tags = await orthanc.seriesSharedTags(se.ID).catch(() => ({}));
      if (String(tags?.BurnedInAnnotation || '').toUpperCase() === 'YES') burned = true;
    }
    if (burned && !req.body.confirmBurnedIn) {
      throw new HttpError(409, 'Risque de nom incrusté dans les images', { code: 'BURNED_IN_RISK', modalities: s.modalities });
    }

    const anonPatientId = 'RK-' + crypto.randomBytes(4).toString('hex').toUpperCase();
    const token = crypto.randomBytes(24).toString('base64url');
    const share = await one(
      `INSERT INTO shares (study_id, created_by, token_hash, status, anon_patient_id,
         recipient, message, include_report, burned_in_risk, expires_at)
       VALUES ($1,$2,$3,'preparing',$4,$5,$6,$7,$8, now() + ($9 || ' days')::interval) RETURNING *`,
      [s.id, req.user.id, hashToken(token), anonPatientId, recipient, message, includeReport, burned, String(days)]
    );
    enqueuePrepare(share.id);
    await audit(req, 'share_created', s.id, { share: share.id, days, includeReport });
    res.status(201).json({ share: publicShareRow(share), url: `${appOrigin(req)}/s/${token}` });
  })
);

r.get(
  '/shares',
  requireRole('radiologist'),
  ah(async (req, res) => {
    const shares = await many(
      `SELECT sh.id, sh.study_id, sh.status, sh.error, sh.recipient, sh.message, sh.include_report, sh.burned_in_risk, sh.expires_at,
         sh.revoked_at, sh.view_count, sh.last_viewed_at, sh.created_at, sh.anon_patient_id,
         s.description, s.modalities, s.study_date, p.full_name AS patient_name,
         COALESCE((SELECT json_agg(json_build_object('author', author, 'body', body, 'created_at', created_at) ORDER BY created_at)
                   FROM share_replies WHERE share_id=sh.id), '[]') AS replies
       FROM shares sh JOIN studies s ON s.id=sh.study_id LEFT JOIN patients p ON p.id=s.patient_id
       WHERE sh.created_by=$1 ORDER BY sh.created_at DESC LIMIT 300`,
      [req.user.id]
    );
    res.json({ shares });
  })
);

r.get(
  '/shares/:id',
  requireRole('radiologist'),
  ah(async (req, res) => {
    const sh = await one('SELECT * FROM shares WHERE id=$1 AND created_by=$2', [uuid(req.params.id), req.user.id]);
    if (!sh) throw notFound('Partage introuvable');
    res.json({ share: publicShareRow(sh) });
  })
);

r.post(
  '/shares/:id/revoke',
  requireRole('radiologist'),
  ah(async (req, res) => {
    const sh = await one('SELECT * FROM shares WHERE id=$1 AND created_by=$2', [uuid(req.params.id), req.user.id]);
    if (!sh) throw notFound('Partage introuvable');
    await q('UPDATE shares SET revoked_at=COALESCE(revoked_at, now()) WHERE id=$1', [sh.id]);
    invalidateAuthCache();
    if (sh.anon_orthanc_id) await orthanc.deleteStudy(sh.anon_orthanc_id).catch(() => {});
    await audit(req, 'share_revoked', sh.study_id, { share: sh.id });
    res.json({ ok: true });
  })
);

// ---------------- Public side (no account) ----------------
const publicLimiter = rateLimit({ windowMs: 60e3, limit: 60, standardHeaders: true, legacyHeaders: false });

export async function liveShare(token, { allowPreparing = false } = {}) {
  if (typeof token !== 'string' || token.length < 20 || token.length > 100) throw notFound('Lien invalide');
  const sh = await one('SELECT * FROM shares WHERE token_hash=$1', [hashToken(token)]);
  if (!sh) throw notFound('Lien invalide');
  if (sh.revoked_at) throw new HttpError(410, 'Ce partage a été révoqué');
  if (new Date(sh.expires_at) < new Date()) throw new HttpError(410, 'Ce partage a expiré');
  if (sh.status === 'failed') throw new HttpError(410, 'La préparation de ce partage a échoué');
  if (sh.status === 'preparing' && !allowPreparing)
    throw new HttpError(409, 'Copie anonymisée en préparation, réessayez dans un instant', { code: 'PREPARING' });
  return sh;
}

r.get(
  '/public/shares/:token',
  publicLimiter,
  ah(async (req, res) => {
    const sh = await liveShare(req.params.token, { allowPreparing: true });
    const s = await one('SELECT * FROM studies WHERE id=$1', [sh.study_id]);
    const from = await one('SELECT full_name, organization FROM users WHERE id=$1', [sh.created_by]);
    const report = sh.include_report
      ? await one('SELECT technique, findings, conclusion, status FROM reports WHERE study_id=$1', [s.id])
      : null;
    const replies = await many('SELECT author, body, created_at FROM share_replies WHERE share_id=$1 ORDER BY created_at', [sh.id]);
    res.json({
      share: {
        status: sh.status,
        reference: sh.anon_patient_id,
        message: sh.message,
        recipient: sh.recipient,
        expiresAt: sh.expires_at,
        from,
        study: {
          description: safeDescription(
            { ...s, raw_names: (await one("SELECT string_agg(dicom_name, ' ') AS n FROM patient_identifiers WHERE patient_id=$1", [s.patient_id]))?.n },
            (await one('SELECT full_name FROM patients WHERE id=$1', [s.patient_id]))?.full_name
          ),
          modalities: s.modalities,
          bodyPart: s.body_part,
          seriesCount: s.series_count,
          instanceCount: s.instance_count,
          age: ageBand(s.dicom_birth_date, s.study_date),
          sex: s.dicom_sex,
        },
        report,
        replies,
      },
    });
  })
);

/** Grants this browser access to the anonymized study, returns the viewer URL */
r.post(
  '/public/shares/:token/open',
  publicLimiter,
  ah(async (req, res) => {
    const sh = await liveShare(req.params.token);
    addShareGrant(req, res, { s: sh.anon_study_uid, i: sh.id });
    await q('UPDATE shares SET view_count=view_count+1, last_viewed_at=now() WHERE id=$1', [sh.id]);
    await audit(req, 'share_opened', sh.study_id, { share: sh.id });
    res.json({ url: viewerUrlFor(req, sh.anon_study_uid) });
  })
);

r.post(
  '/public/shares/:token/replies',
  publicLimiter,
  ah(async (req, res) => {
    const sh = await liveShare(req.params.token, { allowPreparing: true });
    const author = str(req.body.author, { required: true, name: 'Nom', max: 120 });
    const body = str(req.body.body, { required: true, name: 'Message', max: 4000 });
    const count = await one('SELECT count(*)::int AS n FROM share_replies WHERE share_id=$1', [sh.id]);
    if (count.n >= 100) throw bad('Trop de messages sur ce partage');
    await q('INSERT INTO share_replies (share_id, author, body) VALUES ($1,$2,$3)', [sh.id, author, body]);
    res.status(201).json({ ok: true });
  })
);

r.get(
  '/public/shares/:token/download',
  publicLimiter,
  ah(async (req, res) => {
    const sh = await liveShare(req.params.token);
    await audit(req, 'share_downloaded', sh.study_id, { share: sh.id });
    await sendArchive(res, sh.anon_orthanc_id, `${sh.anon_patient_id}.zip`);
  })
);

function publicShareRow(sh) {
  const { token_hash, anon_orthanc_id, ...rest } = sh;
  return rest;
}

export default r;
