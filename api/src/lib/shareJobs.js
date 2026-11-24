// Anonymized copies are prepared in the background: creating a share answers immediately,
// the copy is built by an Orthanc job (no HTTP timeout, even for thousands of images).
import { one, many, q } from '../db.js';
import { orthanc } from './orthanc.js';
import { invalidateAuthCache } from '../routes/internal.js';

const KEEP = ['StudyDescription', 'SeriesDescription', 'BodyPartExamined', 'PatientSex', 'PatientAge', 'ProtocolName'];
const queue = [];
let running = false;

export function enqueuePrepare(shareId) {
  if (!queue.includes(shareId)) queue.push(shareId);
  if (!running) run();
}

/** One job at a time: anonymization is I/O heavy on Orthanc */
async function run() {
  running = true;
  try {
    while (queue.length) {
      const id = queue.shift();
      await prepare(id).catch((e) => console.error(`share ${id}:`, e.message));
    }
  } finally {
    running = false;
  }
}

export async function prepare(shareId) {
  const sh = await one(
    'SELECT sh.*, s.orthanc_id FROM shares sh JOIN studies s ON s.id = sh.study_id WHERE sh.id = $1',
    [shareId]
  );
  if (!sh || sh.status !== 'preparing') return;
  const t0 = Date.now();
  try {
    const anonId = await orthanc.anonymizeStudyJob(sh.orthanc_id, { patientId: sh.anon_patient_id, keep: KEEP });
    const st = await orthanc.study(anonId);
    const uid = st?.MainDicomTags?.StudyInstanceUID;
    if (!uid) throw new Error("L'anonymisation n'a pas produit d'étude");
    const done = await one(
      `UPDATE shares SET status='ready', anon_orthanc_id=$2, anon_study_uid=$3, prepared_at=now(), error=NULL
       WHERE id=$1 AND status='preparing' AND revoked_at IS NULL RETURNING id`,
      [shareId, anonId, uid]
    );
    // Revoked or study deleted while we were working: drop the copy
    if (!done) await orthanc.deleteStudy(anonId).catch(() => {});
    invalidateAuthCache();
    console.log(`share ${shareId} ready in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  } catch (e) {
    await q("UPDATE shares SET status='failed', error=$2 WHERE id=$1 AND status='preparing'", [shareId, String(e.message).slice(0, 500)]);
    throw e;
  }
}

/** After a restart, finish what was in progress */
export async function resumePending() {
  const rows = await many("SELECT id FROM shares WHERE status='preparing' AND revoked_at IS NULL ORDER BY created_at");
  rows.forEach((r) => enqueuePrepare(r.id));
  if (rows.length) console.log(`resuming ${rows.length} share preparation(s)`);
}
