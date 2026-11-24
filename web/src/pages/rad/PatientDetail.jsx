import { useState } from 'react';
import { Link, useNavigate, useParams, useOutletContext } from 'react-router-dom';
import { ArrowLeft, Pencil, Check, Trash2, GitMerge, FileText } from 'lucide-react';
import { api } from '../../lib/api.js';
import { fmtDate, age, sexLabel } from '../../lib/format.js';
import { useLoad, PageLoader, ErrorNote, StatusBadge, ModalityChips, Modal, Field, useToast } from '../../components/ui.jsx';

export default function PatientDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const toast = useToast();
  const { refreshStats } = useOutletContext();
  const { data, error, loading, reload } = useLoad(() => api.get(`/patients/${id}`), [id]);
  const [edit, setEdit] = useState(null);
  const [removeOpen, setRemoveOpen] = useState(false);
  const [mergeOpen, setMergeOpen] = useState(false);

  if (loading && !data) return <PageLoader />;
  if (error) return <ErrorNote error={error} />;
  const { patient: p, studies, identifiers, suggestions } = data;

  async function save() {
    try {
      await api.patch(`/patients/${p.id}`, edit);
      setEdit(null);
      toast('Dossier mis à jour');
      reload();
    } catch (e) {
      toast(e.message, 'error');
    }
  }
  async function activate() {
    await api.patch(`/patients/${p.id}`, { status: 'active' });
    toast('Patient ajouté');
    refreshStats?.();
    reload();
  }
  async function remove() {
    await api.del(`/patients/${p.id}`);
    toast('Patient retiré');
    refreshStats?.();
    nav('/app/patients');
  }

  return (
    <>
      <Link to="/app/patients" className="mb-4 inline-flex items-center gap-1 text-sm text-ink-mute hover:text-ink">
        <ArrowLeft className="h-4 w-4" /> Patients
      </Link>

      <div className="card mb-6 p-5">
        <div className="flex flex-wrap items-start gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-brand-50 text-lg font-semibold text-brand-700">
            {p.full_name.split(' ').map((w) => w[0]).slice(0, 2).join('')}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-semibold">{p.full_name}</h1>
              {p.status === 'pending' && <span className="rounded-md bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">À valider</span>}
            </div>
            <p className="mt-1 text-sm text-ink-mute">
              {sexLabel(p.sex)} · {p.birth_date ? `${fmtDate(p.birth_date)} · ${age(p.birth_date)} ans` : 'Date de naissance inconnue'} · {studies.length} examen(s)
            </p>
            {p.notes && <p className="mt-2 whitespace-pre-wrap text-sm text-ink-soft">{p.notes}</p>}
            <div className="mt-3 flex flex-wrap gap-1.5">
              {identifiers.map((i) => (
                <span key={i.id} className="mono rounded bg-paper px-2 py-0.5 text-ink-soft" title={i.dicom_name}>
                  {i.dicom_patient_id} <span className="text-ink-mute">· {i.issuer || 'émetteur inconnu'}</span>
                </span>
              ))}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {p.status === 'pending' && (
              <button className="btn-primary" onClick={activate}><Check className="h-4 w-4" /> Ajouter</button>
            )}
            <button className="btn-outline" onClick={() => setEdit({ fullName: p.full_name, birthDate: p.birth_date || '', sex: p.sex || '', notes: p.notes || '' })}>
              <Pencil className="h-4 w-4" /> Modifier
            </button>
            <button className="btn-outline" onClick={() => setMergeOpen(true)}><GitMerge className="h-4 w-4" /> Fusionner</button>
            <button className="btn-danger" onClick={() => setRemoveOpen(true)}><Trash2 className="h-4 w-4" /></button>
          </div>
        </div>
        {suggestions.length > 0 && (
          <Link to="/app/patients" className="mt-4 flex items-center gap-2 rounded-lg bg-sky-50 px-3 py-2 text-sm text-sky-800">
            <GitMerge className="h-4 w-4" /> Doublon possible avec {suggestions.map((s) => (s.a.id === p.id ? s.b.full_name : s.a.full_name)).join(', ')} — à vérifier
          </Link>
        )}
      </div>

      <h2 className="mb-3 font-semibold">Historique</h2>
      <ol className="relative space-y-3 border-l border-paper-line pl-5">
        {studies.map((s) => (
          <li key={s.id} className="relative">
            <span className="absolute -left-[25px] top-4 h-2.5 w-2.5 rounded-full border-2 border-white bg-brand-500 ring-1 ring-brand-500" />
            <Link to={`/app/studies/${s.id}`} className="card block p-4 hover:border-ink-mute/30">
              <div className="flex flex-wrap items-center gap-2">
                <span className="mono text-ink-mute">{fmtDate(s.study_date)}</span>
                <ModalityChips modalities={s.modalities} />
                <span className="font-medium">{s.description || 'Examen'}</span>
                <span className="ml-auto"><StatusBadge status={s.status} /></span>
              </div>
              <p className="mt-1 text-xs text-ink-mute">{[s.client_org || 'Personnel', s.institution, `${s.instance_count} images`].filter(Boolean).join(' · ')}</p>
              {s.conclusion && (
                <p className="mt-2 flex gap-2 text-sm text-ink-soft">
                  <FileText className="mt-0.5 h-4 w-4 shrink-0 text-ink-mute" />
                  <span className="line-clamp-2">{s.conclusion}</span>
                </p>
              )}
            </Link>
          </li>
        ))}
      </ol>

      <Modal open={Boolean(edit)} onClose={() => setEdit(null)} title="Modifier le dossier"
        footer={<><button className="btn-ghost" onClick={() => setEdit(null)}>Annuler</button><button className="btn-primary" onClick={save}>Enregistrer</button></>}>
        {edit && (
          <div className="space-y-3">
            <Field label="Nom complet"><input className="input" value={edit.fullName} onChange={(e) => setEdit({ ...edit, fullName: e.target.value })} /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Naissance"><input type="date" className="input" value={edit.birthDate} onChange={(e) => setEdit({ ...edit, birthDate: e.target.value })} /></Field>
              <Field label="Sexe">
                <select className="input" value={edit.sex} onChange={(e) => setEdit({ ...edit, sex: e.target.value })}>
                  <option value="">—</option><option value="M">Homme</option><option value="F">Femme</option><option value="O">Autre</option>
                </select>
              </Field>
            </div>
            <Field label="Notes privées"><textarea rows={3} className="input" value={edit.notes} onChange={(e) => setEdit({ ...edit, notes: e.target.value })} /></Field>
          </div>
        )}
      </Modal>

      <Modal open={removeOpen} onClose={() => setRemoveOpen(false)} title="Retirer ce patient ?"
        footer={<><button className="btn-ghost" onClick={() => setRemoveOpen(false)}>Annuler</button><button className="btn-danger" onClick={remove}>Retirer définitivement</button></>}>
        <p className="text-sm text-ink-soft">Le dossier et ses {studies.length} examen(s) seront supprimés, avec leurs comptes rendus et partages.</p>
      </Modal>

      <MergeModal open={mergeOpen} onClose={() => setMergeOpen(false)} patient={p} onMerged={() => { setMergeOpen(false); refreshStats?.(); reload(); }} />
    </>
  );
}

function MergeModal({ open, onClose, patient, onMerged }) {
  const toast = useToast();
  const [q, setQ] = useState('');
  const results = useLoad(() => (open && q.length >= 2 ? api.get(`/patients?q=${encodeURIComponent(q)}`) : Promise.resolve({ patients: [] })), [q, open]);
  async function merge(other) {
    try {
      await api.post(`/patients/${patient.id}/merge`, { otherId: other.id });
      toast(`${other.full_name} fusionné dans ce dossier`);
      onMerged();
    } catch (e) {
      toast(e.message, 'error');
    }
  }
  return (
    <Modal open={open} onClose={onClose} title="Absorber un autre dossier">
      <p className="mb-3 text-sm text-ink-mute">Les examens du dossier choisi seront rattachés à <b>{patient.full_name}</b>.</p>
      <input className="input" placeholder="Rechercher un patient…" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
      <ul className="mt-3 max-h-64 overflow-y-auto">
        {(results.data?.patients || []).filter((x) => x.id !== patient.id).map((x) => (
          <li key={x.id} className="flex items-center gap-2 border-b border-paper-line/70 py-2 text-sm last:border-0">
            <span className="flex-1">{x.full_name} <span className="text-xs text-ink-mute">· {fmtDate(x.birth_date)} · {x.study_count} ex.</span></span>
            <button className="btn-outline py-1 text-xs" onClick={() => merge(x)}>Fusionner ici</button>
          </li>
        ))}
      </ul>
    </Modal>
  );
}
