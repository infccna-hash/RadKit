import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Eye, Download, ShieldCheck, Send, Clock, Layers } from 'lucide-react';
import { hasWebGL2 } from '../lib/viewer.js';
import { api } from '../lib/api.js';
import { fmtDateTime, ago, sexLabel } from '../lib/format.js';
import { Logo } from '../components/Layout.jsx';
import { useLoad, PageLoader, ModalityChips, Spinner, ErrorNote, Field } from '../components/ui.jsx';

export default function SharePage() {
  const { token } = useParams();
  const { data, error, loading, reload } = useLoad(() => api.get(`/public/shares/${token}`), [token]);
  const [opening, setOpening] = useState(false);
  const [reply, setReply] = useState({ author: '', body: '' });
  const [sent, setSent] = useState(false);
  const [replyErr, setReplyErr] = useState(null);
  const preparing = data?.share?.status === 'preparing';
  useEffect(() => {
    if (!preparing) return;
    const t = setInterval(reload, 3000);
    return () => clearInterval(t);
  }, [preparing, reload]);

  async function open() {
    if (!hasWebGL2()) {
      window.location.href = `/s/${token}/view`;
      return;
    }
    setOpening(true);
    try {
      const { url } = await api.post(`/public/shares/${token}/open`);
      window.location.href = url;
    } catch (e) {
      alert(e.message);
      setOpening(false);
    }
  }
  async function send(e) {
    e.preventDefault();
    setReplyErr(null);
    try {
      await api.post(`/public/shares/${token}/replies`, reply);
      setSent(true);
      setReply({ ...reply, body: '' });
      reload();
    } catch (err) {
      setReplyErr(err.message);
    }
  }

  return (
    <div className="min-h-screen">
      <header className="border-b border-paper-line bg-white px-6 py-3"><Logo small /></header>
      <main className="mx-auto max-w-2xl px-4 py-10">
        {loading && !data ? (
          <PageLoader />
        ) : error ? (
          <div className="card p-8 text-center">
            <Clock className="mx-auto h-8 w-8 text-ink-mute" />
            <p className="mt-3 font-medium">{error.message}</p>
            <p className="mt-1 text-sm text-ink-mute">Demandez un nouveau lien à votre confrère.</p>
          </div>
        ) : (
          <Share s={data.share} token={token} opening={opening} onOpen={open} reply={reply} setReply={setReply} send={send} sent={sent} replyErr={replyErr} />
        )}
      </main>
    </div>
  );
}

function Share({ s, token, opening, onOpen, reply, setReply, send, sent, replyErr }) {
  return (
    <>
      <p className="text-sm text-ink-mute">
        Cas partagé par <b className="text-ink">{s.from?.full_name}</b>{s.from?.organization && `, ${s.from.organization}`}
      </p>
      <div className="card mt-3 p-6">
        <div className="flex flex-wrap items-center gap-2">
          <ModalityChips modalities={s.study.modalities} />
          <h1 className="text-xl font-semibold">{s.study.description || 'Examen'}</h1>
          <span className="mono ml-auto text-ink-mute">{s.reference}</span>
        </div>
        <p className="mt-1 text-sm text-ink-mute">
          {[s.study.sex && sexLabel(s.study.sex), s.study.age, s.study.bodyPart, `${s.study.instanceCount} images`].filter(Boolean).join(' · ')}
        </p>
        {s.message && <blockquote className="mt-4 border-l-2 border-brand-500 pl-3 text-ink-soft">{s.message}</blockquote>}
        {s.status === 'preparing' ? (
          <div className="mt-6 flex items-start gap-2 rounded-lg bg-sky-50 px-3 py-2.5 text-sm text-sky-800">
            <Spinner className="mt-0.5 h-4 w-4 shrink-0" />
            <span>Préparation de la copie anonymisée… Les images seront disponibles dans un instant, la page se met à jour toute seule.</span>
          </div>
        ) : (
        <div className="mt-6 flex flex-wrap gap-2">
          <button className="btn-primary" onClick={onOpen} disabled={opening}>{opening ? <Spinner /> : <Eye className="h-4 w-4" />} Voir les images</button>
          <a className="btn-outline" href={`/s/${token}/view`}><Layers className="h-4 w-4" /> Visionneuse légère</a>
          <a className="btn-outline" href={`/api/public/shares/${token}/download`}><Download className="h-4 w-4" /> Télécharger (ZIP)</a>
        </div>
        )}
        <p className="mt-4 flex items-center gap-1.5 text-xs text-ink-mute">
          <ShieldCheck className="h-3.5 w-3.5" /> Copie anonymisée · lien valable jusqu'au {fmtDateTime(s.expiresAt)}
        </p>
      </div>

      {s.report && (
        <div className="card mt-4 p-6">
          <h2 className="mb-3 font-semibold">Compte rendu {s.report.status !== 'final' && <span className="text-xs font-normal text-ink-mute">(brouillon)</span>}</h2>
          {[['Technique', s.report.technique], ['Résultats', s.report.findings], ['Conclusion', s.report.conclusion]].map(([l, v]) => v && (
            <section key={l} className="mb-3"><h3 className="label">{l}</h3><p className="whitespace-pre-wrap text-sm">{v}</p></section>
          ))}
        </div>
      )}

      <div className="card mt-4 p-6">
        <h2 className="mb-3 font-semibold">Répondre</h2>
        {s.replies.length > 0 && (
          <ul className="mb-4 space-y-3">
            {s.replies.map((r, i) => (
              <li key={i} className="rounded-lg bg-paper px-3 py-2 text-sm">
                <p className="text-xs font-medium text-ink-mute">{r.author} · {ago(r.created_at)}</p>
                <p className="whitespace-pre-wrap">{r.body}</p>
              </li>
            ))}
          </ul>
        )}
        <form onSubmit={send} className="space-y-3">
          <Field label="Votre nom"><input className="input" required value={reply.author} onChange={(e) => setReply({ ...reply, author: e.target.value })} /></Field>
          <Field label="Avis"><textarea rows={4} className="input" required value={reply.body} onChange={(e) => setReply({ ...reply, body: e.target.value })} /></Field>
          <ErrorNote error={replyErr} />
          <button className="btn-primary"><Send className="h-4 w-4" /> Envoyer</button>
          {sent && <span className="ml-3 text-sm text-emerald-700">Envoyé, merci.</span>}
        </form>
      </div>
    </>
  );
}
