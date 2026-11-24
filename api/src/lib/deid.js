// Free-text de-identification for shares.
// Orthanc's anonymizer handles structured tags (PatientName, IDs, dates, institution...). Free-text fields we
// choose to keep for clinical context (StudyDescription, SeriesDescription, ProtocolName) can still contain the
// patient's identity because technicians type it there. These helpers find and remove it.

const norm = (s) =>
  String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Identity tokens of one patient: name words (≥3 letters), IDs, birth date in common spellings */
export function identifierTokens({ names = [], ids = [], birthDate = null }) {
  const words = new Set();
  const literals = new Set();
  for (const n of names)
    for (const w of norm(n).split(/[^a-z0-9]+/)) if (w.length >= 3 && !/^\d+$/.test(w)) words.add(w);
  for (const id of ids) {
    const v = norm(id).trim();
    if (v.length >= 3) literals.add(v);
  }
  if (birthDate && /^\d{4}-\d{2}-\d{2}$/.test(birthDate)) {
    const [y, m, d] = birthDate.split('-');
    for (const v of [`${y}${m}${d}`, `${d}/${m}/${y}`, `${d}.${m}.${y}`, `${d}-${m}-${y}`, `${y}-${m}-${d}`]) literals.add(v);
  }
  return { words: [...words], literals: [...literals] };
}

function patterns({ words, literals }) {
  const out = [];
  for (const w of words) out.push(new RegExp(`(?<![a-z0-9])${escapeRe(w)}(?![a-z0-9])`, 'g'));
  for (const l of literals) out.push(new RegExp(`(?<![a-z0-9])${escapeRe(l)}(?![a-z0-9])`, 'g'));
  return out;
}

export function containsIdentifiers(text, tokens) {
  if (!text) return false;
  const t = norm(text);
  return patterns(tokens).some((re) => re.test(t));
}

/**
 * Replace identity tokens with "***", keeping the rest of the text (e.g. "TDM THORAX ***").
 * Works on the accent-folded text so that "Zoubir"/"ZOUBIR"/"Zoùbir" are all caught; the result is the folded,
 * upper-cased text (DICOM descriptions are conventionally upper case anyway).
 */
export function scrub(text, tokens) {
  if (!text) return text;
  let t = norm(text);
  for (const re of patterns(tokens)) t = t.replace(re, '***');
  return t
    .replace(/(\*\*\*[\s^,;:/-]*)+\*\*\*/g, '***')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

/** Tokens for a RadKit study row (+ the patient's name as edited in the workspace, if any) */
export function tokensForStudy(study, patientName) {
  return identifierTokens({
    names: [study.dicom_patient_name, patientName].filter(Boolean),
    ids: [study.dicom_patient_id, study.accession].filter(Boolean),
    birthDate: study.dicom_birth_date,
  });
}

/** Description safe to show on a public share page */
export function safeDescription(study, patientName) {
  const tokens = tokensForStudy(study, patientName);
  return containsIdentifiers(study.description, tokens) ? scrub(study.description, tokens) : study.description;
}
