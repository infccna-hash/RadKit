import { Readable, Transform, pipeline } from 'node:stream';

/** Stream an upstream fetch body to the client. Errors on either side close both (no hung downloads, no crash). */
export function streamTo(res, webBody, { zip = false } = {}) {
  const stages = [Readable.fromWeb(webBody)];
  if (zip) stages.push(zipGuard());
  pipeline(...stages, res, (err) => {
    if (err && err.code !== 'ERR_STREAM_PREMATURE_CLOSE') console.warn('stream aborted:', err.message);
  });
}

/**
 * Every ZIP ends with an End-Of-Central-Directory record (PK\x05\x06, 22 bytes, no comment in Orthanc archives).
 * If the upstream stops without it, fail the stream: the client gets a broken transfer, never a clean 200 + bad file.
 */
export function zipGuard() {
  let tail = Buffer.alloc(0);
  return new Transform({
    transform(chunk, _enc, cb) {
      tail = chunk.length >= 22 ? Buffer.from(chunk.subarray(chunk.length - 22)) : Buffer.concat([tail, chunk]).subarray(-22);
      cb(null, chunk);
    },
    flush(cb) {
      if (tail.length === 22 && tail.readUInt32LE(0) === 0x06054b50) cb();
      else cb(new Error('archive ZIP incomplète (fin de fichier absente)'));
    },
  });
}

export class HttpError extends Error {
  constructor(status, message, extra) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

export const bad = (msg, extra) => new HttpError(400, msg, extra);
export const forbidden = (msg = 'Accès refusé') => new HttpError(403, msg);
export const notFound = (msg = 'Introuvable') => new HttpError(404, msg);

/** Wrap async route handlers so thrown errors reach the error middleware */
export const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

export function str(v, { max = 2000, required = false, name = 'champ' } = {}) {
  if (v === undefined || v === null || v === '') {
    if (required) throw bad(`${name} requis`);
    return null;
  }
  if (typeof v !== 'string') throw bad(`${name} invalide`);
  const t = v.trim();
  if (t.length > max) throw bad(`${name} trop long`);
  if (required && !t) throw bad(`${name} requis`);
  return t;
}

export function oneOf(v, allowed, name = 'valeur') {
  if (!allowed.includes(v)) throw bad(`${name} invalide`);
  return v;
}

export const isUuid = (v) =>
  typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

export function uuid(v, name = 'id') {
  if (!isUuid(v)) throw bad(`${name} invalide`);
  return v;
}
