import { tx } from '../db.js';
import { readStudySummary } from './orthanc.js';
import {
  nameKey,
  nameSimilarity,
  scorePatients,
  SUGGEST_THRESHOLD,
  AUTO_ATTACH_NAME_THRESHOLD,
} from './matching.js';

/**
 * Register an Orthanc study in a radiologist's workspace and attach it to a patient.
 * - Same DICOM PatientID + issuer and a compatible name → attached to the known patient.
 * - Otherwise → a new patient in "pending" status (the radiologist keeps or removes it),
 *   plus merge suggestions when a similar patient already exists. Nothing is merged silently.
 */
export async function ingestStudy({ orthancId, ownerId, clientId = null, uploadedBy, clinicalInfo = null, priority = 'normal' }) {
  const s = await readStudySummary(orthancId);
  if (!s.studyUid) throw new Error('Étude sans StudyInstanceUID');

  return tx(async (c) => {
    const existing = (
      await c.query('SELECT * FROM studies WHERE owner_id=$1 AND study_uid=$2 FOR UPDATE', [ownerId, s.studyUid])
    ).rows[0];

    let study;
    let created = false;
    if (existing) {
      study = (
        await c.query(
          `UPDATE studies SET orthanc_id=$2, series_count=$3, instance_count=$4, modalities=$5,
             clinical_info=COALESCE($6, clinical_info), client_id=COALESCE(client_id, $7),
             dicom_patient_name_raw=COALESCE($8, dicom_patient_name_raw)
           WHERE id=$1 RETURNING *`,
          [existing.id, s.orthancId, s.seriesCount, s.instanceCount, s.modalities, clinicalInfo, clientId, s.patient.rawName || null]
        )
      ).rows[0];
    } else {
      created = true;
      study = (
        await c.query(
          `INSERT INTO studies (owner_id, client_id, uploaded_by, orthanc_id, study_uid, accession, study_date,
             description, modalities, body_part, institution, referring, series_count, instance_count,
             dicom_patient_name, dicom_patient_id, dicom_birth_date, dicom_sex, clinical_info, priority, dicom_patient_name_raw)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21) RETURNING *`,
          [
            ownerId, clientId, uploadedBy, s.orthancId, s.studyUid, s.accession, s.studyDate,
            s.description, s.modalities, s.bodyPart, s.institution, s.referring, s.seriesCount, s.instanceCount,
            s.patient.name, s.patient.id, s.patient.birthDate, s.patient.sex, clinicalInfo, priority, s.patient.rawName || null,
          ]
        )
      ).rows[0];
    }

    let patientResult = { how: 'existing', patientId: study.patient_id, suggestions: 0 };
    if (!study.patient_id) {
      patientResult = await resolvePatient(c, ownerId, s.patient);
      study = (
        await c.query('UPDATE studies SET patient_id=$2 WHERE id=$1 RETURNING *', [study.id, patientResult.patientId])
      ).rows[0];
    }
    return { study, created, patient: patientResult };
  });
}

async function resolvePatient(c, ownerId, p) {
  const fullName = p.name || 'Patient sans nom';

  // 1) Known identifier from the same issuer
  if (p.id) {
    const ident = (
      await c.query(
        `SELECT pa.* FROM patient_identifiers pi JOIN patients pa ON pa.id = pi.patient_id
         WHERE pi.owner_id=$1 AND pi.dicom_patient_id=$2 AND pi.issuer=$3`,
        [ownerId, p.id, p.issuer]
      )
    ).rows[0];
    if (ident) {
      const sim = nameSimilarity(fullName, ident.full_name);
      const dobConflict = p.birthDate && ident.birth_date && p.birthDate !== ident.birth_date;
      if ((sim >= AUTO_ATTACH_NAME_THRESHOLD || !p.name) && !dobConflict) {
        await fillMissing(c, ident, p);
        return { how: 'identifier', patientId: ident.id, suggestions: 0 };
      }
      // Same ID but different person-looking data: new pending patient + strong suggestion
      const np = await createPatient(c, ownerId, fullName, p, false);
      await suggest(c, ownerId, np, ident, { shared_identifier: true });
      return { how: 'created', patientId: np.id, suggestions: 1, conflict: true };
    }
  }

  // 2) New pending patient + similarity suggestions
  const np = await createPatient(c, ownerId, fullName, p, true);
  const keyTokens = np.name_key.split(' ').filter(Boolean);
  const candidates = (
    await c.query(
      `SELECT * FROM patients WHERE owner_id=$1 AND id<>$2 AND (
         ($3::date IS NOT NULL AND birth_date=$3::date) OR string_to_array(name_key, ' ') && $4::text[]
       ) LIMIT 500`,
      [ownerId, np.id, p.birthDate, keyTokens]
    )
  ).rows;
  let n = 0;
  for (const cand of candidates) {
    if (await suggest(c, ownerId, np, cand)) n++;
  }
  return { how: 'created', patientId: np.id, suggestions: n };
}

async function createPatient(c, ownerId, fullName, p, withIdentifier) {
  const np = (
    await c.query(
      `INSERT INTO patients (owner_id, full_name, name_key, birth_date, sex, status)
       VALUES ($1,$2,$3,$4,$5,'pending') RETURNING *`,
      [ownerId, fullName, nameKey(fullName), p.birthDate, p.sex]
    )
  ).rows[0];
  if (withIdentifier && p.id) {
    await c.query(
      `INSERT INTO patient_identifiers (patient_id, owner_id, dicom_patient_id, issuer, dicom_name)
       VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,
      [np.id, ownerId, p.id, p.issuer, p.rawName]
    );
  }
  return np;
}

async function fillMissing(c, patient, p) {
  if ((!patient.birth_date && p.birthDate) || (!patient.sex && p.sex)) {
    await c.query(
      'UPDATE patients SET birth_date=COALESCE(birth_date,$2), sex=COALESCE(sex,$3), updated_at=now() WHERE id=$1',
      [patient.id, p.birthDate, p.sex]
    );
  }
}

async function suggest(c, ownerId, a, b, extra = {}) {
  const { score, reasons } = scorePatients({ ...a, ...extra }, b);
  if (score < SUGGEST_THRESHOLD && !extra.shared_identifier) return false;
  const [x, y] = a.id < b.id ? [a.id, b.id] : [b.id, a.id];
  await c.query(
    `INSERT INTO merge_suggestions (owner_id, patient_a, patient_b, score, reasons)
     VALUES ($1,$2,$3,$4,$5) ON CONFLICT (patient_a, patient_b) DO NOTHING`,
    [ownerId, x, y, score, reasons]
  );
  return true;
}

/** Merge `removeId` into `keepId` (both owned by ownerId). */
export async function mergePatients(ownerId, keepId, removeId) {
  return tx(async (c) => {
    const rows = (
      await c.query('SELECT * FROM patients WHERE owner_id=$1 AND id = ANY($2::uuid[]) FOR UPDATE', [
        ownerId,
        [keepId, removeId],
      ])
    ).rows;
    const keep = rows.find((r) => r.id === keepId);
    const drop = rows.find((r) => r.id === removeId);
    if (!keep || !drop) throw new Error('Patients introuvables');
    await c.query('UPDATE studies SET patient_id=$1 WHERE patient_id=$2', [keepId, removeId]);
    await c.query('UPDATE patient_identifiers SET patient_id=$1 WHERE patient_id=$2', [keepId, removeId]);
    await c.query(
      `UPDATE patients SET birth_date=COALESCE(birth_date,$2), sex=COALESCE(sex,$3), status='active',
         notes = NULLIF(concat_ws(E'\\n', notes, $4::text), ''), updated_at=now() WHERE id=$1`,
      [keepId, drop.birth_date, drop.sex, drop.notes]
    );
    await c.query('DELETE FROM patients WHERE id=$1', [removeId]);
    return keepId;
  });
}
