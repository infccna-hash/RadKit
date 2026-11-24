import { Router } from 'express';
import { one, many, q } from '../db.js';
import { ah, str, oneOf, uuid, bad, notFound } from '../lib/http.js';
import { requireRole } from '../lib/auth.js';
import { ownPatient, deleteStudyEverywhere } from '../lib/access.js';
import { mergePatients } from '../lib/ingest.js';
import { nameKey } from '../lib/matching.js';
import { audit } from '../lib/audit.js';

const r = Router();
r.use(['/patients', '/merge-suggestions'], requireRole('radiologist'));

r.get(
  '/patients',
  ah(async (req, res) => {
    const params = [req.user.id];
    let where = 'p.owner_id=$1';
    if (req.query.status) {
      params.push(oneOf(req.query.status, ['pending', 'active'], 'statut'));
      where += ` AND p.status=$${params.length}`;
    }
    if (req.query.q) {
      params.push(`%${String(req.query.q).slice(0, 100)}%`);
      where += ` AND (p.full_name ILIKE $${params.length} OR EXISTS (SELECT 1 FROM patient_identifiers pi WHERE pi.patient_id=p.id AND pi.dicom_patient_id ILIKE $${params.length}))`;
    }
    const patients = await many(
      `SELECT p.*,
         (SELECT count(*) FROM studies s WHERE s.patient_id=p.id)::int AS study_count,
         (SELECT max(coalesce(s.study_date, s.created_at::date)) FROM studies s WHERE s.patient_id=p.id) AS last_study,
         (SELECT array_agg(DISTINCT m) FROM studies s, unnest(s.modalities) m WHERE s.patient_id=p.id) AS modalities,
         (SELECT array_agg(DISTINCT c.organization) FROM studies s JOIN users c ON c.id=s.client_id WHERE s.patient_id=p.id) AS clients,
         (SELECT count(*) FROM merge_suggestions ms WHERE ms.status='pending' AND (ms.patient_a=p.id OR ms.patient_b=p.id))::int AS merge_hints
       FROM patients p WHERE ${where}
       ORDER BY p.status='pending' DESC, last_study DESC NULLS LAST, p.created_at DESC LIMIT 500`,
      params
    );
    res.json({ patients });
  })
);

r.get(
  '/patients/:id',
  ah(async (req, res) => {
    const p = await ownPatient(req.user, req.params.id);
    const studies = await many(
      `SELECT s.id, s.study_date, s.description, s.modalities, s.status, s.priority, s.created_at, s.institution,
              s.series_count, s.instance_count, c.organization AS client_org,
              r.conclusion, r.status AS report_status, r.finalized_at
       FROM studies s LEFT JOIN reports r ON r.study_id=s.id LEFT JOIN users c ON c.id=s.client_id
       WHERE s.patient_id=$1 ORDER BY s.study_date DESC NULLS LAST, s.created_at DESC`,
      [p.id]
    );
    const identifiers = await many(
      'SELECT id, dicom_patient_id, issuer, dicom_name FROM patient_identifiers WHERE patient_id=$1',
      [p.id]
    );
    const suggestions = await suggestionsFor(req.user.id, p.id);
    res.json({ patient: p, studies, identifiers, suggestions });
  })
);

r.patch(
  '/patients/:id',
  ah(async (req, res) => {
    const p = await ownPatient(req.user, req.params.id);
    const b = req.body;
    const fullName = b.fullName !== undefined ? str(b.fullName, { required: true, name: 'Nom', max: 200 }) : p.full_name;
    const birth = b.birthDate !== undefined ? (b.birthDate ? validDate(b.birthDate) : null) : p.birth_date;
    const sex = b.sex !== undefined ? (b.sex ? oneOf(b.sex, ['M', 'F', 'O'], 'sexe') : null) : p.sex;
    const notes = b.notes !== undefined ? str(b.notes, { max: 4000 }) : p.notes;
    const status = b.status !== undefined ? oneOf(b.status, ['pending', 'active'], 'statut') : p.status;
    const updated = await one(
      `UPDATE patients SET full_name=$2, name_key=$3, birth_date=$4, sex=$5, notes=$6, status=$7, updated_at=now()
       WHERE id=$1 RETURNING *`,
      [p.id, fullName, nameKey(fullName), birth, sex, notes, status]
    );
    await audit(req, 'patient_updated', p.id);
    res.json({ patient: updated });
  })
);

/** Keep several pending patients at once */
r.post(
  '/patients/confirm',
  ah(async (req, res) => {
    const ids = Array.isArray(req.body.ids) ? req.body.ids.map((i) => uuid(i)) : [];
    if (!ids.length) throw bad('Aucun patient sélectionné');
    const r2 = await q(
      "UPDATE patients SET status='active', updated_at=now() WHERE owner_id=$1 AND id = ANY($2::uuid[]) AND status='pending'",
      [req.user.id, ids]
    );
    await audit(req, 'patients_confirmed', null, { count: r2.rowCount });
    res.json({ confirmed: r2.rowCount });
  })
);

/** Remove a patient from the workspace, with all their studies */
r.delete(
  '/patients/:id',
  ah(async (req, res) => {
    const p = await ownPatient(req.user, req.params.id);
    const studies = await many('SELECT * FROM studies WHERE patient_id=$1', [p.id]);
    for (const s of studies) await deleteStudyEverywhere(s);
    await q('DELETE FROM patients WHERE id=$1', [p.id]);
    await audit(req, 'patient_removed', p.id, { studies: studies.length });
    res.json({ ok: true, studiesRemoved: studies.length });
  })
);

/** Manual merge: other patient is absorbed into :id */
r.post(
  '/patients/:id/merge',
  ah(async (req, res) => {
    const keep = await ownPatient(req.user, req.params.id);
    const other = await ownPatient(req.user, req.body.otherId);
    if (keep.id === other.id) throw bad('Même patient');
    await mergePatients(req.user.id, keep.id, other.id);
    await audit(req, 'patients_merged', keep.id, { absorbed: other.id });
    res.json({ patientId: keep.id });
  })
);

// ---------------- Merge suggestions ----------------
r.get(
  '/merge-suggestions',
  ah(async (req, res) => {
    res.json({ suggestions: await suggestionsFor(req.user.id) });
  })
);

r.post(
  '/merge-suggestions/:id/accept',
  ah(async (req, res) => {
    const ms = await one("SELECT * FROM merge_suggestions WHERE id=$1 AND owner_id=$2 AND status='pending'", [
      uuid(req.params.id),
      req.user.id,
    ]);
    if (!ms) throw notFound('Suggestion introuvable');
    const keep = uuid(req.body.keep, 'patient conservé');
    if (![ms.patient_a, ms.patient_b].includes(keep)) throw bad('Le patient conservé doit faire partie de la suggestion');
    const drop = keep === ms.patient_a ? ms.patient_b : ms.patient_a;
    await mergePatients(req.user.id, keep, drop); // suggestion row is removed by cascade
    await audit(req, 'patients_merged', keep, { absorbed: drop, suggestion: ms.id });
    res.json({ patientId: keep });
  })
);

r.post(
  '/merge-suggestions/:id/dismiss',
  ah(async (req, res) => {
    const r2 = await q("UPDATE merge_suggestions SET status='dismissed' WHERE id=$1 AND owner_id=$2", [
      uuid(req.params.id),
      req.user.id,
    ]);
    if (!r2.rowCount) throw notFound('Suggestion introuvable');
    res.json({ ok: true });
  })
);

async function suggestionsFor(ownerId, patientId = null) {
  return many(
    `SELECT ms.id, ms.score, ms.reasons, ms.created_at,
       json_build_object('id', a.id, 'full_name', a.full_name, 'birth_date', a.birth_date, 'sex', a.sex, 'status', a.status,
         'studies', (SELECT count(*) FROM studies s WHERE s.patient_id=a.id),
         'ids', (SELECT array_agg(dicom_patient_id) FROM patient_identifiers WHERE patient_id=a.id)) AS a,
       json_build_object('id', b.id, 'full_name', b.full_name, 'birth_date', b.birth_date, 'sex', b.sex, 'status', b.status,
         'studies', (SELECT count(*) FROM studies s WHERE s.patient_id=b.id),
         'ids', (SELECT array_agg(dicom_patient_id) FROM patient_identifiers WHERE patient_id=b.id)) AS b
     FROM merge_suggestions ms JOIN patients a ON a.id=ms.patient_a JOIN patients b ON b.id=ms.patient_b
     WHERE ms.owner_id=$1 AND ms.status='pending' ${patientId ? 'AND (ms.patient_a=$2 OR ms.patient_b=$2)' : ''}
     ORDER BY ms.score DESC, ms.created_at DESC`,
    patientId ? [ownerId, patientId] : [ownerId]
  );
}

function validDate(v) {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(v))) throw bad('Date invalide');
  return v;
}

export default r;
