import { useState } from 'react';
import { Link, useOutletContext } from 'react-router-dom';
import { Search, Check, Trash2, GitMerge, Users, X } from 'lucide-react';
import { api } from '../../lib/api.js';
import { fmtDate, age, sexLabel } from '../../lib/format.js';
import { useLoad, PageHeader, PageLoader, Empty, ModalityChips, ErrorNote, Modal, useToast } from '../../components/ui.jsx';

export default function Patients() {
  const { refreshStats } = useOutletContext();
  const toast = useToast();
  const [tab, setTab] = useState('pending');
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState(new Set());
  const [confirmRemove, setConfirmRemove] = useState(null);

  const pending = useLoad(() => api.get('/patients?status=pending'), []);
  const merges = useLoad(() => api.get('/merge-suggestions'), []);
  const active = useLoad(() => api.get(`/patients?status=active${q ? `&q=${encodeURIComponent(q)}` : ''}`), [q]);

  const reloadAll = () => {
    pending.reload();
    merges.reload();
    active.reload();
    refreshStats?.();
    setSelected(new Set());
  };

  async function confirm(ids) {
    try {
      const r = await api.post('/patients/confirm', { ids });
      toast(`${r.confirmed} patient(s) ajouté(s)`);
      reloadAll();
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  async function remove(p) {
    try {
      const r = await api.del(`/patients/${p.id}`);
      toast(`Patient retiré (${r.studiesRemoved} examen(s) supprimé(s))`);
      setConfirmRemove(null);
      reloadAll();
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  async function acceptMerge(sug, keep) {
    try {
      await api.post(`/merge-suggestions/${sug.id}/accept`, { keep });
      toast('Dossiers fusionnés');
      reloadAll();
    } catch (e) {
      toast(e.message, 'error');
    }
  }
  async function dismissMerge(sug) {
    await api.post(`/merge-suggestions/${sug.id}/dismiss`).catch((e) => toast(e.message, 'error'));
    reloadAll();
  }

  const pCount = pending.data?.patients.length || 0;
  const mCount = merges.data?.suggestions.length || 0;

  return (
    <>
      <PageHeader title="Patients" subtitle="Créés automatiquement depuis vos DICOM. Vous décidez qui reste." />

      <div className="mb-4 flex gap-1 border-b border-paper-line">
        {[
          ['pending', 'À valider', pCount],
          ['merges', 'Doublons possibles', mCount],
          ['active', 'Dossiers', null],
        ].map(([k, l, n]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={`-mb-px flex items-center gap-2 border-b-2 px-3 py-2 text-sm ${
              tab === k ? 'border-brand-600 font-medium text-ink' : 'border-transparent text-ink-mute hover:text-ink'
            }`}
          >
            {l}
            {n > 0 && <span className="rounded-full bg-amber-100 px-1.5 text-[11px] font-semibold text-amber-800">{n}</span>}
          </button>
        ))}
      </div>

      {tab === 'pending' && (
        <div className="card">
          {pending.loading && !pending.data ? (
            <PageLoader />
          ) : !pCount ? (
            <Empty icon={Check} title="Tout est validé">Les nouveaux patients issus de vos imports apparaîtront ici.</Empty>
          ) : (
            <>
              <div className="flex items-center gap-3 border-b border-paper-line px-4 py-2.5">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-brand-600"
                  checked={selected.size === pCount}
                  onChange={(e) => setSelected(e.target.checked ? new Set(pending.data.patients.map((p) => p.id)) : new Set())}
                />
                <span className="text-sm text-ink-mute">{selected.size ? `${selected.size} sélectionné(s)` : 'Tout sélectionner'}</span>
                {selected.size > 0 && (
                  <button className="btn-primary ml-auto py-1.5" onClick={() => confirm([...selected])}>
                    <Check className="h-4 w-4" /> Ajouter la sélection
                  </button>
                )}
              </div>
              <ul>
                {pending.data.patients.map((p) => (
                  <li key={p.id} className="flex flex-wrap items-center gap-3 border-b border-paper-line/70 px-4 py-3 last:border-0">
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-brand-600"
                      checked={selected.has(p.id)}
                      onChange={(e) => {
                        const n = new Set(selected);
                        e.target.checked ? n.add(p.id) : n.delete(p.id);
                        setSelected(n);
                      }}
                    />
                    <div className="min-w-0 flex-1">
                      <Link to={`/app/patients/${p.id}`} className="font-medium hover:underline">{p.full_name}</Link>
                      <div className="text-xs text-ink-mute">
                        {sexLabel(p.sex)} · {p.birth_date ? `${fmtDate(p.birth_date)} (${age(p.birth_date)} ans)` : 'naissance inconnue'} · {p.study_count} examen(s)
                        {p.clients?.filter(Boolean).length ? ` · via ${p.clients.filter(Boolean).join(', ')}` : ''}
                      </div>
                    </div>
                    <ModalityChips modalities={p.modalities || []} />
                    {p.merge_hints > 0 && (
                      <button onClick={() => setTab('merges')} className="flex items-center gap-1 text-xs font-medium text-sky-700">
                        <GitMerge className="h-3.5 w-3.5" /> doublon ?
                      </button>
                    )}
                    <div className="flex gap-1">
                      <button className="btn-outline py-1.5" onClick={() => confirm([p.id])}>
                        <Check className="h-4 w-4" /> Ajouter
                      </button>
                      <button className="btn-danger py-1.5" onClick={() => setConfirmRemove(p)}>
                        <Trash2 className="h-4 w-4" /> Retirer
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}

      {tab === 'merges' && (
        <div className="space-y-3">
          {merges.loading && !merges.data ? (
            <PageLoader />
          ) : !mCount ? (
            <div className="card"><Empty icon={GitMerge} title="Aucun doublon suspecté" /></div>
          ) : (
            merges.data.suggestions.map((s) => <MergeCard key={s.id} s={s} onKeep={(id) => acceptMerge(s, id)} onDismiss={() => dismissMerge(s)} />)
          )}
        </div>
      )}

      {tab === 'active' && (
        <div className="card">
          <div className="border-b border-paper-line px-4 py-3">
            <div className="relative md:w-72">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-ink-mute" />
              <input className="input pl-8" placeholder="Nom ou identifiant DICOM" defaultValue={q} onKeyDown={(e) => e.key === 'Enter' && setQ(e.target.value)} onBlur={(e) => setQ(e.target.value)} />
            </div>
          </div>
          {active.error && <div className="p-4"><ErrorNote error={active.error} /></div>}
          {active.loading && !active.data ? (
            <PageLoader />
          ) : !active.data?.patients.length ? (
            <Empty icon={Users} title="Aucun dossier">Validez les patients de l'onglet « À valider » pour les voir ici.</Empty>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-paper-line">
                  <th className="table-head px-4 py-2.5">Patient</th>
                  <th className="table-head px-3 py-2.5">Naissance</th>
                  <th className="table-head px-3 py-2.5">Examens</th>
                  <th className="table-head px-3 py-2.5">Dernier</th>
                </tr>
              </thead>
              <tbody>
                {active.data.patients.map((p) => (
                  <tr key={p.id} className="border-b border-paper-line/70 last:border-0 hover:bg-paper/60">
                    <td className="px-4 py-3">
                      <Link to={`/app/patients/${p.id}`} className="font-medium hover:underline">{p.full_name}</Link>
                      <span className="ml-2 text-xs text-ink-mute">{sexLabel(p.sex)}</span>
                    </td>
                    <td className="px-3 py-3 text-ink-soft">{fmtDate(p.birth_date)}</td>
                    <td className="px-3 py-3"><span className="mr-2 tabular-nums">{p.study_count}</span><ModalityChips modalities={p.modalities || []} /></td>
                    <td className="px-3 py-3 text-ink-mute">{fmtDate(p.last_study)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      <Modal
        open={Boolean(confirmRemove)}
        onClose={() => setConfirmRemove(null)}
        title="Retirer ce patient ?"
        footer={
          <>
            <button className="btn-ghost" onClick={() => setConfirmRemove(null)}>Annuler</button>
            <button className="btn-danger" onClick={() => remove(confirmRemove)}>
              <Trash2 className="h-4 w-4" /> Retirer définitivement
            </button>
          </>
        }
      >
        <p className="text-sm text-ink-soft">
          <b>{confirmRemove?.full_name}</b> et ses {confirmRemove?.study_count} examen(s) seront supprimés de votre espace et du serveur
          d'images, ainsi que les partages associés. Les examens envoyés par une clinique disparaîtront aussi de son côté.
        </p>
      </Modal>
    </>
  );
}

function MergeCard({ s, onKeep, onDismiss }) {
  const Side = ({ p }) => (
    <div className="flex-1 rounded-lg border border-paper-line bg-paper/40 p-3">
      <Link to={`/app/patients/${p.id}`} className="font-medium hover:underline">{p.full_name}</Link>
      <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 text-xs text-ink-soft">
        <dt className="text-ink-mute">Naissance</dt><dd>{fmtDate(p.birth_date)}</dd>
        <dt className="text-ink-mute">Sexe</dt><dd>{sexLabel(p.sex)}</dd>
        <dt className="text-ink-mute">ID DICOM</dt><dd className="mono">{p.ids?.filter(Boolean).join(', ') || '—'}</dd>
        <dt className="text-ink-mute">Examens</dt><dd>{p.studies}</dd>
      </dl>
      <button className="btn-outline mt-3 w-full py-1.5 text-xs" onClick={() => onKeep(p.id)}>
        Garder ce dossier
      </button>
    </div>
  );
  return (
    <div className="card p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
        <GitMerge className="h-4 w-4 text-sky-700" />
        <span className="font-medium">Même personne ?</span>
        <span className="text-ink-mute">{s.reasons.join(' · ')}</span>
        <span className="ml-auto mono text-ink-mute">{Math.round(s.score * 100)} %</span>
        <button className="btn-ghost px-2 py-1 text-xs" onClick={onDismiss}>
          <X className="h-3.5 w-3.5" /> Personnes différentes
        </button>
      </div>
      <div className="flex flex-col gap-3 md:flex-row">
        <Side p={s.a} />
        <Side p={s.b} />
      </div>
      <p className="mt-2 text-xs text-ink-mute">Fusionner rattache tous les examens et identifiants au dossier gardé.</p>
    </div>
  );
}
