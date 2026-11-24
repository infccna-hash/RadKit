import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Search, Upload, Eye, Inbox, AlertCircle } from 'lucide-react';
import { api } from '../../lib/api.js';
import { openStudyViewer } from '../../lib/viewer.js';
import { fmtDate, ago, age, sexLabel } from '../../lib/format.js';
import { useLoad, PageHeader, StatusBadge, PriorityBadge, ModalityChips, PageLoader, Empty, ErrorNote, useToast } from '../../components/ui.jsx';

const TABS = [
  { key: 'open', label: 'À faire' },
  { key: 'reported', label: 'Interprétés' },
  { key: 'all', label: 'Tous' },
];

export default function Worklist() {
  const nav = useNavigate();
  const toast = useToast();
  const [tab, setTab] = useState('open');
  const [source, setSource] = useState('');
  const [modality, setModality] = useState('');
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [sp, setSp] = useSearchParams();
  const client = sp.get('client') || '';

  const stats = useLoad(() => api.get('/stats'), []);
  const params = new URLSearchParams();
  if (tab === 'open') params.set('open', '1');
  if (tab === 'reported') params.set('status', 'reported');
  if (source) params.set('source', source);
  if (modality) params.set('modality', modality);
  if (q) params.set('q', q);
  if (client) params.set('client', client);
  const list = useLoad(() => api.get(`/studies?${params}`), [tab, source, modality, q, client]);

  async function openViewer(e, id) {
    e.stopPropagation();
    try {
      await openStudyViewer(id);
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  const s = stats.data;
  return (
    <>
      <PageHeader
        title="Liste de travail"
        subtitle="Vos examens personnels et ceux envoyés par vos cliniques."
        actions={
          <Link to="/app/upload" className="btn-primary">
            <Upload className="h-4 w-4" /> Importer
          </Link>
        }
      />

      {s && (
        <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label="À interpréter" value={s.open} />
          <Stat label="Urgents" value={s.urgent} tone={s.urgent ? 'urgent' : null} />
          <Stat label="Reçus aujourd'hui" value={s.today} />
          <Stat label="Interprétés (7 j)" value={s.reported_week} />
        </div>
      )}

      {s && s.pending_patients + s.merges > 0 && (
        <Link to="/app/patients" className="mb-5 flex items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 hover:bg-amber-100/70">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>
            {s.pending_patients > 0 && <b>{s.pending_patients} nouveau(x) patient(s) à valider</b>}
            {s.pending_patients > 0 && s.merges > 0 && ' · '}
            {s.merges > 0 && <b>{s.merges} doublon(s) possible(s)</b>}
          </span>
          <span className="ml-auto font-medium">Vérifier →</span>
        </Link>
      )}

      <div className="card">
        <div className="flex flex-wrap items-center gap-3 border-b border-paper-line px-4 py-3">
          <div className="flex rounded-lg bg-paper p-0.5">
            {TABS.map((t) => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`rounded-md px-3 py-1.5 text-sm ${tab === t.key ? 'bg-white font-medium shadow-card' : 'text-ink-mute'}`}
              >
                {t.label}
              </button>
            ))}
          </div>
          <select className="input w-auto py-1.5" value={source} onChange={(e) => setSource(e.target.value)}>
            <option value="">Toutes sources</option>
            <option value="personal">Mes examens</option>
            <option value="clients">Des cliniques</option>
          </select>
          <select className="input w-auto py-1.5" value={modality} onChange={(e) => setModality(e.target.value)}>
            <option value="">Modalité</option>
            {['CT', 'MR', 'CR', 'DX', 'US', 'MG', 'XA'].map((m) => (
              <option key={m}>{m}</option>
            ))}
          </select>
          {client && (
            <button className="btn-ghost py-1 text-xs" onClick={() => setSp({})}>
              Filtre clinique actif ✕
            </button>
          )}
          <form
            className="relative ml-auto w-full md:w-64"
            onSubmit={(e) => {
              e.preventDefault();
              setQ(search);
            }}
          >
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-ink-mute" />
            <input className="input pl-8" placeholder="Patient, examen, n° accès…" value={search} onChange={(e) => setSearch(e.target.value)} onBlur={() => setQ(search)} />
          </form>
        </div>

        {list.loading && !list.data ? (
          <PageLoader />
        ) : list.error ? (
          <div className="p-4"><ErrorNote error={list.error} /></div>
        ) : !list.data.studies.length ? (
          <Empty icon={Inbox} title="Rien ici">
            {tab === 'open' ? 'Aucun examen en attente. Importez un dossier ou attendez les envois de vos cliniques.' : 'Aucun examen ne correspond à ces filtres.'}
          </Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-paper-line">
                  <th className="table-head px-4 py-2.5">Patient</th>
                  <th className="table-head px-3 py-2.5">Examen</th>
                  <th className="table-head px-3 py-2.5">Source</th>
                  <th className="table-head px-3 py-2.5">Reçu</th>
                  <th className="table-head px-3 py-2.5">Statut</th>
                  <th className="px-3 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {list.data.studies.map((st) => (
                  <tr
                    key={st.id}
                    onClick={() => nav(`/app/studies/${st.id}`)}
                    className="cursor-pointer border-b border-paper-line/70 last:border-0 hover:bg-paper/60"
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2 font-medium">
                        {st.patient_name || st.dicom_patient_name || 'Sans nom'}
                        {st.patient_status === 'pending' && <span className="h-1.5 w-1.5 rounded-full bg-amber-500" title="Patient à valider" />}
                      </div>
                      <div className="text-xs text-ink-mute">
                        {[sexLabel(st.sex), age(st.birth_date, st.study_date) != null && `${age(st.birth_date, st.study_date)} ans`].filter(Boolean).join(' · ')}
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-2">
                        <ModalityChips modalities={st.modalities} />
                        <span className="text-ink-soft">{st.description || '—'}</span>
                      </div>
                      <div className="text-xs text-ink-mute">{fmtDate(st.study_date)} · {st.instance_count} images</div>
                    </td>
                    <td className="px-3 py-3 text-ink-soft">{st.client_org || <span className="text-ink-mute">Personnel</span>}</td>
                    <td className="whitespace-nowrap px-3 py-3 text-ink-mute">{ago(st.created_at)}</td>
                    <td className="px-3 py-3">
                      <div className="flex flex-wrap gap-1">
                        <PriorityBadge priority={st.priority} />
                        <StatusBadge status={st.status} />
                      </div>
                    </td>
                    <td className="px-3 py-3 text-right">
                      <button className="btn-ghost px-2 py-1" title="Ouvrir la visionneuse" onClick={(e) => openViewer(e, st.id)}>
                        <Eye className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}

function Stat({ label, value, tone }) {
  return (
    <div className="card px-4 py-3">
      <p className="text-xs text-ink-mute">{label}</p>
      <p className={`mt-1 text-2xl font-semibold tabular-nums ${tone === 'urgent' ? 'text-signal-urgent' : ''}`}>{value}</p>
    </div>
  );
}
