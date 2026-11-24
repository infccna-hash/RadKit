import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Share2, Ban, MessageSquare, Eye } from 'lucide-react';
import { api } from '../../lib/api.js';
import { fmtDate, fmtDateTime, ago } from '../../lib/format.js';
import { useLoad, PageHeader, PageLoader, Empty, ModalityChips, useToast, ShareStatus } from '../../components/ui.jsx';

export default function Shares() {
  const toast = useToast();
  const { data, loading, reload } = useLoad(() => api.get('/shares'), []);
  const preparing = data?.shares.some((s) => s.status === 'preparing' && !s.revoked_at);
  useEffect(() => {
    if (!preparing) return;
    const t = setInterval(reload, 3000);
    return () => clearInterval(t);
  }, [preparing, reload]);

  async function revoke(sh) {
    try {
      await api.post(`/shares/${sh.id}/revoke`);
      toast('Lien révoqué — la copie anonymisée est supprimée');
      reload();
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  return (
    <>
      <PageHeader title="Partages" subtitle="Liens anonymisés envoyés à vos confrères, et leurs réponses." />
      {loading && !data ? (
        <PageLoader />
      ) : !data.shares.length ? (
        <div className="card"><Empty icon={Share2} title="Aucun partage">Depuis un examen, cliquez « Partager » pour envoyer un cas anonymisé.</Empty></div>
      ) : (
        <div className="space-y-3">
          {data.shares.map((sh) => {
            const expired = new Date(sh.expires_at) < new Date();
            const live = !sh.revoked_at && !expired;
            return (
              <div key={sh.id} className={`card p-4 ${live ? '' : 'opacity-70'}`}>
                <div className="flex flex-wrap items-center gap-2">
                  <ModalityChips modalities={sh.modalities} />
                  <Link to={`/app/studies/${sh.study_id}`} className="font-medium hover:underline">{sh.description || 'Examen'}</Link>
                  <span className="text-sm text-ink-mute">· {sh.patient_name} · {fmtDate(sh.study_date)}</span>
                  <span className="ml-auto"><ShareStatus status={sh.revoked_at ? null : sh.status} error={sh.error} /></span>
                  <span className="mono text-ink-mute">{sh.anon_patient_id}</span>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-ink-soft">
                  <span>→ {sh.recipient || 'Confrère'}</span>
                  <span className="flex items-center gap-1 text-xs text-ink-mute"><Eye className="h-3.5 w-3.5" />{sh.view_count} ouverture(s){sh.last_viewed_at && `, ${ago(sh.last_viewed_at)}`}</span>
                  <span className="text-xs text-ink-mute">
                    {sh.revoked_at ? `Révoqué ${fmtDateTime(sh.revoked_at)}` : expired ? 'Expiré' : `Expire ${fmtDateTime(sh.expires_at)}`}
                  </span>
                  {live && (
                    <button className="btn-danger ml-auto py-1 text-xs" onClick={() => revoke(sh)}>
                      <Ban className="h-3.5 w-3.5" /> Révoquer
                    </button>
                  )}
                </div>
                {sh.message && <p className="mt-2 rounded-lg bg-paper px-3 py-2 text-sm text-ink-soft">{sh.message}</p>}
                {sh.replies.length > 0 && (
                  <ul className="mt-3 space-y-2 border-l-2 border-brand-100 pl-3">
                    {sh.replies.map((r, i) => (
                      <li key={i} className="text-sm">
                        <span className="flex items-center gap-1 text-xs font-medium text-brand-700"><MessageSquare className="h-3 w-3" />{r.author} · {ago(r.created_at)}</span>
                        <p className="whitespace-pre-wrap">{r.body}</p>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
