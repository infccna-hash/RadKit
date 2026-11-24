import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Search, FolderClock } from 'lucide-react';
import { api } from '../../lib/api.js';
import { fmtDate } from '../../lib/format.js';
import { useLoad, PageHeader, PageLoader, Empty, StatusBadge, ModalityChips } from '../../components/ui.jsx';

export default function ClientHistory() {
  const { data, loading } = useLoad(() => api.get('/client/history'), []);
  const [q, setQ] = useState('');
  const patients = (data?.patients || []).filter(
    (p) => !q || p.patientName.toLowerCase().includes(q.toLowerCase()) || (p.patientId || '').toLowerCase().includes(q.toLowerCase())
  );

  return (
    <>
      <PageHeader title="Historique patients" subtitle="Tous les examens envoyés, regroupés par patient." />
      <div className="relative mb-4 md:w-72">
        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-ink-mute" />
        <input className="input pl-8" placeholder="Nom ou identifiant" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {loading && !data ? (
        <PageLoader />
      ) : !patients.length ? (
        <div className="card"><Empty icon={FolderClock} title="Aucun historique" /></div>
      ) : (
        <div className="space-y-3">
          {patients.map((p) => (
            <details key={p.key} className="card group" open={patients.length <= 3}>
              <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3">
                <span className="font-medium">{p.patientName}</span>
                <span className="mono text-ink-mute">{p.patientId}</span>
                {p.birthDate && <span className="text-xs text-ink-mute">né(e) le {fmtDate(p.birthDate)}</span>}
                <span className="ml-auto text-sm text-ink-mute">{p.studies.length} examen(s)</span>
              </summary>
              <ul className="border-t border-paper-line">
                {p.studies.map((s) => (
                  <li key={s.id}>
                    <Link to={`/client/studies/${s.id}`} className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-sm hover:bg-paper/60">
                      <span className="mono w-24 text-ink-mute">{fmtDate(s.study_date)}</span>
                      <ModalityChips modalities={s.modalities} />
                      <span className="flex-1">{s.description}</span>
                      {s.conclusion && <span className="hidden max-w-xs truncate text-xs text-ink-soft md:inline">{s.conclusion}</span>}
                      <StatusBadge status={s.status} />
                    </Link>
                  </li>
                ))}
              </ul>
            </details>
          ))}
        </div>
      )}
    </>
  );
}
