import { config } from '../config.js';

export function appOrigin(req) {
  return config.publicAppUrl || `${req.protocol}://${req.get('host')}`;
}

/** OHIF runs on port 8081 of the same host unless PUBLIC_VIEWER_URL says otherwise */
export function viewerOrigin(req) {
  if (config.publicViewerUrl) return config.publicViewerUrl;
  return `${req.protocol}://${req.hostname}:8081`;
}

export function viewerUrlFor(req, studyUid) {
  return `${viewerOrigin(req)}/viewer?StudyInstanceUIDs=${encodeURIComponent(studyUid)}`;
}
