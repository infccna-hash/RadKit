import { Link, useNavigate } from 'react-router-dom';
import { Upload, Inbox, FileCheck2 } from 'lucide-react';
import { api } from '../../lib/api.js';
import { fmtDate, ago } from '../../lib/format.js';
import { useLoad, PageHeader, PageLoader, Empty, StatusBadge, PriorityBadge, ModalityChips } from '../../components/ui.jsx';

export default function ClientHome() {
  const nav = useNavigate();
  const { data, loading } = useLoad(() => api.get('/studies'), []);
  const studies = data?.studies || [];
  const waiting = studies.filter((s) => s.status !== 'reported').length;
  const ready = studies.filter((s) => s.status === 'reported' && Date.now() - new Date(s.reported_at) < 7 * 864e5).length;

  return (
    <>
      <PageHeader
        title="Mes examens"
        subtitle="Suivez vos envois et récupérez les comptes rendus."
        actions={<Link to="/client/upload" className="btn-primary"><Upload className="h-4 w-4" /> Envoyer un examen</Link>}
      />
      <div className="mb-6 grid grid-cols-2 gap-3 md:w-[420px]">
        <div className="card px-4 py-3"><p className="text-xs text-ink-mute">En attente d'interprétation</p><p className="mt-1 text-2xl font-semibold tabular-nums">{waiting}</p></div>
        <div className="card px-4 py-3"><p className="text-xs text-ink-mute">Comptes rendus (7 j)</p><p className="mt-1 text-2xl font-semibold tabular-nums text-emerald-700">{ready}</p></div>
      </div>
      <div className="card">
        {loading && !data ? (
          <PageLoader />
        ) : !studies.length ? (
          <Empty icon={Inbox} title="Aucun examen envoyé">Envoyez votre premier examen : un dossier, un CD ou une archive ZIP.</Empty>
        ) : (
          <ul>
            {studies.map((s) => (
              <li key={s.id} onClick={() => nav(`/client/studies/${s.id}`)} className="flex cursor-pointer flex-wrap items-center gap-3 border-b border-paper-line/70 px-4 py-3 last:border-0 hover:bg-paper/60">
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{s.dicom_patient_name || 'Sans nom'}</p>
                  <p className="flex items-center gap-2 text-xs text-ink-mute">
                    <ModalityChips modalities={s.modalities} /> {s.description} · {fmtDate(s.study_date)}
                  </p>
                </div>
                <span className="text-xs text-ink-mute">envoyé {ago(s.created_at)}</span>
                <PriorityBadge priority={s.priority} />
                {s.status === 'reported' ? (
                  <span className="flex items-center gap-1 text-sm font-medium text-emerald-700"><FileCheck2 className="h-4 w-4" /> Compte rendu</span>
                ) : (
                  <StatusBadge status={s.status} />
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
