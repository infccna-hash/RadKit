// Free-text de-identification for shares.
// Orthanc's anonymizer handles structured tags (PatientName, IDs, dates, institution...). Free-text fields we
// choose to keep for clinical context (StudyDescription, SeriesDescription, ProtocolName) can still contain the
// patient's identity because technicians type it there. These helpers find and remove it.

// Script-agnostic folding: names are typed in Latin AND Arabic in Algeria. Remove every combining mark (Latin
// accents, Arabic harakat), fold Arabic letter variants used interchangeably, drop tatweel, and map
// Arabic-Indic digits so IDs and dates typed in either digit set match.
const AR_FOLD = [
  [/[أإآٱ]/g, 'ا'], // أ إ آ ٱ -> ا
  [/ى/g, 'ي'], // ى -> ي
  [/ة/g, 'ه'], // ة -> ه
  [/ؤ/g, 'و'], // ؤ -> و
  [/ئ/g, 'ي'], // ئ -> ي
  [/ـ/g, ''], // tatweel
];
export const norm = (s) => {
  let t = String(s ?? '')
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase();
  for (const [re, to] of AR_FOLD) t = t.replace(re, to);
  return t
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x6f0));
};

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const WORD = '[\\p{L}\\p{N}]'; // a letter or digit in ANY script

/** Identity tokens of one patient: name words (>=3 letters, any script), IDs, birth date in common spellings.
 *  A DICOM PN "LATIN^NAME=ARABIC^NAME" yields the words of every group. */
export function identifierTokens({ names = [], ids = [], birthDate = null }) {
  const words = new Set();
  const literals = new Set();
  for (const n of names)
    for (const w of norm(n).split(/[^\p{L}\p{N}]+/u)) if ([...w].length >= 3 && !/^\d+$/.test(w)) words.add(w);
  for (const id of ids) {
    const v = norm(id).trim();
    if (v.length >= 3) literals.add(v);
  }
  if (birthDate && /^\d{4}-\d{2}-\d{2}$/.test(birthDate)) {
    const [y, m, d] = birthDate.split('-');
    for (const v of [`${y}${m}${d}`, `${d}/${m}/${y}`, `${d}.${m}.${y}`, `${d}-${m}-${y}`, `${y}-${m}-${d}`, `${y}/${m}/${d}`]) literals.add(v);
  }
  return { words: [...words], literals: [...literals] };
}

function patterns({ words, literals }) {
  return [...words, ...literals].map((t) => new RegExp(`(?<!${WORD})${escapeRe(t)}(?!${WORD})`, 'gu'));
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
    // raw_names: every PN seen for this patient, all groups (dicom_patient_name keeps only the first one)
    names: [study.dicom_patient_name, study.dicom_patient_name_raw, patientName, study.raw_names, study.orthanc_patient_name].filter(Boolean),
    ids: [study.dicom_patient_id, study.accession].filter(Boolean),
    birthDate: study.dicom_birth_date,
  });
}

/** Description safe to show on a public share page */
export function safeDescription(study, patientName) {
  const tokens = tokensForStudy(study, patientName);
  return containsIdentifiers(study.description, tokens) ? scrub(study.description, tokens) : study.description;
}
