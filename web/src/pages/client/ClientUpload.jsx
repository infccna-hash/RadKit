import { useEffect, useState } from 'react';
import { api } from '../../lib/api.js';
import { useLoad, PageHeader, PageLoader, Field, Empty } from '../../components/ui.jsx';
import UploadPanel from '../../components/UploadPanel.jsx';
import { UserX } from 'lucide-react';

export default function ClientUpload() {
  const rads = useLoad(() => api.get('/my-radiologists'), []);
  const [radiologistId, setRadiologistId] = useState('');
  const [clinicalInfo, setClinicalInfo] = useState('');
  const [priority, setPriority] = useState('normal');

  useEffect(() => {
    if (rads.data?.radiologists.length === 1) setRadiologistId(rads.data.radiologists[0].id);
  }, [rads.data]);

  if (rads.loading && !rads.data) return <PageLoader />;
  if (!rads.data?.radiologists.length)
    return (
      <div className="card">
        <Empty icon={UserX} title="Aucun radiologue rattaché">Demandez à votre radiologue de vous ajouter depuis son espace RadKit.</Empty>
      </div>
    );

  return (
    <>
      <PageHeader title="Envoyer un examen" subtitle="Les informations patient sont lues directement dans les fichiers DICOM : rien à ressaisir." />
      <UploadPanel
        studyLink={(id) => `/client/studies/${id}`}
        extra={() => {
          if (!radiologistId) throw new Error('Choisissez le radiologue destinataire');
          return { radiologistId, clinicalInfo, priority };
        }}
        renderFields={(busy) => (
          <div className="grid gap-3 md:grid-cols-[1fr_160px]">
            <Field label="Radiologue">
              <select className="input" disabled={busy} value={radiologistId} onChange={(e) => setRadiologistId(e.target.value)}>
                <option value="">Choisir…</option>
                {rads.data.radiologists.map((r) => (
                  <option key={r.id} value={r.id}>{r.full_name}{r.organization ? ` — ${r.organization}` : ''}</option>
                ))}
              </select>
            </Field>
            <Field label="Priorité">
              <select className="input" disabled={busy} value={priority} onChange={(e) => setPriority(e.target.value)}>
                <option value="normal">Normale</option>
                <option value="urgent">Urgente</option>
                <option value="low">Faible</option>
              </select>
            </Field>
            <div className="md:col-span-2">
              <Field label="Renseignements cliniques">
                <textarea rows={3} className="input" disabled={busy} placeholder="Motif, antécédents, question posée…" value={clinicalInfo} onChange={(e) => setClinicalInfo(e.target.value)} />
              </Field>
            </div>
          </div>
        )}
      />
    </>
  );
}
