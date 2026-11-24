import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useOutletContext } from 'react-router-dom';
import {
  ArrowLeft, Eye, Download, Share2, Lock, Unlock, Printer, Sparkles, Save, Copy, Trash2,
  AlertTriangle, FileText, Building2, MessageSquare, Languages, ShieldCheck, Layers,
} from 'lucide-react';
import { api } from '../../lib/api.js';
import { openStudyViewer } from '../../lib/viewer.js';
import { useAuth } from '../../lib/auth.jsx';
import { fmtDate, fmtDateTime, age, sexLabel, ago } from '../../lib/format.js';
import { useLoad, PageLoader, ErrorNote, StatusBadge, ModalityChips, Modal, Field, Spinner, useToast, ShareStatus } from '../../components/ui.jsx';
import { CheckCircle2 } from 'lucide-react';

const SECTIONS = [
  ['indication', 'Indication', 2],
  ['technique', 'Technique', 2],
  ['findings', 'Résultats', 8],
  ['conclusion', 'Conclusion', 3],
];

export default function StudyDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const toast = useToast();
  const { config } = useAuth();
  const { refreshStats } = useOutletContext();
  const { data, error, loading, reload } = useLoad(() => api.get(`/studies/${id}`), [id]);
  const [shareOpen, setShareOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  if (loading && !data) return <PageLoader />;
  if (error) return <ErrorNote error={error} />;
  const { study: s, patient, priors, report, client, shares, template } = data;

  async function openViewer() {
    try {
      const mode = await openStudyViewer(s.id);
      if (mode === 'lite') toast('WebGL indisponible sur ce poste : visionneuse légère ouverte');
      if (s.status === 'new') setTimeout(reload, 1500);
    } catch (e) {
      toast(e.message, 'error');
    }
  }
  async function patch(body) {
    try {
      await api.patch(`/studies/${s.id}`, body);
      reload();
      refreshStats?.();
    } catch (e) {
      toast(e.message, 'error');
    }
  }
  async function del() {
    await api.del(`/studies/${s.id}`);
    toast('Examen supprimé');
    refreshStats?.();
    nav('/app');
  }

  return (
    <>
      <Link to="/app" className="mb-4 inline-flex items-center gap-1 text-sm text-ink-mute hover:text-ink">
        <ArrowLeft className="h-4 w-4" /> Liste de travail
      </Link>

      <div className="mb-6 flex flex-wrap items-start gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <ModalityChips modalities={s.modalities} />
            <h1 className="text-xl font-semibold">{s.description || 'Examen'}</h1>
            <StatusBadge status={s.status} />
          </div>
          <p className="mt-1 text-sm text-ink-mute">
            {patient ? (
              <Link to={`/app/patients/${patient.id}`} className="font-medium text-ink hover:underline">{patient.full_name}</Link>
            ) : (
              s.dicom_patient_name
            )}
            {' · '}
            {sexLabel(s.dicom_sex)}
            {age(s.dicom_birth_date, s.study_date) != null && ` · ${age(s.dicom_birth_date, s.study_date)} ans`}
            {' · '}
            {fmtDate(s.study_date)} · {s.series_count} séries · {s.instance_count} images
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="btn-primary" onClick={openViewer}><Eye className="h-4 w-4" /> Visionneuse</button>
          <button className="btn-outline" title="Visionneuse légère (sans WebGL)" onClick={() => openStudyViewer(s.id, { lite: true })}><Layers className="h-4 w-4" /> Légère</button>
          <button className="btn-outline" onClick={() => setShareOpen(true)}><Share2 className="h-4 w-4" /> Partager</button>
          <a className="btn-outline" href={`/api/studies/${s.id}/download`}><Download className="h-4 w-4" /></a>
          <button className="btn-danger" onClick={() => setDeleteOpen(true)} title="Supprimer"><Trash2 className="h-4 w-4" /></button>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <ReportEditor study={s} report={report} template={template} aiEnabled={config.aiEnabled} onChange={() => { reload(); refreshStats?.(); }} />

        <aside className="space-y-4">
          {client && (
            <section className="card p-4">
              <h3 className="label flex items-center gap-1.5"><Building2 className="h-3.5 w-3.5" /> Envoyé par</h3>
              <p className="font-medium">{client.organization}</p>
              <p className="text-xs text-ink-mute">{[client.full_name, client.phone].filter(Boolean).join(' · ')}</p>
              {s.clinical_info && (
                <div className="mt-3 rounded-lg bg-paper px-3 py-2 text-sm">
                  <span className="text-xs font-medium text-ink-mute">Renseignements cliniques</span>
                  <p className="mt-0.5 whitespace-pre-wrap">{s.clinical_info}</p>
                </div>
              )}
            </section>
          )}

          <section className="card space-y-3 p-4">
            <Field label="Priorité">
              <select className="input py-1.5" value={s.priority} onChange={(e) => patch({ priority: e.target.value })}>
                <option value="urgent">Urgent</option>
                <option value="normal">Normal</option>
                <option value="low">Faible</option>
              </select>
            </Field>
            <PrivateNote study={s} onSave={(privateNote) => patch({ privateNote })} />
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
              <dt className="text-ink-mute">Établissement</dt><dd className="truncate">{s.institution || '—'}</dd>
              <dt className="text-ink-mute">Prescripteur</dt><dd className="truncate">{s.referring || '—'}</dd>
              <dt className="text-ink-mute">N° d'accès</dt><dd className="mono">{s.accession || '—'}</dd>
              <dt className="text-ink-mute">ID patient</dt><dd className="mono">{s.dicom_patient_id || '—'}</dd>
              <dt className="text-ink-mute">Reçu</dt><dd>{fmtDateTime(s.created_at)}</dd>
            </dl>
          </section>

          {priors.length > 0 && (
            <section className="card p-4">
              <h3 className="label">Antériorités ({priors.length})</h3>
              <ul className="space-y-2">
                {priors.slice(0, 6).map((p) => (
                  <li key={p.id}>
                    <Link to={`/app/studies/${p.id}`} className="block rounded-lg px-2 py-1.5 hover:bg-paper">
                      <div className="flex items-center gap-2 text-sm">
                        <span className="mono text-ink-mute">{fmtDate(p.study_date)}</span>
                        <ModalityChips modalities={p.modalities} />
                      </div>
                      <p className="truncate text-xs text-ink-soft">{p.conclusion || p.description}</p>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {shares.length > 0 && (
            <section className="card p-4">
              <h3 className="label">Partages</h3>
              <ul className="space-y-2 text-sm">
                {shares.map((sh) => (
                  <li key={sh.id} className="flex items-center gap-2">
                    <Share2 className="h-3.5 w-3.5 text-ink-mute" />
                    <span className="flex-1 truncate">{sh.recipient || 'Confrère'}</span>
                    {sh.replies > 0 && <span className="flex items-center gap-0.5 text-xs text-brand-700"><MessageSquare className="h-3 w-3" />{sh.replies}</span>}
                    <ShareStatus status={sh.revoked_at ? null : sh.status} />
                    <span className="text-xs text-ink-mute">{sh.revoked_at ? 'révoqué' : new Date(sh.expires_at) < new Date() ? 'expiré' : `${sh.view_count} vue(s)`}</span>
                  </li>
                ))}
              </ul>
              <Link to="/app/shares" className="mt-2 inline-block text-xs font-medium text-brand-700">Gérer →</Link>
            </section>
          )}
        </aside>
      </div>

      <ShareModal open={shareOpen} onClose={() => { setShareOpen(false); reload(); }} study={s} hasReport={Boolean(report)} />
      <Modal open={deleteOpen} onClose={() => setDeleteOpen(false)} title="Supprimer cet examen ?"
        footer={<><button className="btn-ghost" onClick={() => setDeleteOpen(false)}>Annuler</button><button className="btn-danger" onClick={del}>Supprimer</button></>}>
        <p className="text-sm text-ink-soft">Les images, le compte rendu et les partages de cet examen seront supprimés définitivement.</p>
      </Modal>
    </>
  );
}

function PrivateNote({ study, onSave }) {
  const [v, setV] = useState(study.private_note || '');
  useEffect(() => setV(study.private_note || ''), [study.private_note]);
  return (
    <Field label="Note privée">
      <textarea rows={2} className="input text-sm" placeholder="Visible par vous seul" value={v} onChange={(e) => setV(e.target.value)}
        onBlur={() => v !== (study.private_note || '') && onSave(v)} />
    </Field>
  );
}

function ReportEditor({ study, report, template, aiEnabled, onChange }) {
  const toast = useToast();
  const empty = { title: '', indication: '', technique: '', findings: '', conclusion: '', patientSummary: '' };
  const fromReport = (r) =>
    r ? { title: r.title || '', indication: r.indication || '', technique: r.technique || '', findings: r.findings || '', conclusion: r.conclusion || '', patientSummary: r.patient_summary || '' } : { ...empty, indication: study.clinical_info || '' };
  const [f, setF] = useState(() => fromReport(report));
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [aiNotes, setAiNotes] = useState('');
  const [aiBusy, setAiBusy] = useState(null);
  const final = report?.status === 'final';
  const timer = useRef();
  // Edit/save bookkeeping in refs so async saves never lose keystrokes typed meanwhile
  const fRef = useRef(f);
  const editSeq = useRef(0);
  const savedSeq = useRef(0);
  const inflight = useRef(null);

  useEffect(() => {
    if (editSeq.current !== savedSeq.current) return; // never overwrite unsaved local edits
    const next = fromReport(report);
    fRef.current = next;
    setF(next);
    setDirty(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [report?.id, report?.status, report?.updated_at]);

  const applyEdit = (updater) => {
    const next = updater(fRef.current);
    fRef.current = next;
    setF(next);
    editSeq.current += 1;
    setDirty(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => saveRef.current(true), 4000);
  };
  const set = (k, v) => applyEdit((x) => ({ ...x, [k]: v }));

  async function save(silent) {
    clearTimeout(timer.current);
    if (inflight.current) await inflight.current.catch(() => {}); // one save at a time, in order
    const seq = editSeq.current;
    if (seq === savedSeq.current && report) return; // nothing new
    setSaving(true);
    const p = api.put(`/studies/${study.id}/report`, fRef.current);
    inflight.current = p;
    try {
      await p;
      savedSeq.current = Math.max(savedSeq.current, seq);
      const caughtUp = editSeq.current === seq;
      setDirty(!caughtUp);
      if (!silent) toast('Brouillon enregistré');
      if (!report && caughtUp) onChange();
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      inflight.current = null;
      setSaving(false);
    }
  }
  const saveRef = useRef(save);
  saveRef.current = save;
  useEffect(() => () => clearTimeout(timer.current), []);
  const flush = async () => {
    if (inflight.current) await inflight.current.catch(() => {});
    if (editSeq.current !== savedSeq.current) await save(true);
  };

  async function finalize() {
    await flush();
    if (editSeq.current !== savedSeq.current) return toast('Enregistrement impossible, réessayez', 'error');
    try {
      await api.post(`/studies/${study.id}/report/finalize`);
      toast('Compte rendu validé' + (study.client_id ? ' — visible par la clinique' : ''));
      onChange();
    } catch (e) {
      toast(e.message, 'error');
    }
  }
  async function reopen() {
    await api.post(`/studies/${study.id}/report/reopen`);
    onChange();
  }
  function insertTemplate() {
    applyEdit((x) => ({
      ...x,
      technique: x.technique || template.technique,
      findings: x.findings ? x.findings : template.findings,
      conclusion: x.conclusion || template.conclusion,
    }));
  }
  async function aiDraft() {
    setAiBusy('draft');
    try {
      const { draft } = await api.post('/ai/draft-report', { studyId: study.id, notes: aiNotes });
      applyEdit((x) => ({ ...x, ...Object.fromEntries(Object.entries(draft).filter(([k, v]) => v && k in x)) }));
      toast('Brouillon IA inséré — relisez avant de valider');
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setAiBusy(null);
    }
  }
  async function aiPatient(lang) {
    await flush();
    setAiBusy(lang);
    try {
      const { text } = await api.post('/ai/patient-summary', { studyId: study.id, lang });
      set('patientSummary', text);
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setAiBusy(null);
    }
  }

  return (
    <section className="card">
      <div className="flex flex-wrap items-center gap-2 border-b border-paper-line px-5 py-3">
        <FileText className="h-4 w-4 text-ink-mute" />
        <h2 className="font-semibold">Compte rendu</h2>
        {final ? (
          <span className="flex items-center gap-1 text-xs text-emerald-700"><Lock className="h-3.5 w-3.5" /> Validé le {fmtDateTime(report.finalized_at)}</span>
        ) : (
          <span className="text-xs text-ink-mute">{saving ? 'Enregistrement…' : dirty ? 'Modifications non enregistrées' : report ? `Brouillon · ${ago(report.updated_at)}` : 'Nouveau'}</span>
        )}
        <div className="ml-auto flex flex-wrap gap-2">
          {!final && <button className="btn-ghost py-1.5 text-xs" onClick={insertTemplate}>Modèle : {template.label}</button>}
          {report && <Link to={`/print/${study.id}`} target="_blank" className="btn-outline py-1.5"><Printer className="h-4 w-4" /></Link>}
        </div>
      </div>

      {!final && aiEnabled && (
        <div className="border-b border-paper-line bg-brand-50/40 px-5 py-3">
          <div className="flex items-start gap-2">
            <textarea rows={2} className="input flex-1 text-sm" placeholder="Vos notes en vrac ou votre dictée — l'IA les met en forme sans rien inventer"
              value={aiNotes} onChange={(e) => setAiNotes(e.target.value)} />
            <button className="btn-outline whitespace-nowrap" disabled={!aiNotes.trim() || aiBusy} onClick={aiDraft}>
              {aiBusy === 'draft' ? <Spinner /> : <Sparkles className="h-4 w-4 text-brand-600" />} Rédiger
            </button>
          </div>
          <p className="mt-1.5 flex items-center gap-1 text-[11px] text-ink-mute"><ShieldCheck className="h-3 w-3" /> Seuls la modalité, l'âge, le sexe et vos notes sont envoyés — jamais le nom ni l'identifiant.</p>
        </div>
      )}

      <div className="space-y-4 px-5 py-4">
        {SECTIONS.map(([k, label, rows]) => (
          <Field key={k} label={label}>
            {final ? (
              <p className="min-h-[1.5rem] whitespace-pre-wrap text-sm">{f[k] || <span className="text-ink-mute">—</span>}</p>
            ) : (
              <textarea rows={rows} className={`input text-sm leading-relaxed ${k === 'conclusion' ? 'font-medium' : ''}`} value={f[k]} onChange={(e) => set(k, e.target.value)} onBlur={() => dirty && save(true)} />
            )}
          </Field>
        ))}

        {(f.patientSummary || (!final && aiEnabled)) && (
          <div className="rounded-lg border border-dashed border-paper-line p-3">
            <div className="mb-2 flex items-center gap-2">
              <span className="label mb-0">Version patient</span>
              {aiEnabled && !final && (
                <span className="ml-auto flex gap-1">
                  <button className="btn-ghost px-2 py-1 text-xs" disabled={aiBusy} onClick={() => aiPatient('fr')}>{aiBusy === 'fr' ? <Spinner className="h-3 w-3" /> : <Languages className="h-3.5 w-3.5" />} Français</button>
                  <button className="btn-ghost px-2 py-1 text-xs" disabled={aiBusy} onClick={() => aiPatient('ar')}>{aiBusy === 'ar' ? <Spinner className="h-3 w-3" /> : <Languages className="h-3.5 w-3.5" />} العربية</button>
                </span>
              )}
            </div>
            {final ? (
              <p className="whitespace-pre-wrap text-sm" dir="auto">{f.patientSummary}</p>
            ) : (
              <textarea rows={3} dir="auto" className="input text-sm" placeholder="Explication simple remise au patient (facultatif)" value={f.patientSummary} onChange={(e) => set('patientSummary', e.target.value)} />
            )}
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-paper-line px-5 py-3">
        {final ? (
          <button className="btn-outline" onClick={reopen}><Unlock className="h-4 w-4" /> Rouvrir pour modifier</button>
        ) : (
          <>
            <button className="btn-outline" onClick={() => save(false)} disabled={saving}><Save className="h-4 w-4" /> Enregistrer</button>
            <button className="btn-primary" onClick={finalize} disabled={!f.findings.trim() && !f.conclusion.trim()}>
              <Lock className="h-4 w-4" /> Valider et signer
            </button>
            {study.client_id && <span className="text-xs text-ink-mute">La clinique verra le compte rendu une fois validé.</span>}
          </>
        )}
      </div>
    </section>
  );
}

function ShareModal({ open, onClose, study, hasReport }) {
  const toast = useToast();
  const [f, setF] = useState({ recipient: '', message: '', days: 7, includeReport: false });
  const [risk, setRisk] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [url, setUrl] = useState(null);
  const [share, setShare] = useState(null);

  // Follow the background preparation of the anonymized copy
  useEffect(() => {
    if (!share || share.status !== 'preparing') return;
    const t = setInterval(async () => {
      try {
        const r = await api.get(`/shares/${share.id}`);
        setShare(r.share);
      } catch {
        /* keep polling */
      }
    }, 2000);
    return () => clearInterval(t);
  }, [share]);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (open) {
      setUrl(null);
      setShare(null);
      setRisk(false);
      setConfirmed(false);
      setError(null);
    }
  }, [open]);

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const r = await api.post(`/studies/${study.id}/shares`, { ...f, confirmBurnedIn: confirmed });
      setUrl(r.url);
      setShare(r.share);
    } catch (e) {
      if (e.data?.code === 'BURNED_IN_RISK') setRisk(true);
      else setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  const copy = () => navigator.clipboard.writeText(url).then(() => toast('Lien copié'));

  return (
    <Modal open={open} onClose={onClose} title="Partager avec un confrère"
      footer={url ? <button className="btn-primary" onClick={onClose}>Terminé</button> : (
        <>
          <button className="btn-ghost" onClick={onClose}>Annuler</button>
          <button className="btn-primary" onClick={create} disabled={busy || (risk && !confirmed)}>{busy ? <Spinner /> : <Share2 className="h-4 w-4" />} Créer le lien</button>
        </>
      )}>
      {url ? (
        <div className="space-y-3">
          {share?.status === 'preparing' && (
            <div className="flex items-start gap-2 rounded-lg bg-sky-50 px-3 py-2 text-sm text-sky-800">
              <Spinner className="mt-0.5 h-4 w-4 shrink-0" />
              <span>Copie anonymisée en préparation (jusqu'à une minute pour un gros examen). Vous pouvez déjà envoyer le lien : votre confrère verra une page d'attente qui s'ouvrira toute seule.</span>
            </div>
          )}
          {share?.status === 'ready' && (
            <p className="flex items-center gap-2 text-sm text-emerald-700"><CheckCircle2 className="h-4 w-4" /> Copie anonymisée prête. Votre confrère n'a pas besoin de compte.</p>
          )}
          {share?.status === 'failed' && <ErrorNote error={`La préparation a échoué : ${share.error || 'erreur inconnue'}`} />}
          <div className="flex gap-2">
            <input readOnly className="input mono" value={url} onFocus={(e) => e.target.select()} />
            <button className="btn-outline" onClick={copy}><Copy className="h-4 w-4" /></button>
          </div>
          <a className="btn-outline w-full" target="_blank" rel="noreferrer" href={`https://wa.me/?text=${encodeURIComponent(`Cas à vous montrer (lien anonymisé) : ${url}`)}`}>
            Envoyer par WhatsApp
          </a>
          <p className="text-xs text-ink-mute">Vous pouvez révoquer ce lien à tout moment depuis « Partages ».</p>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex items-start gap-2 rounded-lg bg-brand-50 px-3 py-2 text-xs text-brand-700">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
            Une copie anonymisée est créée : nom, identifiant, date de naissance et établissement sont retirés. L'original n'est pas touché.
          </div>
          <Field label="Destinataire (pour vous)"><input className="input" placeholder="Dr. …, CHU …" value={f.recipient} onChange={(e) => setF({ ...f, recipient: e.target.value })} /></Field>
          <Field label="Message / question"><textarea rows={3} className="input" placeholder="Votre avis sur cette lésion ?" value={f.message} onChange={(e) => setF({ ...f, message: e.target.value })} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Valable">
              <select className="input" value={f.days} onChange={(e) => setF({ ...f, days: Number(e.target.value) })}>
                {[1, 3, 7, 14, 30].map((d) => <option key={d} value={d}>{d} jour{d > 1 ? 's' : ''}</option>)}
              </select>
            </Field>
            <label className="mt-6 flex items-center gap-2 text-sm">
              <input type="checkbox" className="h-4 w-4 accent-brand-600" disabled={!hasReport} checked={f.includeReport} onChange={(e) => setF({ ...f, includeReport: e.target.checked })} />
              Joindre le compte rendu
            </label>
          </div>
          {risk && (
            <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
              <p className="flex items-center gap-2 font-medium"><AlertTriangle className="h-4 w-4" /> Texte possiblement incrusté dans l'image</p>
              <p className="mt-1 text-xs">
                Pour {study.modalities.join(', ')}, le nom du patient est souvent écrit dans les pixels et ne peut pas être retiré automatiquement.
                Ouvrez la visionneuse et vérifiez avant de partager.
              </p>
              <label className="mt-2 flex items-center gap-2 text-xs font-medium">
                <input type="checkbox" className="h-4 w-4 accent-amber-600" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
                J'ai vérifié : aucune donnée identifiante n'est visible dans les images
              </label>
            </div>
          )}
          <ErrorNote error={error} />
        </div>
      )}
    </Modal>
  );
}
