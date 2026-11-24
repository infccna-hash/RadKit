import { api } from './api.js';

/** OHIF needs WebGL2. Many clinic PCs have it disabled (old drivers, RDP, VMs). */
export function hasWebGL2() {
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2');
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
    return Boolean(gl);
  } catch {
    return false;
  }
}

/** Open OHIF when possible, otherwise the lightweight viewer. Returns 'ohif' | 'lite'. */
export async function openStudyViewer(studyId, { lite = false } = {}) {
  if (lite || !hasWebGL2()) {
    window.open(`/viewer/${studyId}`, '_blank', 'noopener');
    return 'lite';
  }
  const { url } = await api.get(`/studies/${studyId}/viewer`);
  window.open(url, '_blank', 'noopener');
  return 'ohif';
}
