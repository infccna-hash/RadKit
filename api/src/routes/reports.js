import { Router } from 'express';
import { one } from '../db.js';
import { ah, str, bad } from '../lib/http.js';
import { requireRole } from '../lib/auth.js';
import { ownStudy } from '../lib/access.js';
import { templates } from '../lib/templates.js';
import { audit } from '../lib/audit.js';

const r = Router();

r.get('/report-templates', requireRole('radiologist'), (_req, res) => res.json({ templates }));

const FIELDS = ['title', 'indication', 'technique', 'findings', 'conclusion', 'patient_summary'];
const BODY_KEYS = { title: 'title', indication: 'indication', technique: 'technique', findings: 'findings', conclusion: 'conclusion', patient_summary: 'patientSummary' };

/** Save (create or update) the draft */
r.put(
  '/studies/:id/report',
  requireRole('radiologist'),
  ah(async (req, res) => {
    const s = await ownStudy(req.user, req.params.id);
    const existing = await one('SELECT * FROM reports WHERE study_id=$1', [s.id]);
    if (existing?.status === 'final') throw bad('Compte rendu validé : rouvrez-le pour le modifier');
    const v = {};
    for (const f of FIELDS) {
      const val = req.body[BODY_KEYS[f]];
      v[f] = val === undefined ? existing?.[f] ?? null : str(val, { max: 20000, name: f });
    }
    const report = await one(
      `INSERT INTO reports (study_id, author_id, title, indication, technique, findings, conclusion, patient_summary)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (study_id) DO UPDATE SET title=$3, indication=$4, technique=$5, findings=$6, conclusion=$7,
         patient_summary=$8, updated_at=now()
       RETURNING *`,
      [s.id, req.user.id, v.title, v.indication, v.technique, v.findings, v.conclusion, v.patient_summary]
    );
    if (s.status === 'new') await one("UPDATE studies SET status='in_progress' WHERE id=$1 RETURNING id", [s.id]);
    res.json({ report });
  })
);

r.post(
  '/studies/:id/report/finalize',
  requireRole('radiologist'),
  ah(async (req, res) => {
    const s = await ownStudy(req.user, req.params.id);
    const rep = await one('SELECT * FROM reports WHERE study_id=$1', [s.id]);
    if (!rep) throw bad('Aucun compte rendu à valider');
    if (!rep.conclusion?.trim() && !rep.findings?.trim()) throw bad('Le compte rendu est vide');
    const report = await one(
      "UPDATE reports SET status='final', finalized_at=now(), updated_at=now() WHERE id=$1 RETURNING *",
      [rep.id]
    );
    await one("UPDATE studies SET status='reported', reported_at=now() WHERE id=$1 RETURNING id", [s.id]);
    await audit(req, 'report_finalized', s.id);
    res.json({ report });
  })
);

r.post(
  '/studies/:id/report/reopen',
  requireRole('radiologist'),
  ah(async (req, res) => {
    const s = await ownStudy(req.user, req.params.id);
    const report = await one(
      "UPDATE reports SET status='draft', finalized_at=NULL, updated_at=now() WHERE study_id=$1 RETURNING *",
      [s.id]
    );
    if (!report) throw bad('Aucun compte rendu');
    await one("UPDATE studies SET status='in_progress', reported_at=NULL WHERE id=$1 RETURNING id", [s.id]);
    await audit(req, 'report_reopened', s.id);
    res.json({ report });
  })
);

export default r;
