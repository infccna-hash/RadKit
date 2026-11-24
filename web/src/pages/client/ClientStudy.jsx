import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Eye, Download, Printer, Clock } from 'lucide-react';
import { api } from '../../lib/api.js';
import { openStudyViewer } from '../../lib/viewer.js';
import { fmtDate, fmtDateTime } from '../../lib/format.js';
import { useLoad, PageLoader, ErrorNote, StatusBadge, ModalityChips, useToast } from '../../components/ui.jsx';

export default function ClientStudy() {
  const { id } = useParams();
  const toast = useToast();
  const { data, error, loading } = useLoad(() => api.get(`/studies/${id}`), [id]);
  if (loading && !data) return <PageLoader />;
  if (error) return <ErrorNote error={error} />;
  const { study: s, report, radiologist } = data;

  async function viewer() {
    try {
      await openStudyViewer(s.id);
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  return (
    <>
      <Link to="/client" className="mb-4 inline-flex items-center gap-1 text-sm text-ink-mute hover:text-ink"><ArrowLeft className="h-4 w-4" /> Mes examens</Link>
      <div className="mb-6 flex flex-wrap items-start gap-4">
        <div className="flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <ModalityChips modalities={s.modalities} />
            <h1 className="text-xl font-semibold">{s.description || 'Examen'}</h1>
            <StatusBadge status={s.status} />
          </div>
          <p className="mt-1 text-sm text-ink-mute">{s.dicom_patient_name} · {fmtDate(s.study_date)} · envoyé à {radiologist?.full_name}</p>
        </div>
        <div className="flex gap-2">
          <button className="btn-outline" onClick={viewer}><Eye className="h-4 w-4" /> Images</button>
          <a className="btn-outline" href={`/api/studies/${s.id}/download`}><Download className="h-4 w-4" /></a>
        </div>
      </div>

      {report ? (
        <article className="card p-6">
          <div className="mb-4 flex items-center gap-2">
            <h2 className="font-semibold">Compte rendu</h2>
            <span className="text-xs text-ink-mute">validé le {fmtDateTime(report.finalized_at)}</span>
            <Link to={`/print/${s.id}`} target="_blank" className="btn-primary ml-auto py-1.5"><Printer className="h-4 w-4" /> Imprimer</Link>
          </div>
          {[['Indication', report.indication], ['Technique', report.technique], ['Résultats', report.findings], ['Conclusion', report.conclusion]].map(
            ([l, v]) => v && (
              <section key={l} className="mb-4">
                <h3 className="label">{l}</h3>
                <p className={`whitespace-pre-wrap text-sm leading-relaxed ${l === 'Conclusion' ? 'font-medium' : ''}`}>{v}</p>
              </section>
            )
          )}
          {report.patient_summary && (
            <section className="mt-4 rounded-lg bg-paper p-4">
              <h3 className="label">Pour le patient</h3>
              <p dir="auto" className="whitespace-pre-wrap text-sm">{report.patient_summary}</p>
            </section>
          )}
        </article>
      ) : (
        <div className="card flex items-center gap-3 p-6 text-sm text-ink-soft">
          <Clock className="h-5 w-5 text-ink-mute" /> Le compte rendu apparaîtra ici dès qu'il sera validé par le radiologue.
        </div>
      )}
      {s.clinical_info && (
        <p className="mt-4 text-sm text-ink-mute"><b>Renseignements envoyés :</b> {s.clinical_info}</p>
      )}
    </>
  );
}
