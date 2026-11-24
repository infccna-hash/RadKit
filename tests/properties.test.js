// Property-based tests: random inputs (seeded, reproducible) + invariants as the oracle.
// Replay a failure with: PROP_SEED=<seed printed below> node --test properties.test.js
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';
import { startMockOrthanc } from './mock-orthanc.js';

const SEED = Number(process.env.PROP_SEED) || (Date.now() % 1e9);
console.log(`# property seed: ${SEED}`);

/** mulberry32: small, fast, seedable PRNG */
function rng(seed) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (lo, hi) => lo + Math.floor(next() * (hi - lo + 1));
  const pick = (arr) => arr[int(0, arr.length - 1)];
  const shuffle = (arr) => {
    const a2 = [...arr];
    for (let i = a2.length - 1; i > 0; i--) {
      const j = int(0, i);
      [a2[i], a2[j]] = [a2[j], a2[i]];
    }
    return a2;
  };
  return { next, int, pick, shuffle };
}

/** A random multi-series study: interleaved insertion, random InstanceNumbers, multi-frame ultrasound */
function randomStudy(r, k) {
  const nSeries = r.int(1, 5);
  const numbers = r.shuffle([...Array(nSeries)].map((_, i) => i + 1));
  const series = numbers.map((num, i) => {
    const modality = r.pick(['CT', 'CT', 'MR', 'US']);
    const n = r.int(1, 25);
    const instNumbers = r.shuffle([...Array(n)].map((_, j) => j * r.int(1, 3) + 1));
    return {
      uid: `1.2.99.${k}.${i + 1}`,
      number: num,
      modality,
      description: `S${num}`,
      instances: instNumbers.map((inN, j) => ({
        sop: `1.2.99.${k}.${i + 1}.${j + 1}`,
        n: inN,
        frames: modality === 'US' ? r.int(1, 6) : 1,
      })),
    };
  });
  return series;
}

// ------------------------------------------------------------------------------------------------
let mock, buildManifest, deid;
before(async () => {
  mock = await startMockOrthanc(18142);
  Object.assign(process.env, {
    DATABASE_URL: process.env.TEST_DATABASE_URL || 'postgres://unused/unused',
    JWT_SECRET: 'x',
    ORTHANC_URL: 'http://127.0.0.1:18142',
    ORTHANC_USER: 'orthanc',
    ORTHANC_PASSWORD: 'secret',
  });
  ({ buildManifest } = await import('../api/src/routes/lite.js'));
  deid = await import('../api/src/lib/deid.js');
});
after(async () => {
  mock?.server.close();
  (await import('../api/src/db.js')).pool.end().catch(() => {});
});

// ------------------------------------------------------------------------------------------------
test('property: lite manifest = exactly each series’ own frames, in Orthanc order, deterministic', async () => {
  const r = rng(SEED);
  for (let k = 0; k < 150; k++) {
    const series = randomStudy(r, k);
    const patient = { PatientName: 'P^ROP', PatientID: `PR${k}`, PatientBirthDate: '19800101', PatientSex: 'M' };
    const study = { StudyInstanceUID: `1.2.99.${k}`, StudyDate: '20261101', StudyDescription: 'PROP' };
    // insert instance by instance in a random order across series (what a ZIP / parallel upload does)
    const flat = r.shuffle(series.flatMap((se) => se.instances.map((inst) => ({ se, inst }))));
    let oid;
    for (const { se, inst } of flat) oid = mock.seed({ patient, study, series: [{ ...se, instances: [inst] }] });

    const m1 = await buildManifest(oid);
    const ctx = `seed=${SEED} case=${k}`;
    assert.equal(m1.length, series.length, `${ctx}: one manifest series per DICOM series`);
    const sopOf = new Map(); // orthanc instance id -> {seriesUid, n, frames}
    for (const [iid, rec] of mock.instances) sopOf.set(iid, rec.tags);

    for (let i = 1; i < m1.length; i++) assert.ok(m1[i - 1].number <= m1[i].number, `${ctx}: series sorted by number`);
    for (const ms of m1) {
      const src = series.find((se) => se.number === ms.number);
      assert.ok(src, `${ctx}: unknown series ${ms.number}`);
      // exact multiset: every (instance, frame) of this series, once, nothing foreign
      const expected = src.instances.flatMap((inst) => [...Array(inst.frames)].map((_, f) => `${inst.sop}#${f}`)).sort();
      const got = ms.slices.map(([iid, f]) => `${sopOf.get(iid)?.SOPInstanceUID}#${f}`).sort();
      assert.deepEqual(got, expected, `${ctx}: series ${ms.number} slices`);
      for (const [iid] of ms.slices) assert.equal(sopOf.get(iid).SeriesInstanceUID, src.uid, `${ctx}: foreign slice in series ${ms.number}`);
      // order: InstanceNumber non-decreasing (real series can hold duplicates), frames of one instance
      // contiguous and ascending
      const order = ms.slices.map(([iid, f]) => [Number(sopOf.get(iid).InstanceNumber), iid, f]);
      for (let i = 1; i < order.length; i++) {
        const [a, ia, fa] = order[i - 1], [b, ib, fb] = order[i];
        assert.ok(a <= b, `${ctx}: series ${ms.number} InstanceNumber decreases at ${i}`);
        if (ia === ib) assert.equal(fb, fa + 1, `${ctx}: frames of one instance must be consecutive`);
        else assert.equal(fb, 0, `${ctx}: a new instance must start at frame 0`);
      }
    }
    const m2 = await buildManifest(oid);
    assert.deepEqual(m2, m1, `${ctx}: manifest must be deterministic`);
  }
});

// ------------------------------------------------------------------------------------------------
const FIRST = ['Mohamed', 'Mohammed', 'Fatima', 'Khalda', 'Abdelkader', 'Yacine', 'Saïda', 'Lakhdar', 'Nour', 'Zoubir'];
const LAST = ['Benali', 'Bensmail', 'Hadj Ahmed', 'Bouchareb', 'Mansouri', 'Djebbar', 'Ould Brahim', 'Laghouati'];
const CLINICAL = ['TDM', 'THORAX', 'ABDOMEN', 'IRM', 'CEREBRALE', 'SANS', 'AVEC', 'INJECTION', 'AXIAL', '1MM', 'FACE', 'PROFIL', 'ECHO', 'PELVIS', 'C+'];
// Arabic: names as technicians type them, with/without harakat, alef/ya/ta-marbuta variants, tatweel
const AR_FIRST = ['مراد', 'فاطمة', 'عبد القادر', 'خالدة', 'لخضر', 'نور الدين', 'سعيدة', 'ياسين'];
const AR_LAST = ['بن سعيد', 'بوشارب', 'منصوري', 'جبار', 'ولد إبراهيم', 'الأغواطي', 'حاج أحمد'];
const AR_CLINICAL = ['أشعة', 'صدر', 'بطن', 'مقطعية', 'تصوير', 'بالرنين'];
const arVariant = (r, w) =>
  r.pick([
    w,
    w.replace(/[أإآ]/g, 'ا'), // alef without hamza
    w.replace(/ة/g, 'ه').replace(/ي(?=\s|$)/g, 'ى'), // ta marbuta / alef maqsura swaps
    w.replace(/(.)/, '$1َ'), // a fatha on the first letter
    w.replace(/(..)/, '$1ـ'), // tatweel
  ]);
const toArabicDigits = (s) => s.replace(/\d/g, (d) => String.fromCharCode(0x660 + Number(d)));
const variant = (r, w) => r.pick([w, w.toUpperCase(), w.toLowerCase(), w.normalize('NFD').replace(/[̀-ͯ]/g, '')]);

test('property: scrubbing removes every identity token and keeps clinical words', () => {
  const r = rng(SEED + 1);
  for (let k = 0; k < 500; k++) {
    const first = r.pick(FIRST), last = r.pick(LAST);
    const id = `${r.pick(['P', 'IPP', 'X'])}${r.int(1000, 999999)}`;
    const dob = `19${r.int(30, 99)}-0${r.int(1, 9)}-${String(r.int(10, 28))}`;
    const [y, m, d] = dob.split('-');
    const tokens = deid.identifierTokens({ names: [`${last}^${first}`], ids: [id], birthDate: dob });
    const identity = [...last.split(' '), first, id, `${d}/${m}/${y}`, `${y}${m}${d}`];
    const clinical = r.shuffle(CLINICAL).slice(0, r.int(1, 4));
    const parts = r.shuffle([...clinical, ...r.shuffle(identity).slice(0, r.int(1, 3)).map((w) => variant(r, w))]);
    const text = parts.join(r.pick([' ', ' - ', '_', ' / ']));
    const ctx = `seed=${SEED} case=${k} text="${text}"`;

    assert.ok(deid.containsIdentifiers(text, tokens), `${ctx}: identity not detected`);
    const out = deid.scrub(text, tokens);
    assert.equal(deid.containsIdentifiers(out, tokens), false, `${ctx}: still identifying after scrub → "${out}"`);
    for (const c of clinical) assert.ok(out.includes(c.toUpperCase()), `${ctx}: clinical word "${c}" lost → "${out}"`);
    assert.equal(deid.scrub(out, tokens), out, `${ctx}: scrub must be idempotent`);
    // no false alarm on purely clinical text
    assert.equal(deid.containsIdentifiers(clinical.join(' '), tokens), false, `${ctx}: false positive`);
  }
});

test('regression: Arabic names are tokenised and scrubbed (reported in review)', () => {
  const t = deid.identifierTokens({ names: ['بن سعيد مراد'] });
  assert.ok(t.words.length >= 2, `no Arabic tokens: ${JSON.stringify(t)}`);
  assert.equal(deid.containsIdentifiers('TDM THORAX بن سعيد مراد', t), true);
  assert.equal(deid.containsIdentifiers(deid.scrub('TDM THORAX بن سعيد مراد', t), t), false);
  assert.ok(deid.scrub('TDM THORAX بن سعيد مراد', t).startsWith('TDM THORAX'));
  // DICOM PN with an Arabic ideographic group: both groups are identity
  const pn = deid.identifierTokens({ names: ['BENSAID^MOURAD=بن سعيد^مراد'] });
  assert.equal(deid.containsIdentifiers('scanner مراد', pn), true);
  assert.equal(deid.containsIdentifiers('scanner Mourad', pn), true);
});

test('property: Arabic identity (variants, harakat, Arabic digits) is detected and scrubbed', () => {
  const r = rng(SEED + 3);
  for (let k = 0; k < 400; k++) {
    const first = r.pick(AR_FIRST), last = r.pick(AR_LAST);
    const id = `P${r.int(1000, 99999)}`;
    const dob = `19${r.int(30, 99)}-0${r.int(1, 9)}-${String(r.int(10, 28))}`;
    const [y, m, d] = dob.split('-');
    const tokens = deid.identifierTokens({ names: [`${last} ${first}`], ids: [id], birthDate: dob });
    const nameWords = `${last} ${first}`.split(' ').filter((w) => [...w].length >= 3);
    const identity = [...nameWords.map((w) => arVariant(r, w)), r.pick([id, toArabicDigits(id)]), r.pick([`${d}/${m}/${y}`, toArabicDigits(`${d}/${m}/${y}`), toArabicDigits(`${y}/${m}/${d}`)])];
    const clinical = r.shuffle([...AR_CLINICAL, ...CLINICAL]).slice(0, r.int(1, 3));
    const text = r.shuffle([...clinical, ...r.shuffle(identity).slice(0, r.int(1, 3))]).join(' ');
    const ctx = `seed=${SEED} case=${k} text="${text}"`;
    assert.ok(deid.containsIdentifiers(text, tokens), `${ctx}: Arabic identity not detected`);
    const out = deid.scrub(text, tokens);
    assert.equal(deid.containsIdentifiers(out, tokens), false, `${ctx}: still identifying → "${out}"`);
    assert.equal(deid.scrub(out, tokens), out, `${ctx}: not idempotent`);
    assert.equal(deid.containsIdentifiers(clinical.join(' '), tokens), false, `${ctx}: false positive`);
  }
});

// ------------------------------------------------------------------------------------------------
const SIMPLE_VIEWER = fs.readFileSync(path.join(import.meta.dirname, '../infra/nginx/simple-viewer.html'), 'utf8');

/** Run the real simple-viewer.html in a DOM with a fake DICOMweb backend; return a driver */
async function openSimpleViewer(metadata) {
  const loaded = [];
  const dom = new JSDOM(SIMPLE_VIEWER, {
    url: 'http://rk.test:8081/simple-viewer?StudyInstanceUIDs=1.2.3',
    runScripts: 'dangerously',
    beforeParse(win) {
      win.fetch = async () => ({ status: 200, ok: true, json: async () => metadata });
      win.Image = class {
        set src(v) {
          loaded.push(v);
        }
      };
    },
  });
  for (let i = 0; i < 5; i++) await new Promise((res) => setTimeout(res, 0)); // let fetch().then() chain run
  const doc = dom.window.document;
  const key = (k) => doc.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: k }));
  return { dom, doc, loaded, key };
}

function dicomJson(series) {
  // flat instance list, shuffled across series: what /metadata may return
  return series.flatMap((se) =>
    se.instances.map((inst) => ({
      '00100010': { Value: [{ Alphabetic: 'TEST^PATIENT' }] },
      '0020000E': { Value: [se.uid] },
      '00080018': { Value: [inst.sop] },
      '00200013': { Value: [inst.n] },
      '00200011': { Value: [se.number] },
      '00080060': { Value: [se.modality] },
      '0008103E': { Value: [se.description] },
    }))
  );
}

test('property: simple viewer never mixes series and walks each stack in InstanceNumber order', async () => {
  const r = rng(SEED + 2);
  for (let k = 0; k < 60; k++) {
    const series = randomStudy(r, k).map((se) => ({ ...se, instances: se.instances.map((i) => ({ ...i, frames: 1 })) }));
    const { doc, loaded, key, dom } = await openSimpleViewer(r.shuffle(dicomJson(series)));
    const ctx = `seed=${SEED} case=${k}`;
    const sel = doc.getElementById('series');
    assert.equal(sel.options.length, series.length, `${ctx}: one option per series`);
    const largest = Math.max(...series.map((s) => s.instances.length));
    const selected = () => series.find((s) => s.uid === loaded.at(-1).split('/series/')[1].split('/')[0]);
    assert.equal(selected().instances.length, largest, `${ctx}: starts on the largest series`);

    for (let o = 0; o < sel.options.length; o++) {
      sel.value = String(o);
      sel.dispatchEvent(new dom.window.Event('change'));
      const se = selected();
      for (let i = 0; i < 40; i++) key('ArrowLeft'); // to the first image
      const start = loaded.length - 1;
      for (let i = 0; i < se.instances.length + 3; i++) key('ArrowRight'); // past the end: must clamp
      const walk = [...new Set(loaded.slice(start))];
      const sops = walk.map((u) => decodeURIComponent(u.split('/instances/')[1].split('/')[0]));
      // each image of the series exactly once, InstanceNumber never decreasing (ties: any order)
      assert.deepEqual([...sops].sort(), se.instances.map((i) => i.sop).sort(), `${ctx}: series ${se.number} walk covers its images once`);
      const nOf = new Map(se.instances.map((i) => [i.sop, i.n]));
      for (let i = 1; i < sops.length; i++)
        assert.ok(nOf.get(sops[i - 1]) <= nOf.get(sops[i]), `${ctx}: series ${se.number} InstanceNumber decreases at ${i}`);
      assert.ok(walk.every((u) => u.includes(`/series/${encodeURIComponent(se.uid)}/`)), `${ctx}: walked out of series ${se.number}`);
      assert.equal(doc.getElementById('count').textContent, `${se.instances.length} / ${se.instances.length}`, `${ctx}: counter`);
    }
    dom.window.close();
  }
});
