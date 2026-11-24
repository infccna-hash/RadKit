import { config } from '../config.js';
import { HttpError } from './http.js';

const authHeader = config.orthanc.user
  ? 'Basic ' + Buffer.from(`${config.orthanc.user}:${config.orthanc.password}`).toString('base64')
  : null;

async function call(method, path, { body, json, headers = {}, raw = false } = {}) {
  const h = { ...headers };
  if (authHeader) h.Authorization = authHeader;
  let payload = body;
  if (json !== undefined) {
    h['Content-Type'] = 'application/json';
    payload = JSON.stringify(json);
  }
  let res;
  try {
    res = await fetch(config.orthanc.url + path, { method, headers: h, body: payload });
  } catch (e) {
    throw new HttpError(502, `Serveur DICOM injoignable (${e.message})`);
  }
  if (raw) return res;
  const text = await res.text();
  if (!res.ok) {
    // Orthanc answers 400 for files it cannot parse: that's the client's file, not a server failure
    const status = res.status === 404 ? 404 : res.status === 400 || res.status === 415 ? 400 : 502;
    throw new HttpError(status, `Orthanc ${method} ${path}: ${res.status} ${text.slice(0, 200)}`);
  }
  return text ? JSON.parse(text) : null;
}

/** Poll an Orthanc job until it finishes. Returns the job JSON on success. */
async function waitJob(jobId, timeoutMs = 2 * 3600e3) {
  const deadline = Date.now() + timeoutMs;
  for (let delay = 200; Date.now() < deadline; delay = Math.min(delay * 1.5, 3000)) {
    const j = await call('GET', `/jobs/${encodeURIComponent(jobId)}`);
    if (j.State === 'Success') return j;
    if (j.State === 'Failure') throw new Error(`Orthanc : ${j.ErrorDescription || 'échec du job'}`);
    await new Promise((r) => setTimeout(r, delay));
  }
  throw new Error('Délai dépassé pour le job Orthanc');
}

export const orthanc = {
  system: () => call('GET', '/system'),

  /** Store one DICOM instance. Returns { ID, ParentStudy, ParentSeries, ParentPatient, Status } */
  uploadInstance: (buffer) =>
    call('POST', '/instances', { body: buffer, headers: { 'Content-Type': 'application/dicom' } }),

  study: (id) => call('GET', `/studies/${encodeURIComponent(id)}`),
  studySeries: (id) => call('GET', `/studies/${encodeURIComponent(id)}/series`),
  seriesSharedTags: (id) => call('GET', `/series/${encodeURIComponent(id)}/shared-tags?simplify`),

  /** Find the Orthanc ID of a study by its StudyInstanceUID */
  async lookupStudy(uid) {
    const hits = await call('POST', '/tools/lookup', { body: uid, headers: { 'Content-Type': 'text/plain' } });
    return (hits || []).find((h) => h.Type === 'Study')?.ID || null;
  },

  /** De-identify a whole study into a NEW study (original untouched). */
  anonymizeStudy: (id, { patientId, keep = [] }) =>
    call('POST', `/studies/${encodeURIComponent(id)}/anonymize`, {
      json: {
        Replace: { PatientName: 'ANONYME', PatientID: patientId },
        Keep: keep,
        KeepPrivateTags: false,
        Force: true,
      },
    }),

  /** Slices of a series in geometric order: SlicesShort = [[instanceId, firstFrame, frameCount], ...] */
  orderedSlices: (id) => call('GET', `/series/${encodeURIComponent(id)}/ordered-slices`),
  instanceStudy: (id) => call('GET', `/instances/${encodeURIComponent(id)}/study`),
  instanceTags: (id) => call('GET', `/instances/${encodeURIComponent(id)}/simplified-tags`),

  /** Server-side rendered frame (windowing applied by Orthanc), streamed */
  rendered: (id, frame, params) =>
    call('GET', `/instances/${encodeURIComponent(id)}/frames/${frame}/rendered?${params}`, {
      raw: true,
      headers: { Accept: 'image/jpeg' },
    }),
  preview: (id, frame) => call('GET', `/instances/${encodeURIComponent(id)}/frames/${frame}/preview`, { raw: true }),

  /** Same as anonymizeStudy but as an Orthanc job, polled until done. Returns the new study ID. */
  async anonymizeStudyJob(id, { patientId, keep = [], replace = {} }) {
    const job = await call('POST', `/studies/${encodeURIComponent(id)}/anonymize`, {
      json: {
        Replace: { ...replace, PatientName: 'ANONYME', PatientID: patientId },
        Keep: keep,
        KeepPrivateTags: false,
        Force: true,
        Asynchronous: true,
      },
    });
    const j = await waitJob(job.ID);
    if (j.Content?.ID) return j.Content.ID;
    const found = await call('POST', '/tools/find', { json: { Level: 'Study', Query: { PatientID: patientId } } });
    if (found?.[0]) return found[0];
    throw new Error('Étude anonymisée introuvable');
  },

  deleteStudy: (id) => call('DELETE', `/studies/${encodeURIComponent(id)}`),

  /** Streamed ZIP of the study */
  archive: (id) => call('GET', `/studies/${encodeURIComponent(id)}/archive`, { raw: true }),

  /** ZIP built by an Orthanc job: served afterwards with an exact Content-Length (truncation becomes detectable) */
  async archiveViaJob(id) {
    const job = await call('POST', `/studies/${encodeURIComponent(id)}/archive`, { json: { Asynchronous: true } });
    await waitJob(job.ID, 3600e3);
    return call('GET', `/jobs/${encodeURIComponent(job.ID)}/archive`, { raw: true });
  },
};

/** Normalize a summary of an Orthanc study into the fields we store */
export async function readStudySummary(orthancId) {
  const st = await orthanc.study(orthancId);
  const series = await orthanc.studySeries(orthancId);
  const m = st.MainDicomTags || {};
  const p = st.PatientMainDicomTags || {};
  const modalities = [...new Set(series.map((s) => s.MainDicomTags?.Modality).filter(Boolean))];
  const bodyPart = series.map((s) => s.MainDicomTags?.BodyPartExamined).find(Boolean) || null;
  const instanceCount = series.reduce((n, s) => n + (s.Instances?.length || 0), 0);
  return {
    orthancId,
    studyUid: m.StudyInstanceUID,
    accession: m.AccessionNumber || null,
    studyDate: dicomDate(m.StudyDate),
    description: m.StudyDescription || null,
    institution: m.InstitutionName || null,
    referring: cleanPN(m.ReferringPhysicianName) || null,
    modalities,
    bodyPart,
    seriesCount: series.length,
    instanceCount,
    seriesIds: series.map((s) => s.ID),
    patient: {
      name: cleanPN(p.PatientName) || '',
      rawName: p.PatientName || '',
      id: (p.PatientID || '').trim(),
      issuer: (p.IssuerOfPatientID || m.InstitutionName || '').trim(),
      birthDate: dicomDate(p.PatientBirthDate),
      sex: ['M', 'F', 'O'].includes(p.PatientSex) ? p.PatientSex : null,
    },
  };
}

export function dicomDate(v) {
  if (!v || !/^\d{8}$/.test(v)) return null;
  const y = v.slice(0, 4), mo = v.slice(4, 6), d = v.slice(6, 8);
  if (+mo < 1 || +mo > 12 || +d < 1 || +d > 31) return null;
  return `${y}-${mo}-${d}`;
}

/** "DOE^JOHN^^DR" → "DOE JOHN" */
export function cleanPN(v) {
  if (!v) return '';
  return String(v).split('=')[0].replace(/\^+/g, ' ').replace(/\s+/g, ' ').trim();
}
