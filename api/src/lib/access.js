import { one, many, q } from '../db.js';
import { notFound, forbidden, uuid } from './http.js';
import { orthanc } from './orthanc.js';
import { invalidateAuthCache } from '../routes/internal.js';

/** Load a study the current user may see. Radiologist: own. Client: sent by them. Admin: all. */
export async function studyForUser(user, studyId) {
  uuid(studyId, 'étude');
  const s = await one('SELECT * FROM studies WHERE id=$1', [studyId]);
  if (!s) throw notFound('Étude introuvable');
  if (user.role === 'admin') return s;
  if (user.role === 'radiologist' && s.owner_id === user.id) return s;
  if (user.role === 'client' && s.client_id === user.id) return s;
  throw notFound('Étude introuvable');
}

export async function ownStudy(user, studyId) {
  const s = await studyForUser(user, studyId);
  if (user.role !== 'radiologist' || s.owner_id !== user.id) throw forbidden();
  return s;
}

export async function ownPatient(user, patientId) {
  uuid(patientId, 'patient');
  const p = await one('SELECT * FROM patients WHERE id=$1 AND owner_id=$2', [patientId, user.id]);
  if (!p) throw notFound('Patient introuvable');
  return p;
}

/** Can this user (session) read images of this StudyInstanceUID? */
export async function userCanViewUid(user, uid) {
  if (user.role === 'admin') return true;
  const row = await one(
    `SELECT 1 FROM studies WHERE study_uid=$1 AND (
       (owner_id=$2) OR (client_id=$2)
     ) LIMIT 1`,
    [uid, user.id]
  );
  return Boolean(row);
}

/** Delete a study from the workspace, plus anonymized share copies and, if unused elsewhere, the Orthanc study */
export async function deleteStudyEverywhere(study) {
  const shares = await many('SELECT anon_orthanc_id FROM shares WHERE study_id=$1', [study.id]);
  for (const sh of shares) {
    if (sh.anon_orthanc_id) await orthanc.deleteStudy(sh.anon_orthanc_id).catch(() => {});
  }
  await q('DELETE FROM studies WHERE id=$1', [study.id]);
  invalidateAuthCache();
  const other = await one('SELECT 1 FROM studies WHERE study_uid=$1 LIMIT 1', [study.study_uid]);
  if (!other) await orthanc.deleteStudy(study.orthanc_id).catch(() => {});
}
