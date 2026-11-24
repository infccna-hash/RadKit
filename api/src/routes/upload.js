import { Router } from 'express';
import express from 'express';
import { one, q } from '../db.js';
import { ah, bad, forbidden, str, oneOf, uuid } from '../lib/http.js';
import { requireRole } from '../lib/auth.js';
import { orthanc } from '../lib/orthanc.js';
import { ingestStudy } from '../lib/ingest.js';
import { audit } from '../lib/audit.js';

const r = Router();

/** One DICOM file per request (the browser parallelizes). Raw body, never JSON-parsed. */
r.post(
  '/upload/instance',
  requireRole('radiologist', 'client'),
  express.raw({ type: () => true, limit: '2gb' }),
  ah(async (req, res) => {
    const buf = req.body;
    if (!Buffer.isBuffer(buf) || buf.length < 132) throw bad('Fichier vide ou trop petit');
    if (buf.toString('ascii', 128, 132) !== 'DICM') throw bad('Ce fichier n\'est pas un DICOM (préambule DICM absent)');
    const result = await orthanc.uploadInstance(buf);
    if (!result?.ParentStudy) throw bad('Orthanc a refusé ce fichier');
    await q('INSERT INTO pending_uploads (orthanc_study_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [
      result.ParentStudy,
      req.user.id,
    ]);
    res.json({ study: result.ParentStudy, status: result.Status });
  })
);

/**
 * After all files are sent: register each study, create/attach patients.
 * Client uploads must name the radiologist they send to.
 */
r.post(
  '/upload/finalize',
  requireRole('radiologist', 'client'),
  ah(async (req, res) => {
    const ids = req.body.studies;
    if (!Array.isArray(ids) || !ids.length || ids.length > 200) throw bad('Liste d\'études invalide');
    const clinicalInfo = str(req.body.clinicalInfo, { max: 4000 });
    const priority = req.body.priority ? oneOf(req.body.priority, ['urgent', 'normal', 'low'], 'Priorité') : 'normal';

    let ownerId = req.user.id;
    let clientId = null;
    if (req.user.role === 'client') {
      ownerId = uuid(req.body.radiologistId, 'radiologue');
      const link = await one('SELECT 1 FROM client_links WHERE client_id=$1 AND radiologist_id=$2', [req.user.id, ownerId]);
      if (!link) throw forbidden('Vous n\'êtes pas rattaché à ce radiologue');
      clientId = req.user.id;
    }

    const results = [];
    for (const id of [...new Set(ids)]) {
      if (typeof id !== 'string') continue;
      const pending = await one('SELECT 1 FROM pending_uploads WHERE orthanc_study_id=$1 AND user_id=$2', [id, req.user.id]);
      if (!pending) {
        results.push({ orthancId: id, error: 'Étude non envoyée par vous' });
        continue;
      }
      try {
        const out = await ingestStudy({ orthancId: id, ownerId, clientId, uploadedBy: req.user.id, clinicalInfo, priority });
        await q('DELETE FROM pending_uploads WHERE orthanc_study_id=$1 AND user_id=$2', [id, req.user.id]);
        results.push({
          orthancId: id,
          studyId: out.study.id,
          created: out.created,
          description: out.study.description,
          modalities: out.study.modalities,
          patientName: out.study.dicom_patient_name,
          patientHow: out.patient.how,
          suggestions: out.patient.suggestions,
          conflict: Boolean(out.patient.conflict),
        });
        await audit(req, 'study_uploaded', out.study.id, { owner: ownerId, client: clientId });
      } catch (e) {
        results.push({ orthancId: id, error: e.message });
      }
    }
    res.json({ results });
  })
);

export default r;
