import { Router } from 'express';
import { one, many, q } from '../db.js';
import { ah, str, oneOf, uuid, bad, streamTo } from '../lib/http.js';
import { requireRole, requireAuth } from '../lib/auth.js';
import { studyForUser, ownStudy, ownPatient, deleteStudyEverywhere } from '../lib/access.js';
import { orthanc } from '../lib/orthanc.js';
import { templateFor } from '../lib/templates.js';
import { audit } from '../lib/audit.js';
import { viewerUrlFor } from '../lib/urls.js';
import { sendArchive } from '../lib/archive.js';

const r = Router();

const LIST_COLS = `s.id, s.study_uid, s.study_date, s.description, s.modalities, s.body_part, s.status, s.priority,
  s.series_count, s.instance_count, s.created_at, s.reported_at, s.dicom_patient_name, s.dicom_patient_id,
  s.institution, s.tags, s.clinical_info IS NOT NULL AS has_clinical_info,
  p.id AS patient_id, p.full_name AS patient_name, p.status AS patient_status, p.birth_date, p.sex,
  c.organization AS client_org, c.full_name AS client_name`;

/** Worklist (radiologist) / my studies (client) */
r.get(
  '/studies',
  requireAuth,
  ah(async (req, res) => {
    const where = [];
    const params = [];
    const add = (sql, v) => {
      params.push(v);
      where.push(sql.replace('$?', `$${params.length}`));
    };

    if (req.user.role === 'radiologist') add('s.owner_id=$?', req.user.id);
    else if (req.user.role === 'client') add('s.client_id=$?', req.user.id);

    const { status, priority, modality, client, q: search, source, days } = req.query;
    if (status) add('s.status=$?', oneOf(status, ['new', 'in_progress', 'reported'], 'statut'));
    if (status === undefined && req.query.open === '1') where.push("s.status<>'reported'");
    if (priority) add('s.priority=$?', oneOf(priority, ['urgent', 'normal', 'low'], 'priorité'));
    if (modality) add('$? = ANY(s.modalities)', String(modality).slice(0, 8));
    if (client) add('s.client_id=$?', uuid(client, 'client'));
    if (source === 'personal') where.push('s.client_id IS NULL');
    if (source === 'clients') where.push('s.client_id IS NOT NULL');
    if (days) add("s.created_at > now() - ($? || ' days')::interval", String(Math.min(365, Number(days) || 30)));
    if (search) {
      params.push(`%${String(search).slice(0, 100)}%`);
      const n = params.length;
      where.push(`(p.full_name ILIKE $${n} OR s.dicom_patient_name ILIKE $${n} OR s.description ILIKE $${n} OR s.accession ILIKE $${n})`);
    }

    const sql = `SELECT ${LIST_COLS}, (r.status) AS report_status
      FROM studies s
      LEFT JOIN patients p ON p.id=s.patient_id
      LEFT JOIN users c ON c.id=s.client_id
      LEFT JOIN reports r ON r.study_id=s.id
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY (s.priority='urgent' AND s.status<>'reported') DESC, s.created_at DESC
      LIMIT ${Math.max(1, Math.min(500, Math.floor(Number(req.query.limit)) || 200))}`;
    let rows = await many(sql, params);
    if (req.user.role === 'client') rows = rows.map(clientView);
    res.json({ studies: rows });
  })
);

r.get(
  '/stats',
  requireRole('radiologist'),
  ah(async (req, res) => {
    const s = await one(
      `SELECT
         count(*) FILTER (WHERE status<>'reported')::int AS open,
         count(*) FILTER (WHERE status<>'reported' AND priority='urgent')::int AS urgent,
         count(*) FILTER (WHERE created_at::date = current_date)::int AS today,
         count(*) FILTER (WHERE status='reported' AND reported_at > now() - interval '7 days')::int AS reported_week,
         count(*)::int AS total
       FROM studies WHERE owner_id=$1`,
      [req.user.id]
    );
    const p = await one(
      `SELECT count(*) FILTER (WHERE status='pending')::int AS pending_patients,
              count(*) FILTER (WHERE status='active')::int AS patients
       FROM patients WHERE owner_id=$1`,
      [req.user.id]
    );
    const m = await one(
      "SELECT count(*)::int AS merges FROM merge_suggestions WHERE owner_id=$1 AND status='pending'",
      [req.user.id]
    );
    res.json({ ...s, ...p, ...m });
  })
);

r.get(
  '/studies/:id',
  requireAuth,
  ah(async (req, res) => {
    const s = await studyForUser(req.user, req.params.id);
    const report = await one('SELECT * FROM reports WHERE study_id=$1', [s.id]);
    const client = s.client_id ? await one('SELECT id, full_name, organization, email, phone FROM users WHERE id=$1', [s.client_id]) : null;

    if (req.user.role === 'client') {
      await audit(req, 'study_viewed', s.id);
      return res.json({
        study: clientView(s),
        report: report?.status === 'final' ? report : null,
        radiologist: await one('SELECT full_name, organization FROM users WHERE id=$1', [s.owner_id]),
      });
    }

    const patient = s.patient_id ? await one('SELECT * FROM patients WHERE id=$1', [s.patient_id]) : null;
    const priors = patient
      ? await many(
          `SELECT s.id, s.study_date, s.description, s.modalities, s.status, r.conclusion
           FROM studies s LEFT JOIN reports r ON r.study_id=s.id
           WHERE s.patient_id=$1 AND s.id<>$2 ORDER BY s.study_date DESC NULLS LAST, s.created_at DESC`,
          [patient.id, s.id]
        )
      : [];
    const shares = await many(
      `SELECT id, status, recipient, message, include_report, burned_in_risk, expires_at, revoked_at, view_count, last_viewed_at, created_at,
         (SELECT count(*) FROM share_replies sr WHERE sr.share_id=shares.id)::int AS replies
       FROM shares WHERE study_id=$1 ORDER BY created_at DESC`,
      [s.id]
    );
    await audit(req, 'study_viewed', s.id);
    res.json({ study: s, patient, priors, report, client, shares, template: templateFor(s.modalities) });
  })
);

r.patch(
  '/studies/:id',
  requireRole('radiologist'),
  ah(async (req, res) => {
    const s = await ownStudy(req.user, req.params.id);
    const b = req.body;
    const sets = [];
    const params = [s.id];
    const set = (col, v) => {
      params.push(v);
      sets.push(`${col}=$${params.length}`);
    };
    if (b.priority !== undefined) set('priority', oneOf(b.priority, ['urgent', 'normal', 'low'], 'priorité'));
    if (b.status !== undefined) set('status', oneOf(b.status, ['new', 'in_progress', 'reported'], 'statut'));
    if (b.privateNote !== undefined) set('private_note', str(b.privateNote, { max: 4000 }));
    if (b.tags !== undefined) {
      if (!Array.isArray(b.tags) || b.tags.length > 20) throw bad('Étiquettes invalides');
      set('tags', b.tags.map((t) => String(t).trim().slice(0, 40)).filter(Boolean));
    }
    if (b.patientId !== undefined) {
      const p = await ownPatient(req.user, b.patientId);
      set('patient_id', p.id);
    }
    if (!sets.length) throw bad('Rien à modifier');
    const updated = await one(`UPDATE studies SET ${sets.join(', ')} WHERE id=$1 RETURNING *`, params);
    res.json({ study: updated });
  })
);

r.delete(
  '/studies/:id',
  requireRole('radiologist'),
  ah(async (req, res) => {
    const s = await ownStudy(req.user, req.params.id);
    await deleteStudyEverywhere(s);
    await audit(req, 'study_deleted', s.id, { uid: s.study_uid });
    res.json({ ok: true });
  })
);

r.get(
  '/studies/:id/viewer',
  requireAuth,
  ah(async (req, res) => {
    const s = await studyForUser(req.user, req.params.id);
    if (req.user.role === 'radiologist' && s.status === 'new') {
      await q("UPDATE studies SET status='in_progress' WHERE id=$1", [s.id]);
    }
    await audit(req, 'viewer_opened', s.id);
    res.json({ url: viewerUrlFor(req, s.study_uid) });
  })
);

/** Original study as ZIP (radiologist / sending clinic) */
r.get(
  '/studies/:id/download',
  requireAuth,
  ah(async (req, res) => {
    const s = await studyForUser(req.user, req.params.id);
    await audit(req, 'study_downloaded', s.id);
    await sendArchive(res, s.orthanc_id, `etude-${s.id.slice(0, 8)}.zip`);
  })
);

/** Client: history grouped by patient (as named in their own DICOM) */
r.get(
  '/client/history',
  requireRole('client'),
  ah(async (req, res) => {
    const rows = await many(
      `SELECT s.id, s.study_date, s.description, s.modalities, s.status, s.created_at, s.dicom_patient_name,
              s.dicom_patient_id, s.dicom_birth_date, r.conclusion, r.status AS report_status, u.full_name AS radiologist
       FROM studies s LEFT JOIN reports r ON r.study_id=s.id JOIN users u ON u.id=s.owner_id
       WHERE s.client_id=$1 ORDER BY s.study_date DESC NULLS LAST, s.created_at DESC`,
      [req.user.id]
    );
    const groups = new Map();
    for (const row of rows) {
      const key = `${row.dicom_patient_id || ''}|${(row.dicom_patient_name || '').toUpperCase()}`;
      if (!groups.has(key))
        groups.set(key, {
          key,
          patientName: row.dicom_patient_name || 'Sans nom',
          patientId: row.dicom_patient_id,
          birthDate: row.dicom_birth_date,
          studies: [],
        });
      groups.get(key).studies.push({
        ...row,
        conclusion: row.report_status === 'final' ? row.conclusion : null,
      });
    }
    res.json({ patients: [...groups.values()] });
  })
);

/** Hide radiologist-only fields from clinics */
function clientView(s) {
  const { private_note, tags, patient_id, patient_status, owner_id, ...rest } = s;
  return rest;
}

export default r;
