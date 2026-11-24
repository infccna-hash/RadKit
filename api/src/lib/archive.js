import { orthanc } from './orthanc.js';
import { HttpError, streamTo } from './http.js';

/**
 * Serve an Orthanc study as ZIP.
 * Preferred: async Orthanc job → file with Content-Length. Fallback (older Orthanc): direct stream.
 * Both go through the ZIP integrity guard.
 */
export async function sendArchive(res, orthancId, filename) {
  let up = null;
  try {
    up = await orthanc.archiveViaJob(orthancId);
  } catch (e) {
    if (e.status === 404) throw new HttpError(404, 'Étude introuvable sur le serveur d\'images');
    console.warn('archive job unavailable, falling back to direct stream:', e.message);
  }
  if (!up || !up.ok) up = await orthanc.archive(orthancId);
  if (!up.ok) throw new HttpError(502, 'Archive indisponible');
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  const len = up.headers.get('content-length');
  if (len && /^\d+$/.test(len)) res.setHeader('Content-Length', len);
  streamTo(res, up.body, { zip: true });
}
