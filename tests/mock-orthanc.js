// Minimal in-memory Orthanc stand-in implementing the REST endpoints RadKit uses.
import express from 'express';
import crypto from 'node:crypto';
import dicomParser from 'dicom-parser';
import zlib from 'node:zlib';

function png(width, height, gray) {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 0;
  const raw = Buffer.alloc((width + 1) * height);
  for (let y = 0; y < height; y++) gray.copy(raw, y * (width + 1) + 1, y * width, (y + 1) * width);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

function phantomPng(n, c, w, shift) {
  const g = Buffer.alloc(n * n);
  const lo = c - w / 2;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const d = (cx, cy, rx, ry = rx) => ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 < 1;
    let hu = -1000;
    if (d(128, 128, 110, 90)) hu = 40;
    if (d(88, 120, 32 - shift / 3, 48) || d(168, 120, 32 - shift / 3, 48)) hu = -820;
    if (d(128, 190, 14)) hu = 700;
    if (d(128, 120, 10 + shift / 2)) hu = 60;
    g[y * n + x] = Math.max(0, Math.min(255, Math.round(((hu - lo) / w) * 255)));
  }
  return png(n, n, g);
}

const sha = (s) => crypto.createHash('sha1').update(s).digest('hex').replace(/(.{8})(.{8})(.{8})(.{8})(.{8})/, '$1-$2-$3-$4-$5');

export function startMockOrthanc(port) {
  const instances = new Map(); // id -> {tags, studyId, seriesId}
  const studies = new Map(); // id -> {main, patient, series:Set}
  const series = new Map(); // id -> {main, studyId, instances:Set, shared}
  const state = { lastRendered: null, anonDelay: 0, anonFail: false, archive: 'ok', archiveJobs: true };

  const app = express();
  app.use((req, res, next) => {
    if (req.get('Authorization') !== 'Basic ' + Buffer.from('orthanc:secret').toString('base64')) return res.sendStatus(401);
    next();
  });
  app.get('/system', (_q, res) => res.json({ Name: 'mock', Version: '0' }));

  function store(tags) {
    const studyId = sha(tags.PatientID + '|' + tags.StudyInstanceUID);
    const seriesId = sha(tags.SeriesInstanceUID);
    const instId = sha(tags.SOPInstanceUID);
    if (!studies.has(studyId))
      studies.set(studyId, {
        main: {
          StudyInstanceUID: tags.StudyInstanceUID, StudyDate: tags.StudyDate, StudyDescription: tags.StudyDescription,
          InstitutionName: tags.InstitutionName, AccessionNumber: tags.AccessionNumber || '',
        },
        patient: { PatientName: tags.PatientName, PatientID: tags.PatientID, PatientBirthDate: tags.PatientBirthDate, PatientSex: tags.PatientSex },
        series: new Set(),
      });
    if (!series.has(seriesId))
      series.set(seriesId, { main: { Modality: tags.Modality, SeriesInstanceUID: tags.SeriesInstanceUID }, studyId, instances: new Set(), shared: tags.BurnedInAnnotation ? { BurnedInAnnotation: tags.BurnedInAnnotation } : {} });
    studies.get(studyId).series.add(seriesId);
    series.get(seriesId).instances.add(instId);
    instances.set(instId, { tags, studyId, seriesId });
    return { ID: instId, ParentStudy: studyId, ParentSeries: seriesId, Status: 'Success' };
  }

  app.post('/instances', express.raw({ type: () => true, limit: '50mb' }), (req, res) => {
    let ds;
    try {
      ds = dicomParser.parseDicom(new Uint8Array(req.body));
    } catch {
      return res.status(400).json({ Message: 'Bad file format' }); // what real Orthanc does
    }
    const t = (tag) => ds.string(tag) || '';
    res.json(store({
      PatientName: t('x00100010'), PatientID: t('x00100020'), PatientBirthDate: t('x00100030'), PatientSex: t('x00100040'),
      StudyInstanceUID: t('x0020000d'), SeriesInstanceUID: t('x0020000e'), SOPInstanceUID: t('x00080018'),
      StudyDate: t('x00080020'), StudyDescription: t('x00081030'), InstitutionName: t('x00080080'), Modality: t('x00080060'),
      BurnedInAnnotation: t('x00280301'),
    }));
  });

  app.get('/studies/:id', (req, res) => {
    const s = studies.get(req.params.id);
    if (!s) return res.sendStatus(404);
    res.json({ ID: req.params.id, MainDicomTags: s.main, PatientMainDicomTags: s.patient, Series: [...s.series] });
  });
  app.get('/studies/:id/series', (req, res) => {
    const s = studies.get(req.params.id);
    if (!s) return res.sendStatus(404);
    res.json([...s.series].map((id) => ({ ID: id, MainDicomTags: series.get(id).main, Instances: [...series.get(id).instances] })));
  });
  app.get('/series/:id/shared-tags', (req, res) => res.json(series.get(req.params.id)?.shared || {}));

  app.get('/series/:id/ordered-slices', (req, res) => {
    const se = series.get(req.params.id);
    if (!se) return res.sendStatus(404);
    const ids = [...se.instances];
    res.json({ Type: 'Volume', Slices: ids.map((i) => `/instances/${i}/frames/0`), SlicesShort: ids.map((i) => [i, 0, 1]) });
  });
  app.get('/instances/:id/study', (req, res) => {
    const i = instances.get(req.params.id);
    if (!i) return res.sendStatus(404);
    res.json({ ID: i.studyId });
  });
  app.get('/instances/:id/simplified-tags', (req, res) => {
    const i = instances.get(req.params.id);
    if (!i) return res.sendStatus(404);
    const ct = i.tags.Modality === 'CT';
    res.json({
      Modality: i.tags.Modality,
      ...(ct ? { WindowCenter: '40\\60', WindowWidth: '80\\400' } : {}),
      PixelSpacing: '0.7\\0.7', Rows: '256', Columns: '256', BitsStored: '16', SeriesNumber: '1',
      PhotometricInterpretation: ct ? 'MONOCHROME2' : 'RGB',
    });
  });
  // Renders a synthetic CT-like phantom (in HU) with the requested window, as PNG
  app.get('/instances/:id/frames/:f/rendered', (req, res) => {
    if (!instances.has(req.params.id)) return res.sendStatus(404);
    state.lastRendered = req.query;
    const c = Number(req.query['window-center'] ?? 40), w = Number(req.query['window-width'] ?? 400);
    const shift = parseInt(req.params.id.slice(0, 2), 16) % 20;
    res.type('image/png').send(phantomPng(256, c, w, shift));
  });
  app.post('/tools/lookup', express.text({ type: () => true }), (req, res) => {
    const hit = [...studies.entries()].find(([, s]) => s.main.StudyInstanceUID === req.body.trim());
    res.json(hit ? [{ ID: hit[0], Type: 'Study' }] : []);
  });
  const jobs = new Map();
  app.post('/studies/:id/anonymize', express.json(), (req, res) => {
    if (!studies.has(req.params.id)) return res.sendStatus(404);
    if (req.body.Asynchronous) {
      const jid = crypto.randomUUID();
      jobs.set(jid, { State: 'Running' });
      setTimeout(() => {
        if (state.anonFail) return jobs.set(jid, { State: 'Failure', ErrorDescription: 'mock failure' });
        const out = anonymize(req.params.id, req.body);
        jobs.set(jid, { State: 'Success', Content: { ID: out.ID, Type: 'Study', PatientID: out.PatientID } });
      }, state.anonDelay || 0);
      return res.json({ ID: jid, Path: `/jobs/${jid}` });
    }
    res.json(anonymize(req.params.id, req.body));
  });
  app.get('/jobs/:id', (req, res) => (jobs.has(req.params.id) ? res.json(jobs.get(req.params.id)) : res.sendStatus(404)));
  function anonymize(id, body) {
    const s = studies.get(id);
    const req = { body };
    const newUid = '2.25.' + BigInt('0x' + crypto.randomBytes(12).toString('hex')).toString();
    let out;
    for (const seId of s.series) {
      const se = series.get(seId);
      const newSeries = '2.25.' + BigInt('0x' + crypto.randomBytes(12).toString('hex')).toString();
      for (const iId of se.instances) {
        const tg = instances.get(iId).tags;
        out = store({ ...tg, PatientName: 'ANONYME', PatientID: req.body.Replace.PatientID, PatientBirthDate: '', InstitutionName: '',
          StudyInstanceUID: newUid, SeriesInstanceUID: newSeries, SOPInstanceUID: tg.SOPInstanceUID + '.9' });
      }
    }
    return { ID: out.ParentStudy, Type: 'Study', PatientID: req.body.Replace.PatientID };
  }
  app.delete('/studies/:id', (req, res) => {
    const s = studies.get(req.params.id);
    if (!s) return res.sendStatus(404);
    for (const seId of s.series) {
      for (const i of series.get(seId).instances) instances.delete(i);
      series.delete(seId);
    }
    studies.delete(req.params.id);
    res.json({});
  });
  // A small but valid ZIP: one stored file + central directory + EOCD
  function zipFor(id) {
    const name = Buffer.from(`${id}.dcm`);
    const data = Buffer.alloc(20000, 7);
    const crc = zlib.crc32(data) >>> 0;
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(name.length, 26);
    const cd = Buffer.alloc(46); cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE(20, 4); cd.writeUInt16LE(20, 6); cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(data.length, 20); cd.writeUInt32LE(data.length, 24); cd.writeUInt16LE(name.length, 28);
    const cdOff = 30 + name.length + data.length;
    const eocd = Buffer.alloc(22); eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(1, 8); eocd.writeUInt16LE(1, 10);
    eocd.writeUInt32LE(46 + name.length, 12); eocd.writeUInt32LE(cdOff, 16);
    return Buffer.concat([lh, name, data, cd, name, eocd]);
  }
  /** Close-delimited body (no Content-Length, no chunking) cut cleanly: exactly what real Orthanc did in the field */
  function sendTruncatedClean(req, buf) {
    req.socket.write('HTTP/1.1 200 OK\r\nContent-Type: application/zip\r\nConnection: close\r\n\r\n');
    req.socket.end(buf.subarray(0, Math.floor(buf.length / 3)));
  }

  const archiveJobs = new Map();
  app.post('/studies/:id/archive', express.json(), (req, res) => {
    if (!studies.has(req.params.id)) return res.sendStatus(404);
    if (!state.archiveJobs) return res.status(400).json({ Message: 'Asynchronous archives not supported' });
    const jid = crypto.randomUUID();
    archiveJobs.set(jid, req.params.id);
    jobs.set(jid, { State: 'Success', Content: {} });
    res.json({ ID: jid, Path: `/jobs/${jid}` });
  });
  app.get('/jobs/:id/archive', (req, res) => {
    const sid = archiveJobs.get(req.params.id);
    if (!sid) return res.sendStatus(404);
    const buf = zipFor(sid);
    if (state.archive === 'truncate-clean') return sendTruncatedClean(req, buf);
    if (state.archive === 'short-length') {
      res.writeHead(200, { 'Content-Type': 'application/zip', 'Content-Length': String(buf.length) });
      res.write(buf.subarray(0, 1000));
      return setTimeout(() => res.socket.destroy(), 30);
    }
    res.writeHead(200, { 'Content-Type': 'application/zip', 'Content-Length': String(buf.length) });
    res.end(buf);
  });

  app.get('/studies/:id/archive', (req, res) => {
    if (!studies.has(req.params.id)) return res.sendStatus(404);
    if (state.breakArchive) {
      // send part of the body then kill the connection, like Orthanc dying mid-download
      res.writeHead(200, { 'Content-Type': 'application/zip', 'Content-Length': '100000' });
      res.write(Buffer.alloc(1000));
      return setTimeout(() => res.socket.destroy(), 50);
    }
    const buf = zipFor(req.params.id);
    if (state.archive === 'truncate-clean') return sendTruncatedClean(req, buf);
    res.type('application/zip').send(buf);
  });

  return new Promise((resolve) => {
    const server = app.listen(port, () => resolve({ server, studies, state }));
  });
}
