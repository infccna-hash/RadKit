// End-to-end API test against a real PostgreSQL and a mock Orthanc + mock DeepSeek.
// Run: cd tests && TEST_DATABASE_URL=postgres://... node --test
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import express from 'express';
import { startMockOrthanc } from './mock-orthanc.js';

const DB = process.env.TEST_DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/radkit_test';
let api, mock, ds, base, dicomDir, modules;

before(async () => {
  dicomDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rk-dcm-'));
  execFileSync('python3', [path.join(import.meta.dirname, 'make_dicoms.py'), dicomDir]);
  mock = await startMockOrthanc(18042);
  const dsApp = express().use(express.json());
  dsApp.post('/chat/completions', (req, res) => {
    const sys = req.body.messages[0].content;
    const user = req.body.messages[1].content;
    // Must never receive names or IDs
    assert.ok(!/BENALI|SAADI|P123|F55/i.test(user), 'identifiers leaked to AI: ' + user);
    const content = sys.includes('JSON')
      ? '```json\n{"indication":"Douleur","technique":"TDM","findings":"Pas d\'anomalie.","conclusion":"Examen normal."}\n```'
      : 'Votre examen est normal. Parlez-en à votre médecin.';
    res.json({ choices: [{ message: { content } }] });
  });
  ds = dsApp.listen(18090);

  Object.assign(process.env, {
    DATABASE_URL: DB, JWT_SECRET: 'test-secret', SHARE_SECRET: 'share-secret',
    ORTHANC_URL: 'http://127.0.0.1:18042', ORTHANC_USER: 'orthanc', ORTHANC_PASSWORD: 'secret',
    DEEPSEEK_API_KEY: 'k', DEEPSEEK_BASE_URL: 'http://127.0.0.1:18090', PUBLIC_VIEWER_URL: 'http://viewer.test',
  });
  const db = await import('../api/src/db.js');
  await db.q('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await db.migrate();
  const bcrypt = (await import('../api/node_modules/bcryptjs/index.js')).default;
  await db.q(`INSERT INTO users (email,password_hash,full_name,role) VALUES ('admin@rk.dz',$1,'Admin','admin')`, [
    await bcrypt.hash('adminpass', 4),
  ]);
  const { createApp } = await import('../api/src/server.js');
  modules = { db };
  await new Promise((r) => (api = createApp().listen(18080, r)));
  base = 'http://127.0.0.1:18080/api';
});

after(async () => {
  api?.close();
  mock?.server.close();
  ds?.close();
  await modules?.db.pool.end();
});

async function waitShare(c, id) {
  for (let i = 0; i < 200; i++) {
    const r = await c.call('GET', `/shares/${id}`);
    if (r.body.share.status !== 'preparing') return r.body.share;
    await new Promise((res) => setTimeout(res, 50));
  }
  throw new Error('share never left preparing');
}

// ---- tiny client with cookie jar ----
function client() {
  const jar = {};
  const call = async (method, url, body, { raw, headers = {}, csrf = true } = {}) => {
    const h = { ...headers, Cookie: Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ') };
    if (csrf) h['X-RadKit'] = '1';
    if (body !== undefined && !raw) h['Content-Type'] = 'application/json';
    const res = await fetch(base + url, { method, headers: h, body: raw ? body : body !== undefined ? JSON.stringify(body) : undefined });
    for (const c of res.headers.getSetCookie()) {
      const [kv] = c.split(';');
      const [k, v] = kv.split('=');
      jar[k] = v;
    }
    const ct = res.headers.get('content-type') || '';
    return { status: res.status, body: ct.includes('json') ? await res.json() : await res.text() };
  };
  return { call, jar };
}

async function upload(c, folder, finalizeExtra = {}) {
  const ids = new Set();
  for (const f of fs.readdirSync(folder)) {
    const r = await c.call('POST', '/upload/instance', fs.readFileSync(path.join(folder, f)), {
      raw: true,
      headers: { 'Content-Type': 'application/dicom' },
    });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    ids.add(r.body.study);
  }
  const fin = await c.call('POST', '/upload/finalize', { studies: [...ids], ...finalizeExtra });
  assert.equal(fin.status, 200, JSON.stringify(fin.body));
  return fin.body.results;
}

const folders = () => fs.readdirSync(dicomDir).sort().map((f) => path.join(dicomDir, f));
const folderFor = (prefix, desc) =>
  folders().filter((f) => path.basename(f).startsWith(prefix));

test('full workflow', async (t) => {
  const admin = client(), rad = client(), clinic = client(), outsider = client(), colleague = client();
  let radPw, clinicPw;

  await t.test('auth + csrf', async () => {
    assert.equal((await admin.call('POST', '/auth/login', { email: 'admin@rk.dz', password: 'bad' })).status, 401);
    assert.equal((await admin.call('POST', '/auth/login', { email: 'admin@rk.dz', password: 'adminpass' })).status, 200);
    const noCsrf = await admin.call('POST', '/admin/users', { email: 'x@x', fullName: 'x', role: 'client' }, { csrf: false });
    assert.equal(noCsrf.status, 403);
    const r = await admin.call('POST', '/admin/users', { email: 'dr@rk.dz', fullName: 'Dr Radiologue', role: 'radiologist' });
    assert.equal(r.status, 201);
    radPw = r.body.tempPassword;
    assert.equal((await rad.call('POST', '/auth/login', { email: 'dr@rk.dz', password: radPw })).status, 200);
    const me = await rad.call('GET', '/auth/me');
    assert.equal(me.body.user.mustChangePassword, true);
    assert.equal((await rad.call('POST', '/auth/password', { current: radPw, next: 'new-strong-pass-1' })).status, 200);
  });

  await t.test('radiologist creates a clinic account', async () => {
    const r = await rad.call('POST', '/clients', { email: 'clinique@rk.dz', organization: 'Clinique El Amel' });
    assert.equal(r.status, 201);
    clinicPw = r.body.tempPassword;
    assert.ok(clinicPw);
    assert.equal((await clinic.call('POST', '/auth/login', { email: 'clinique@rk.dz', password: clinicPw })).status, 200);
    const mine = await clinic.call('GET', '/my-radiologists');
    assert.equal(mine.body.radiologists.length, 1);
    // client cannot reach radiologist endpoints
    assert.equal((await clinic.call('GET', '/patients')).status, 403);
  });

  let radId;
  await t.test('upload creates pending patients, attaches by ID, suggests merges', async () => {
    radId = (await rad.call('GET', '/auth/me')).body.user.id;
    const [p123a, p123b] = folderFor('P123');
    const [x9988] = folderFor('X9988');
    const r1 = await upload(rad, p123a);
    assert.equal(r1[0].patientHow, 'created');
    const r2 = await upload(rad, p123b);
    assert.equal(r2[0].patientHow, 'identifier', 'same PatientID+issuer should attach');
    const r3 = await upload(rad, x9988);
    assert.equal(r3[0].patientHow, 'created');
    assert.equal(r3[0].suggestions, 1, 'BEN ALI MOHAMMED should be suggested as BENALI MOHAMED');

    // re-upload same study is idempotent
    const again = await upload(rad, p123a);
    assert.equal(again[0].created, false);

    // cannot finalize someone else's orthanc study
    const forged = await clinic.call('POST', '/upload/finalize', { studies: [r1[0].orthancId], radiologistId: radId });
    assert.ok(forged.body.results[0].error);
  });

  await t.test('clinic uploads to its radiologist', async () => {
    const [f55] = folderFor('F55');
    const r = await upload(clinic, f55, { radiologistId: radId, clinicalInfo: 'Douleur hypochondre droit', priority: 'urgent' });
    assert.ok(r[0].studyId);
    const list = await clinic.call('GET', '/studies');
    assert.equal(list.body.studies.length, 1);
    assert.equal(list.body.studies[0].private_note, undefined);
    const stats = await rad.call('GET', '/stats');
    assert.equal(stats.body.total, 4);
    assert.equal(stats.body.urgent, 1);
    assert.equal(stats.body.pending_patients, 3);
    assert.equal(stats.body.merges, 1);
  });

  await t.test('merge suggestion accepted', async () => {
    const s = await rad.call('GET', '/merge-suggestions');
    const sug = s.body.suggestions[0];
    assert.ok(sug.reasons.includes('Même date de naissance'));
    const keep = sug.a.full_name === 'BENALI MOHAMED' ? sug.a.id : sug.b.id;
    assert.equal((await rad.call('POST', `/merge-suggestions/${sug.id}/accept`, { keep })).status, 200);
    const p = await rad.call('GET', `/patients/${keep}`);
    assert.equal(p.body.studies.length, 3);
    assert.equal(p.body.identifiers.length, 2);
    assert.equal(p.body.patient.status, 'active');
  });

  let ctStudy, usStudy;
  await t.test('report draft → finalize, client sees only final', async () => {
    const all = (await rad.call('GET', '/studies')).body.studies;
    usStudy = all.find((s) => s.modalities.includes('US'));
    ctStudy = all.find((s) => s.description === 'TDM THORACIQUE');
    const detail = await rad.call('GET', `/studies/${usStudy.id}`);
    assert.equal(detail.body.template.label, 'Échographie');
    assert.equal((await rad.call('PUT', `/studies/${usStudy.id}/report`, { findings: 'Foie normal.', conclusion: 'Échographie normale.' })).status, 200);
    let c = await clinic.call('GET', `/studies/${usStudy.id}`);
    assert.equal(c.body.report, null);
    assert.equal((await rad.call('POST', `/studies/${usStudy.id}/report/finalize`)).status, 200);
    c = await clinic.call('GET', `/studies/${usStudy.id}`);
    assert.equal(c.body.report.conclusion, 'Échographie normale.');
    assert.equal(c.body.study.status, 'reported');
    // clinic cannot see the radiologist's personal studies
    assert.equal((await clinic.call('GET', `/studies/${ctStudy.id}`)).status, 404);
    const hist = await clinic.call('GET', '/client/history');
    assert.equal(hist.body.patients.length, 1);
  });

  await t.test('AI never receives identifiers', async () => {
    const d = await rad.call('POST', '/ai/draft-report', { studyId: ctStudy.id, notes: 'nodule 4mm lobe sup droit' });
    assert.equal(d.status, 200, JSON.stringify(d.body));
    assert.equal(d.body.draft.conclusion, 'Examen normal.');
    const p = await rad.call('POST', '/ai/patient-summary', { studyId: usStudy.id, lang: 'ar' });
    assert.equal(p.status, 200);
  });

  let shareUrl, anonUid;
  await t.test('anonymized share + burned-in guard', async () => {
    const us = await rad.call('POST', `/studies/${usStudy.id}/shares`, { recipient: 'Dr X' });
    assert.equal(us.status, 409);
    assert.equal(us.body.code, 'BURNED_IN_RISK');
    const ok = await rad.call('POST', `/studies/${usStudy.id}/shares`, { recipient: 'Dr X', confirmBurnedIn: true });
    assert.equal(ok.status, 201);
    assert.equal((await waitShare(rad, ok.body.share.id)).status, 'ready');

    mock.state.anonDelay = 300;
    const r = await rad.call('POST', `/studies/${ctStudy.id}/shares`, { recipient: 'Dr Y, CHU', message: 'Votre avis ?', includeReport: true, days: 3 });
    assert.equal(r.status, 201);
    shareUrl = r.body.url;
    // answers immediately; the anonymized copy is built in the background
    assert.equal(r.body.share.status, 'preparing');
    assert.equal(r.body.share.anon_study_uid, null);
    const tok = shareUrl.split('/s/')[1];
    const early = await colleague.call('GET', `/public/shares/${tok}`);
    assert.equal(early.status, 200);
    assert.equal(early.body.share.status, 'preparing');
    const notYet = await colleague.call('GET', `/public/shares/${tok}/lite`);
    assert.equal(notYet.status, 409);
    assert.equal(notYet.body.code, 'PREPARING');
    const ready = await waitShare(rad, r.body.share.id);
    assert.equal(ready.status, 'ready');
    anonUid = ready.anon_study_uid;
    assert.ok(anonUid);
    mock.state.anonDelay = 0;

    // a failed preparation is reported, never served
    mock.state.anonFail = true;
    const bad = await rad.call('POST', `/studies/${ctStudy.id}/shares`, { recipient: 'échec' });
    const failed = await waitShare(rad, bad.body.share.id);
    assert.equal(failed.status, 'failed');
    assert.ok(failed.error.includes('mock failure'));
    assert.equal((await colleague.call('GET', `/public/shares/${bad.body.url.split('/s/')[1]}`)).status, 410);
    mock.state.anonFail = false;
    const anonStudy = [...mock.studies.values()].find((s) => s.main.StudyInstanceUID === anonUid);
    assert.equal(anonStudy.patient.PatientName, 'ANONYME');
    assert.notEqual(anonUid, ctStudy.study_uid);
  });

  const token = () => shareUrl.split('/s/')[1];
  const gate = (c, uri) =>
    c.call('GET', '/internal/dicomweb-auth', undefined, { headers: { 'X-Original-URI': uri, 'X-Original-Method': 'GET' } });

  await t.test('DICOMweb gate', async () => {
    const pub = await colleague.call('GET', `/public/shares/${token()}`);
    assert.equal(pub.status, 200);
    assert.equal(pub.body.share.message, 'Votre avis ?');
    assert.equal(JSON.stringify(pub.body).includes('BENALI'), false);

    assert.equal((await gate(colleague, `/dicom-web/studies/${anonUid}/metadata`)).status, 401);
    const open = await colleague.call('POST', `/public/shares/${token()}/open`);
    assert.ok(open.body.url.startsWith('http://viewer.test/viewer?StudyInstanceUIDs='));
    assert.equal((await gate(colleague, `/dicom-web/studies/${anonUid}/series`)).status, 204);
    assert.equal((await gate(colleague, `/dicom-web/studies?StudyInstanceUID=${anonUid}`)).status, 204);
    assert.equal((await gate(colleague, `/dicom-web/studies/${ctStudy.study_uid}/metadata`)).status, 403, 'share must not open the original');
    assert.equal((await gate(colleague, `/dicom-web/studies`)).status, 403, 'no listing');

    assert.equal((await gate(rad, `/dicom-web/studies/${ctStudy.study_uid}/metadata`)).status, 204);
    assert.equal((await gate(clinic, `/dicom-web/studies/${ctStudy.study_uid}/metadata`)).status, 403);
    assert.equal((await gate(clinic, `/dicom-web/studies/${usStudy.study_uid}/metadata`)).status, 204);
    assert.equal((await gate(outsider, `/dicom-web/studies/${usStudy.study_uid}/metadata`)).status, 401);
    const post = await colleague.call('GET', '/internal/dicomweb-auth', undefined, {
      headers: { 'X-Original-URI': `/dicom-web/studies/${anonUid}`, 'X-Original-Method': 'POST' },
    });
    assert.equal(post.status, 403);

    assert.equal((await colleague.call('POST', `/public/shares/${token()}/replies`, { author: 'Dr Y', body: 'Nodule bénin probable.' })).status, 201);
  });

  let shareLiteImg;
  await t.test('lite viewer (no WebGL)', async () => {
    const m = await rad.call('GET', `/lite/studies/${ctStudy.id}`);
    assert.equal(m.status, 200, JSON.stringify(m.body));
    const se = m.body.series[0];
    assert.equal(se.slices.length, 2);
    assert.equal(se.windowable, true);
    assert.deepEqual(se.window, { c: 40, w: 80 });
    assert.deepEqual(se.pixelSpacing, [0.7, 0.7]);
    const [iid, f] = se.slices[0];
    const img = await rad.call('GET', `/lite/studies/${ctStudy.id}/img/${iid}/${f}?wc=-600&ww=1500`);
    assert.equal(img.status, 200);
    assert.equal(mock.state.lastRendered['window-center'], '-600');
    assert.equal(mock.state.lastRendered['window-width'], '1500');
    // garbage window values are dropped, not forwarded
    await rad.call('GET', `/lite/studies/${ctStudy.id}/img/${iid}/0?wc=abc&ww=1500`);
    assert.equal(mock.state.lastRendered['window-center'], undefined);
    // an instance from another study cannot be read through this study
    const usM = await rad.call('GET', `/lite/studies/${usStudy.id}`);
    assert.equal(usM.body.series[0].windowable, false);
    const [usI] = usM.body.series[0].slices[0];
    assert.equal((await rad.call('GET', `/lite/studies/${ctStudy.id}/img/${usI}/0`)).status, 404);
    assert.equal((await rad.call('GET', `/lite/studies/${ctStudy.id}/img/not-an-id/0`)).status, 404);
    // clinic: its own study yes, the radiologist's personal study no; outsider no
    assert.equal((await clinic.call('GET', `/lite/studies/${usStudy.id}`)).status, 200);
    assert.equal((await clinic.call('GET', `/lite/studies/${ctStudy.id}/img/${iid}/0`)).status, 404);
    assert.equal((await outsider.call('GET', `/lite/studies/${ctStudy.id}`)).status, 401);
    // OHIF without WebGL only knows the StudyInstanceUID: resolve it with the same access rules
    const rv = await rad.call('GET', `/lite/resolve/${ctStudy.study_uid}`);
    assert.equal(rv.status, 200);
    assert.equal(rv.body.studyId, ctStudy.id);
    assert.equal((await clinic.call('GET', `/lite/resolve/${ctStudy.study_uid}`)).status, 404, 'clinic must not resolve a personal study');
    assert.equal((await clinic.call('GET', `/lite/resolve/${usStudy.study_uid}`)).body.studyId, usStudy.id);
    assert.equal((await outsider.call('GET', `/lite/resolve/${ctStudy.study_uid}`)).status, 401);
    assert.equal((await rad.call('GET', `/lite/resolve/${anonUid}`)).status, 404, 'anonymized copies are not studies');
    assert.equal((await rad.call('GET', '/lite/resolve/1.2.abc')).status, 404);
    // share: anonymized copy only
    const pm = await colleague.call('GET', `/public/shares/${token()}/lite`);
    assert.equal(pm.status, 200);
    assert.ok(pm.body.patient.startsWith('RK-'));
    const [ai] = pm.body.series[0].slices[0];
    assert.notEqual(ai, iid);
    shareLiteImg = `/public/shares/${token()}/lite/img/${ai}/0`;
    assert.equal((await colleague.call('GET', shareLiteImg)).status, 200);
    assert.equal((await colleague.call('GET', `/public/shares/${token()}/lite/img/${iid}/0`)).status, 404, 'share cannot reach original images');
  });

  await t.test('revocation is immediate', async () => {
    const list = await rad.call('GET', '/shares');
    const sh = list.body.shares.find((s) => s.anon_patient_id && s.recipient === 'Dr Y, CHU');
    assert.equal(sh.replies.length, 1);
    assert.equal(sh.view_count, 2); // OHIF open + lite viewer
    assert.equal((await rad.call('POST', `/shares/${sh.id}/revoke`)).status, 200);
    assert.equal((await colleague.call('GET', `/public/shares/${token()}`)).status, 410);
    assert.equal((await gate(colleague, `/dicom-web/studies/${anonUid}/metadata`)).status, 403);
  });

  await t.test('lite viewer closes on revoke', async () => {
    assert.equal((await colleague.call('GET', shareLiteImg)).status, 410);
  });

  await t.test('removing a patient removes its studies', async () => {
    const pts = (await rad.call('GET', '/patients?status=pending')).body.patients;
    const saadi = pts.find((p) => p.full_name === 'SAADI FATIMA');
    assert.ok(saadi);
    const del = await rad.call('DELETE', `/patients/${saadi.id}`);
    assert.equal(del.body.studiesRemoved, 1);
    assert.equal((await clinic.call('GET', '/studies')).body.studies.length, 0);
  });

  await t.test('audit: no stray advisory lock after migration', async () => {
    await modules.db.migrate();
    const r = await modules.db.one("SELECT count(*)::int AS n FROM pg_locks WHERE locktype='advisory'");
    assert.equal(r.n, 0, 'advisory lock left held on a pooled connection');
  });

  await t.test('de-identification (metamorphic): identifiers in free-text tags never reach a share', async () => {
    const radId = (await rad.call('GET', '/auth/me')).body.user.id;
    const CANARIES = ['zoubir', 'khalda', 'cnry7731', '19700203', 'canari', 'temoin', 'زبير', 'خالدة'];
    const leaks = (text) => CANARIES.filter((c) => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().includes(c));
    let n = 0;
    async function shareOf(descs) {
      n++;
      const oid = mock.seed({
        patient: { PatientName: descs.pn || 'ZOUBIR^KHALDA', PatientID: 'CNRY7731', PatientBirthDate: '19700203', PatientSex: 'F' },
        study: { StudyInstanceUID: `1.2.826.0.1.777.${n}`, StudyDate: '20261101', StudyDescription: descs.study,
          InstitutionName: 'CLINIQUE CANARI', ReferringPhysicianName: 'DR^TEMOIN', AccessionNumber: 'CNRY7731-A' },
        series: [{ uid: `1.2.826.0.1.777.${n}.1`, number: 1, description: descs.series, protocol: descs.protocol,
          instances: [{ sop: `1.2.826.0.1.777.${n}.1.1`, n: 1 }, { sop: `1.2.826.0.1.777.${n}.1.2`, n: 2 }] }],
      });
      await modules.db.q('INSERT INTO pending_uploads (orthanc_study_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [oid, radId]);
      const studyId = (await rad.call('POST', '/upload/finalize', { studies: [oid] })).body.results[0].studyId;
      const r = await rad.call('POST', `/studies/${studyId}/shares`, { recipient: 'deid' });
      const ready = await waitShare(rad, r.body.share.id);
      assert.equal(ready.status, 'ready', ready.error);
      const tok = r.body.url.split('/s/')[1];
      const info = await colleague.call('GET', `/public/shares/${tok}`);
      const lite = await colleague.call('GET', `/public/shares/${tok}/lite`);
      const anonOid = [...mock.studies.entries()].find(([, st]) => st.main.StudyInstanceUID === ready.anon_study_uid)[0];
      return { payload: JSON.stringify([info.body, lite.body]), tags: mock.allTags(anonOid) };
    }

    // source: clean free text → descriptions are useful context and must survive
    const clean = await shareOf({ study: 'TDM THORAX', series: 'AXIAL 1MM', protocol: 'Thorax std' });
    assert.deepEqual(leaks(clean.payload), []);
    assert.deepEqual(leaks(JSON.stringify(clean.tags)), []);
    assert.equal(clean.tags[0].StudyDescription, 'TDM THORAX');
    assert.equal(clean.tags[0].SeriesDescription, 'AXIAL 1MM');

    // follow-up: same study with the patient's identity typed into every free-text field
    const dirty = await shareOf({ study: 'TDM THORAX ZOUBIR Khalda', series: 'AXIAL CNRY7731', protocol: 'Thorax Khalda 03/02/1970' });
    assert.deepEqual(leaks(dirty.payload), [], 'identifier in public share payload');
    assert.deepEqual(leaks(JSON.stringify(dirty.tags)), [], 'identifier in the anonymized DICOM copy');
    assert.ok(dirty.tags[0].StudyDescription.includes('TDM THORAX'), 'clinical part of the description should be kept');

    // Arabic: DICOM name with an Arabic ideographic group, Arabic typed into the free text
    const arabic = await shareOf({ pn: 'ZOUBIR^KHALDA=زبير^خالدة', study: 'TDM THORAX زبير خالدة', series: 'محوري خالدة', protocol: 'صدر' });
    assert.deepEqual(leaks(arabic.payload), [], 'Arabic identifier in public share payload');
    assert.deepEqual(leaks(JSON.stringify(arabic.tags)), [], 'Arabic identifier in the anonymized DICOM copy');
    assert.ok(arabic.tags[0].StudyDescription.includes('TDM THORAX'));
  });

  await t.test('archive: a truncated ZIP is never a clean 200, a valid ZIP is never cut', async () => {
    const any = (await rad.call('GET', '/studies')).body.studies[0];
    const url = `/studies/${any.id}/download`;
    const fetchZip = async () => {
      const res = await fetch(base + url, { headers: { Cookie: Object.entries(rad.jar).map(([k, v]) => `${k}=${v}`).join('; ') } });
      const buf = Buffer.from(await res.arrayBuffer()); // must throw if the transfer is broken
      return { status: res.status, length: res.headers.get('content-length'), buf };
    };
    const { hasValidZipEnd } = await import('../api/src/lib/http.js');
    const isCompleteZip = (b) => hasValidZipEnd(b.subarray(-65557));

    // normal: complete ZIP, with a Content-Length so browsers show progress and detect truncation themselves
    const ok = await fetchZip();
    assert.equal(ok.status, 200);
    assert.ok(ok.length, 'Content-Length missing');
    assert.equal(Number(ok.length), ok.buf.length);
    assert.ok(isCompleteZip(ok.buf));

    // a VALID archive through the direct stream (older Orthanc, no job): must arrive complete, never be cut by the guard
    mock.state.archiveJobs = false;
    let direct;
    try {
      direct = await fetchZip();
    } catch (e) {
      direct = { error: e.message };
    }
    mock.state.archiveJobs = true;
    assert.ok(!direct.error, `valid archive via direct stream was cut: ${direct.error}`);
    assert.ok(isCompleteZip(direct.buf), 'valid archive via direct stream arrived incomplete');

    // Orthanc cuts the archive cleanly (no length, no chunking) → the client must see an error
    for (const [jobs, mode] of [[true, 'truncate-clean'], [false, 'truncate-clean'], [true, 'short-length']]) {
      mock.state.archiveJobs = jobs;
      mock.state.archive = mode;
      let outcome;
      try {
        const r = await fetchZip();
        outcome = r.status >= 400 ? 'error-status' : isCompleteZip(r.buf) ? 'complete?!' : 'SILENT TRUNCATION';
      } catch {
        outcome = 'transfer-error';
      }
      assert.ok(['transfer-error', 'error-status'].includes(outcome), `jobs=${jobs} ${mode}: ${outcome}`);
    }
    mock.state.archive = 'ok';
    mock.state.archiveJobs = true;
    // and the share download is protected the same way
    assert.equal((await rad.call('GET', '/health')).status, 200);
  });

  await t.test('audit: DB sessions use the clinic time zone', async () => {
    const r = await modules.db.one('SHOW timezone');
    assert.equal(r.TimeZone, 'Africa/Algiers');
  });

  await t.test('audit: upstream dying mid-download does not crash the API', async () => {
    const any = (await rad.call('GET', '/studies')).body.studies[0];
    mock.state.breakArchive = true;
    await rad.call('GET', `/studies/${any.id}/download`).catch(() => {});
    mock.state.breakArchive = false;
    await new Promise((r) => setTimeout(r, 200));
    const h = await rad.call('GET', '/health');
    assert.equal(h.status, 200, 'API died');
  });

  await t.test('audit: malformed input never yields a 500', async () => {
    const rnd = '00000000-0000-4000-8000-000000000000';
    const probes = [
      [rad, 'GET', '/studies?limit=-5'], [rad, 'GET', '/studies?limit=1.5'], [rad, 'GET', '/studies?limit=abc'],
      [rad, 'GET', '/studies?days=abc'], [rad, 'GET', '/studies?status=bogus'], [rad, 'GET', '/studies?client=x'],
      [rad, 'GET', '/studies/not-a-uuid'], [rad, 'GET', `/studies/${rnd}`], [rad, 'PATCH', `/studies/${rnd}`, {}],
      [rad, 'PATCH', `/studies/${rnd}`, { tags: 'x' }], [rad, 'PUT', `/studies/${rnd}/report`, {}],
      [rad, 'POST', '/upload/finalize', { studies: 'x' }], [rad, 'POST', '/upload/finalize', { studies: [123] }],
      [rad, 'GET', '/patients/x'], [rad, 'PATCH', `/patients/${rnd}`, { birthDate: '2020-99-99' }],
      [rad, 'POST', `/patients/${rnd}/merge`, { otherId: 'bad' }], [rad, 'POST', '/patients/confirm', { ids: ['x'] }],
      [rad, 'POST', `/merge-suggestions/${rnd}/accept`, { keep: rnd }], [rad, 'POST', '/merge-suggestions/x/dismiss'],
      [rad, 'POST', '/shares/x/revoke'], [rad, 'GET', `/shares/${rnd}`], [rad, 'POST', `/studies/${rnd}/shares`, {}],
      [rad, 'POST', '/ai/draft-report', { studyId: 'x', notes: 'a' }], [rad, 'GET', '/lite/studies/x'],
      [rad, 'GET', `/lite/studies/${rnd}/img/../0`], [rad, 'GET', `/lite/studies/${rnd}/img/abc/-1`],
      [colleague, 'GET', '/public/shares/short'], [colleague, 'GET', '/public/shares/' + 'a'.repeat(200)],
      [colleague, 'POST', '/public/shares/' + 'a'.repeat(32) + '/replies', { author: 1 }],
      [colleague, 'GET', '/public/shares/' + 'a'.repeat(32) + '/lite/img/x/0'],
      [admin, 'PATCH', '/admin/users/x', {}], [admin, 'POST', '/admin/users', { email: 'a@b', fullName: 'x', role: 'god' }],
      [clinic, 'POST', '/upload/finalize', { studies: ['x'], radiologistId: 'nope' }],
      [outsider, 'POST', '/auth/login', {}], [outsider, 'POST', '/auth/login', { email: 5, password: [] }],
      [rad, 'POST', '/auth/password', { current: 'x', next: 'short' }],
    ];
    const fails = [];
    for (const [c, m, u, b] of probes) {
      const r = await c.call(m, u, b);
      if (r.status >= 500) fails.push(`${m} ${u} -> ${r.status} ${JSON.stringify(r.body).slice(0, 80)}`);
    }
    assert.deepEqual(fails, []);
  });

  await t.test('audit: a corrupt DICOM is rejected as 400, not retried as a server error', async () => {
    const buf = Buffer.alloc(300);
    buf.write('DICM', 128, 'ascii');
    const r = await rad.call('POST', '/upload/instance', buf, { raw: true, headers: { 'Content-Type': 'application/dicom' } });
    assert.equal(r.status, 400, JSON.stringify(r.body));
  });

});
