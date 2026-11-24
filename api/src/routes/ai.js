import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { one } from '../db.js';
import { ah, str, oneOf, bad } from '../lib/http.js';
import { requireRole } from '../lib/auth.js';
import { ownStudy } from '../lib/access.js';
import { chat, ageBand, parseJsonReply } from '../lib/ai.js';
import { audit } from '../lib/audit.js';

const r = Router();
r.use('/ai', requireRole('radiologist'), rateLimit({ windowMs: 60e3, limit: 20, standardHeaders: true, legacyHeaders: false }));

/** De-identified context only: modality, description, age, sex, clinical indication */
function context(s) {
  return [
    `Modalité(s) : ${s.modalities.join(', ') || 'inconnue'}`,
    s.description && `Examen : ${s.description}`,
    s.body_part && `Région : ${s.body_part}`,
    ageBand(s.dicom_birth_date, s.study_date) && `Âge : ${ageBand(s.dicom_birth_date, s.study_date)}`,
    s.dicom_sex && `Sexe : ${s.dicom_sex}`,
    s.clinical_info && `Indication fournie : ${s.clinical_info}`,
  ]
    .filter(Boolean)
    .join('\n');
}

/** Turn the radiologist's rough notes / dictation into a structured French report draft */
r.post(
  '/ai/draft-report',
  ah(async (req, res) => {
    const s = await ownStudy(req.user, req.body.studyId);
    const notes = str(req.body.notes, { required: true, name: 'Notes', max: 8000 });
    const system =
      "Tu es un assistant de rédaction pour radiologue francophone en Algérie. Tu mets en forme un compte rendu à partir des notes du radiologue. " +
      "Règles : n'invente AUCUNE observation absente des notes ; ne pose pas de diagnostic que les notes ne contiennent pas ; style médical concis ; " +
      "si une information manque, laisse la section courte plutôt que d'inventer. " +
      'Réponds UNIQUEMENT en JSON : {"indication": "...", "technique": "...", "findings": "...", "conclusion": "..."}';
    const reply = await chat(system, `${context(s)}\n\nNotes du radiologue :\n${notes}`);
    const draft = parseJsonReply(reply);
    if (!draft) throw bad("Réponse de l'IA illisible, réessayez");
    await audit(req, 'ai_draft', s.id);
    res.json({ draft });
  })
);

/** Plain-language version of the final conclusion for the patient (French or Arabic) */
r.post(
  '/ai/patient-summary',
  ah(async (req, res) => {
    const s = await ownStudy(req.user, req.body.studyId);
    const lang = oneOf(req.body.lang || 'fr', ['fr', 'ar'], 'langue');
    const rep = await one('SELECT findings, conclusion FROM reports WHERE study_id=$1', [s.id]);
    if (!rep?.conclusion && !rep?.findings) throw bad("Rédigez d'abord la conclusion");
    const system =
      (lang === 'ar'
        ? 'اكتب بالعربية الفصحى البسيطة. '
        : 'Écris en français simple, niveau grand public. ') +
      "Tu reformules un compte rendu de radiologie pour le patient. N'ajoute aucune information médicale absente du texte, " +
      "ne rassure pas et n'alarme pas au-delà de ce qui est écrit, termine en invitant à en parler avec le médecin traitant. 120 mots maximum.";
    const text = await chat(system, `Résultats :\n${rep.findings || ''}\n\nConclusion :\n${rep.conclusion || ''}`, {
      maxTokens: 600,
    });
    await audit(req, 'ai_patient_summary', s.id, { lang });
    res.json({ text });
  })
);

export default r;
