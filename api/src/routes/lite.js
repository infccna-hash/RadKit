// Lightweight viewer (no WebGL): series manifest + server-rendered frames proxied from Orthanc.
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { one, q } from '../db.js';
import { ah, notFound, streamTo } from '../lib/http.js';
import { requireAuth } from '../lib/auth.js';
import { studyForUser } from '../lib/access.js';
import { orthanc } from '../lib/orthanc.js';
import { audit } from '../lib/audit.js';
import { liveShare } from './shares.js';

const r = Router();
// A CT can be several hundred frames: allow bursts of image requests
const imgLimiter = rateLimit({ windowMs: 60e3, limit: 3000, standardHeaders: true, legacyHeaders: false });

const ORTHANC_ID = /^[0-9a-f]{8}(-[0-9a-f]{8}){4}$/;

const firstNum = (v) => {
  if (v === undefined || v === null || v === '') return null;
  const n = parseFloat(String(v).split('\\')[0]);
  return Number.isFinite(n) ? n : null;
};

function parseSpacing(v) {
  if (!v) return null;
  const parts = String(v).split('\\').map(Number);
  return parts.length >= 2 && parts.every((n) => Number.isFinite(n) && n > 0) ? [parts[0], parts[1]] : null;
}

/** Series list with ordered slices, default window and pixel spacing */
export async function buildManifest(orthancStudyId) {
  const series = await orthanc.studySeries(orthancStudyId);
  const out = [];
  const instances = new Set();
  for (const se of series) {
    let slices;
    try {
      const os = await orthanc.orderedSlices(se.ID);
      slices = (os.SlicesShort || []).flatMap(([iid, start, count]) =>
        Array.from({ length: count }, (_, k) => [iid, start + k])
      );
    } catch {
      slices = [];
    }
    if (!slices.length) slices = (se.Instances || []).map((i) => [i, 0]);
    if (!slices.length) continue;
    slices.forEach(([iid]) => instances.add(iid));

    let tags = {};
    try {
      tags = await orthanc.instanceTags(slices[Math.floor(slices.length / 2)][0]);
    } catch {
      /* rendering still works with Orthanc defaults */
    }
    const modality = se.MainDicomTags?.Modality || tags.Modality || null;
    const photometric = String(tags.PhotometricInterpretation || 'MONOCHROME2');
    const windowable = photometric.startsWith('MONOCHROME');
    const c = firstNum(tags.WindowCenter), w = firstNum(tags.WindowWidth);
    const bits = firstNum(tags.BitsStored) || 8;
    out.push({
      id: se.ID,
      number: firstNum(se.MainDicomTags?.SeriesNumber ?? tags.SeriesNumber),
      description: se.MainDicomTags?.SeriesDescription || tags.SeriesDescription || null,
      modality,
      slices,
      windowable,
      window: c !== null && w !== null && w > 0 ? { c, w } : null,
      fallbackWindow: modality === 'CT' ? { c: 40, w: 400 } : { c: 2 ** bits / 2, w: 2 ** bits },
      pixelSpacing: parseSpacing(tags.PixelSpacing || tags.ImagerPixelSpacing),
      rows: firstNum(tags.Rows),
      columns: firstNum(tags.Columns),
    });
  }
  out.sort((a, b) => (a.number ?? 1e9) - (b.number ?? 1e9));
  allowed.set(orthancStudyId, instances);
  if (allowed.size > 500) allowed.delete(allowed.keys().next().value);
  return out;
}

// orthancStudyId -> Set(instanceId), filled by the manifest, checked on every image
const allowed = new Map();

async function assertInstance(orthancStudyId, iid) {
  if (!ORTHANC_ID.test(iid)) throw notFound('Image introuvable');
  if (allowed.get(orthancStudyId)?.has(iid)) return;
  const st = await orthanc.instanceStudy(iid).catch(() => null);
  if (st?.ID !== orthancStudyId) throw notFound('Image introuvable');
  if (!allowed.has(orthancStudyId)) allowed.set(orthancStudyId, new Set());
  allowed.get(orthancStudyId).add(iid);
}

function frameOf(v) {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0 || n > 20000) throw notFound('Image introuvable');
  return n;
}

async function sendImage(res, iid, frame, query) {
  const num = (v, min, max) => {
    if (v === undefined) return null;
    const n = Number(v);
    return Number.isFinite(n) && n >= min && n <= max ? n : null;
  };
  const params = new URLSearchParams();
  const wc = num(query.wc, -100000, 100000), ww = num(query.ww, 1, 200000), h = num(query.h, 16, 2048);
  if (wc !== null && ww !== null) {
    params.set('window-center', String(wc));
    params.set('window-width', String(ww));
  }
  if (h !== null) params.set('height', String(Math.round(h)));
  params.set('quality', '90');

  let up = await orthanc.rendered(iid, frame, params);
  if (!up.ok && up.status !== 404) up = await orthanc.preview(iid, frame); // older Orthanc without /rendered
  if (!up.ok) throw notFound('Image indisponible');
  res.setHeader('Content-Type', up.headers.get('content-type') || 'image/jpeg');
  res.setHeader('Cache-Control', 'private, max-age=86400');
  streamTo(res, up.body);
}

// ---------- Logged-in users (radiologist / clinic / admin) ----------

/** OHIF only knows the StudyInstanceUID: find the RadKit study this user may open (for the no-WebGL redirect) */
r.get(
  '/lite/resolve/:uid',
  requireAuth,
  ah(async (req, res) => {
    const uid = req.params.uid;
    if (!/^[0-9.]{1,64}$/.test(uid)) throw notFound('Examen introuvable');
    const row =
      req.user.role === 'admin'
        ? await one('SELECT id FROM studies WHERE study_uid=$1 ORDER BY created_at DESC LIMIT 1', [uid])
        : await one(
            `SELECT id FROM studies WHERE study_uid=$1 AND (owner_id=$2 OR client_id=$2)
             ORDER BY (owner_id=$2) DESC, created_at DESC LIMIT 1`,
            [uid, req.user.id]
          );
    if (!row) throw notFound('Examen introuvable');
    res.json({ studyId: row.id });
  })
);
r.get(
  '/lite/studies/:id',
  requireAuth,
  ah(async (req, res) => {
    const s = await studyForUser(req.user, req.params.id);
    const series = await buildManifest(s.orthanc_id);
    if (req.user.role === 'radiologist' && s.status === 'new') {
      await q("UPDATE studies SET status='in_progress' WHERE id=$1", [s.id]);
    }
    await audit(req, 'lite_viewer_opened', s.id);
    res.json({
      title: s.description || 'Examen',
      patient: s.dicom_patient_name,
      date: s.study_date,
      modalities: s.modalities,
      series,
    });
  })
);

r.get(
  '/lite/studies/:id/img/:iid/:frame',
  requireAuth,
  imgLimiter,
  ah(async (req, res) => {
    const s = await studyForUser(req.user, req.params.id);
    await assertInstance(s.orthanc_id, req.params.iid);
    await sendImage(res, req.params.iid, frameOf(req.params.frame), req.query);
  })
);

// ---------- Share link (anonymized copy only) ----------
r.get(
  '/public/shares/:token/lite',
  imgLimiter,
  ah(async (req, res) => {
    const sh = await liveShare(req.params.token);
    const s = await one('SELECT description, modalities FROM studies WHERE id=$1', [sh.study_id]);
    const series = await buildManifest(sh.anon_orthanc_id);
    await q('UPDATE shares SET view_count=view_count+1, last_viewed_at=now() WHERE id=$1', [sh.id]);
    await audit(req, 'share_lite_opened', sh.study_id, { share: sh.id });
    res.json({ title: s?.description || 'Examen', patient: sh.anon_patient_id, date: null, modalities: s?.modalities || [], series });
  })
);

r.get(
  '/public/shares/:token/lite/img/:iid/:frame',
  imgLimiter,
  ah(async (req, res) => {
    const sh = await liveShare(req.params.token);
    await assertInstance(sh.anon_orthanc_id, req.params.iid);
    await sendImage(res, req.params.iid, frameOf(req.params.frame), req.query);
  })
);

export default r;
