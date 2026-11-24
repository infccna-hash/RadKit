import { Readable, Transform, pipeline } from 'node:stream';

/** Stream an upstream fetch body to the client. Errors on either side close both (no hung downloads, no crash). */
export function streamTo(res, webBody, { zip = false } = {}) {
  const stages = [Readable.fromWeb(webBody)];
  if (zip) stages.push(zipGuard());
  pipeline(...stages, res, (err) => {
    if (err && err.code !== 'ERR_STREAM_PREMATURE_CLOSE') console.warn('stream aborted:', err.message);
  });
}

const EOCD_SIG = 0x06054b50;
const EOCD_LEN = 22;
const MAX_TAIL = EOCD_LEN + 0xffff; // EOCD + the longest possible archive comment

/**
 * True if `tail` (the last bytes of a stream) ends with a structurally valid End-Of-Central-Directory record:
 * signature PK\x05\x06, followed by exactly the comment length it declares. Orthanc writes a comment
 * ("Created by Orthanc"), so the record is NOT necessarily the last 22 bytes.
 */
export function hasValidZipEnd(tail) {
  for (let i = tail.length - EOCD_LEN; i >= 0 && i >= tail.length - MAX_TAIL; i--) {
    if (tail.readUInt32LE(i) === EOCD_SIG && i + EOCD_LEN + tail.readUInt16LE(i + 20) === tail.length) return true;
  }
  return false;
}

/**
 * Fail the stream if the upstream stops before the end of the ZIP: the client gets a broken transfer,
 * never a clean 200 with a truncated file. Keeps only the last 64 KiB in memory, without copying per chunk.
 */
export function zipGuard() {
  let parts = [];
  let len = 0;
  return new Transform({
    transform(chunk, _enc, cb) {
      parts.push(chunk);
      len += chunk.length;
      while (parts.length > 1 && len - parts[0].length >= MAX_TAIL) len -= parts.shift().length;
      cb(null, chunk);
    },
    flush(cb) {
      const buf = Buffer.concat(parts, len);
      parts = [];
      if (hasValidZipEnd(buf.length > MAX_TAIL ? buf.subarray(buf.length - MAX_TAIL) : buf)) cb();
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
