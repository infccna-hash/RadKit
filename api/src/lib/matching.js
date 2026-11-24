/**
 * Patient name matching tuned for Algerian names written in French transliteration
 * (Mohamed / Mohammed / Mhamed, Benali / Ben Ali, Abdelkader / Abd El Kader…).
 * We NEVER merge on this alone: it only produces suggestions the radiologist confirms.
 */

const VOWELS = /[aeiouy]/g;

export function tokens(name) {
  return String(name || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[\^,._\-']/g, ' ')
    .replace(/[^\p{L}\s]/gu, '')
    .split(/\s+/)
    .filter(Boolean);
}

/** Phonetic skeleton of one token: first letter + consonants, digraphs simplified, repeats collapsed */
export function tokenKey(t) {
  let s = t
    .replace(/ou/g, 'u')
    .replace(/ph/g, 'f')
    .replace(/sh|ch/g, 'c')
    .replace(/dj/g, 'j')
    .replace(/kh/g, 'k')
    .replace(/gh/g, 'g')
    .replace(/q/g, 'k')
    .replace(/th/g, 't')
    .replace(/dh/g, 'd')
    .replace(/ck/g, 'k');
  if (!s) return '';
  s = s[0] + s.slice(1).replace(VOWELS, '');
  return s.replace(/(.)\1+/g, '$1');
}

/** Order-independent key stored on the patient row */
export function nameKey(name) {
  return tokens(name).map(tokenKey).filter(Boolean).sort().join(' ');
}

export function jaroWinkler(a, b) {
  if (a === b) return a ? 1 : 0;
  if (!a || !b) return 0;
  const range = Math.max(0, Math.floor(Math.max(a.length, b.length) / 2) - 1);
  const am = new Array(a.length).fill(false);
  const bm = new Array(b.length).fill(false);
  let matches = 0;
  for (let i = 0; i < a.length; i++) {
    const lo = Math.max(0, i - range), hi = Math.min(i + range + 1, b.length);
    for (let j = lo; j < hi; j++) {
      if (bm[j] || a[i] !== b[j]) continue;
      am[i] = bm[j] = true;
      matches++;
      break;
    }
  }
  if (!matches) return 0;
  let t = 0, k = 0;
  for (let i = 0; i < a.length; i++) {
    if (!am[i]) continue;
    while (!bm[k]) k++;
    if (a[i] !== b[k]) t++;
    k++;
  }
  const jaro = (matches / a.length + matches / b.length + (matches - t / 2) / matches) / 3;
  let prefix = 0;
  while (prefix < 4 && a[prefix] === b[prefix]) prefix++;
  return jaro + prefix * 0.1 * (1 - jaro);
}

/** Similarity 0..1 between two full names, robust to word order and split/joined particles */
export function nameSimilarity(n1, n2) {
  const t1 = tokens(n1), t2 = tokens(n2);
  if (!t1.length || !t2.length) return 0;
  const k1 = t1.map(tokenKey), k2 = t2.map(tokenKey);
  const sorted1 = [...k1].sort().join(''), sorted2 = [...k2].sort().join('');
  const cat1 = tokenKey(t1.join('')), cat2 = tokenKey(t2.join(''));
  const cat2r = tokenKey([...t2].reverse().join(''));
  return Math.max(
    jaroWinkler(sorted1, sorted2),
    jaroWinkler(cat1, cat2),
    jaroWinkler(cat1, cat2r)
  );
}

/**
 * Score a new patient against an existing one.
 * @returns {{score:number, reasons:string[]}}
 */
export function scorePatients(a, b) {
  const reasons = [];
  const sim = nameSimilarity(a.full_name, b.full_name);
  let score = sim;
  const sameSpelling = tokens(a.full_name).sort().join(' ') === tokens(b.full_name).sort().join(' ');
  if (sameSpelling) reasons.push('Nom identique');
  else if (sim >= 0.999) reasons.push("Même nom, variante d'écriture");
  else if (sim >= 0.85) reasons.push(`Nom proche (${Math.round(sim * 100)} %)`);

  if (a.birth_date && b.birth_date) {
    if (a.birth_date === b.birth_date) {
      score += 0.12;
      reasons.push('Même date de naissance');
    } else {
      score -= 0.25;
      reasons.push('Dates de naissance différentes');
    }
  }
  if (a.sex && b.sex && a.sex !== b.sex) {
    score -= 0.3;
    reasons.push('Sexe différent');
  }
  if (a.shared_identifier) {
    score += 0.2;
    reasons.push('Même identifiant DICOM');
  }
  return { score: Math.max(0, Math.min(1, score)), reasons };
}

export const SUGGEST_THRESHOLD = 0.85;
export const AUTO_ATTACH_NAME_THRESHOLD = 0.85;
