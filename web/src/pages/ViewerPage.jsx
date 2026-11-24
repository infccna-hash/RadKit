import { useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../lib/api.js';
import { PageLoader } from '../components/ui.jsx';
import LiteViewer from '../components/LiteViewer.jsx';
import { useAuth } from '../lib/auth.jsx';

export function StudyViewerPage() {
  const { id } = useParams();
  const nav = useNavigate();
  const { user } = useAuth();
  const back = { radiologist: `/app/studies/${id}`, client: `/client/studies/${id}` }[user?.role] || '/';
  return (
    <LiteViewer
      manifestUrl={`/lite/studies/${id}`}
      imageBase={`/api/lite/studies/${id}/img`}
      onBack={() => nav(back)}
      backLabel="Retour à l'examen"
    />
  );
}

export function ShareViewerPage() {
  const { token } = useParams();
  const nav = useNavigate();
  return (
    <LiteViewer
      manifestUrl={`/public/shares/${token}/lite`}
      imageBase={`/api/public/shares/${token}/lite/img`}
      onBack={() => nav(`/s/${token}`)}
      backLabel="Retour au cas"
    />
  );
}

/** Entry from OHIF when the browser has no WebGL: OHIF only knows the StudyInstanceUID */
export function ResolveViewerPage() {
  const { uid } = useParams();
  const nav = useNavigate();
  useEffect(() => {
    api
      .get(`/lite/resolve/${encodeURIComponent(uid)}`)
      .then(({ studyId }) => nav(`/viewer/${studyId}`, { replace: true }))
      // not logged in (e.g. opened through a share link): server-rendered preview, gated by the share cookie
      .catch(() => window.location.replace(`/simple-viewer?StudyInstanceUIDs=${encodeURIComponent(uid)}`));
  }, [uid, nav]);
  return <PageLoader />;
}
