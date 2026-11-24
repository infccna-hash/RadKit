import { useNavigate, useParams } from 'react-router-dom';
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
