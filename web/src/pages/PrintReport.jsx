import { useParams } from 'react-router-dom';
import { Printer } from 'lucide-react';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { fmtDate, fmtDateTime, age, sexLabel } from '../lib/format.js';
import { useLoad, PageLoader, ErrorNote } from '../components/ui.jsx';

export default function PrintReport() {
  const { id } = useParams();
  const { user } = useAuth();
  const { data, error, loading } = useLoad(() => api.get(`/studies/${id}`), [id]);
  if (loading && !data) return <PageLoader />;
  if (error) return <ErrorNote error={error} />;
  const { study: s, report } = data;
  if (!report) return <p className="p-10 text-center text-ink-mute">Aucun compte rendu.</p>;
  const signer = user.role === 'radiologist' ? user : data.radiologist ? { fullName: data.radiologist.full_name, organization: data.radiologist.organization } : null;
  const patientName = data.patient?.full_name || s.dicom_patient_name;

  return (
    <div className="min-h-screen bg-white">
      <div className="no-print flex justify-end gap-2 border-b border-paper-line px-6 py-3">
        {report.status !== 'final' && <span className="mr-auto self-center text-sm text-amber-700">Brouillon — non validé</span>}
        <button className="btn-primary" onClick={() => window.print()}><Printer className="h-4 w-4" /> Imprimer / PDF</button>
      </div>
      <article className="mx-auto max-w-[720px] px-10 py-12 text-[14px] leading-relaxed text-black">
        <header className="flex items-start justify-between border-b-2 border-black pb-4">
          <div>
            <p className="text-lg font-semibold">{signer?.fullName}</p>
            <p className="text-sm">{signer?.organization || 'Radiologie'}</p>
          </div>
          <div className="text-right text-sm">
            <p>{fmtDate(report.finalized_at || report.updated_at)}</p>
          </div>
        </header>

        <section className="mt-6 grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
          <p><b>Patient :</b> {patientName}</p>
          <p><b>Né(e) le :</b> {fmtDate(s.dicom_birth_date)} {age(s.dicom_birth_date, s.study_date) != null && `(${age(s.dicom_birth_date, s.study_date)} ans)`}</p>
          <p><b>Sexe :</b> {sexLabel(s.dicom_sex)}</p>
          <p><b>Date de l'examen :</b> {fmtDate(s.study_date)}</p>
          {s.referring && <p><b>Prescripteur :</b> {s.referring}</p>}
          {s.accession && <p><b>N° :</b> {s.accession}</p>}
        </section>

        <h1 className="mt-8 text-center text-base font-bold uppercase tracking-wide">{report.title || s.description || 'Compte rendu'}</h1>

        {[['Indication', report.indication], ['Technique', report.technique], ['Résultats', report.findings], ['Conclusion', report.conclusion]].map(([l, v]) => v && (
          <section key={l} className="mt-5">
            <h2 className="font-bold underline">{l}</h2>
            <p className={`mt-1 whitespace-pre-wrap ${l === 'Conclusion' ? 'font-semibold' : ''}`}>{v}</p>
          </section>
        ))}

        {report.status === 'final' && (
          <footer className="mt-12 text-right text-sm">
            <p>Validé électroniquement le {fmtDateTime(report.finalized_at)}</p>
            <p className="mt-6 font-semibold">{signer?.fullName}</p>
          </footer>
        )}

        {report.patient_summary && (
          <section className="mt-10 break-before-page rounded border border-black/20 p-4">
            <h2 className="font-bold">Explication pour le patient</h2>
            <p dir="auto" className="mt-2 whitespace-pre-wrap">{report.patient_summary}</p>
          </section>
        )}
      </article>
    </div>
  );
}
