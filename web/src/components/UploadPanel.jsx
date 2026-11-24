import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { UploadCloud, FolderOpen, FileArchive, CheckCircle2, AlertTriangle, UserPlus, Link2, GitMerge } from 'lucide-react';
import { collectFromDrop, collectFromFileList, uploadAll } from '../lib/upload.js';
import { api } from '../lib/api.js';
import { bytes } from '../lib/format.js';
import { ModalityChips, Spinner, ErrorNote } from './ui.jsx';

/**
 * Drop zone → scan → upload → finalize.
 * `extra` returns additional finalize fields (radiologistId, clinicalInfo, priority) and may throw to block.
 */
export default function UploadPanel({ extra, renderFields, onDone, studyLink }) {
  const [items, setItems] = useState([]);
  const [phase, setPhase] = useState('idle'); // idle | scanning | ready | uploading | finalizing | done
  const [progress, setProgress] = useState(null);
  const [results, setResults] = useState(null);
  const [errors, setErrors] = useState([]);
  const [error, setError] = useState(null);
  const [scanStats, setScanStats] = useState(null);
  const [drag, setDrag] = useState(false);
  const folderRef = useRef(), filesRef = useRef();
  const abortRef = useRef();

  const totalSize = items.reduce((n, i) => n + i.size, 0);

  async function scan(promise) {
    setPhase('scanning');
    setError(null);
    setScanStats(null);
    try {
      const found = await promise;
      setItems((prev) => {
        const seen = new Set(prev.map((p) => p.name + p.size));
        return [...prev, ...found.filter((f) => !seen.has(f.name + f.size))];
      });
      setPhase('ready');
      if (!found.length) setError('Aucun fichier DICOM trouvé dans cette sélection.');
    } catch (e) {
      setError(`Lecture impossible : ${e.message}`);
      setPhase(items.length ? 'ready' : 'idle');
    }
  }

  async function start() {
    let more = {};
    try {
      more = extra ? extra() : {};
    } catch (e) {
      setError(e.message);
      return;
    }
    setError(null);
    setPhase('uploading');
    abortRef.current = new AbortController();
    const { studies, errors: errs } = await uploadAll(items, {
      signal: abortRef.current.signal,
      onProgress: setProgress,
    });
    setErrors(errs);
    if (abortRef.current.signal.aborted) {
      setPhase('ready');
      return;
    }
    if (!studies.length) {
      setError("Aucun fichier n'a pu être envoyé.");
      setPhase('ready');
      return;
    }
    setPhase('finalizing');
    try {
      const r = await api.post('/upload/finalize', { studies, ...more });
      setResults(r.results);
      setPhase('done');
      onDone?.(r.results);
    } catch (e) {
      setError(e.message);
      setPhase('ready');
    }
  }

  function reset() {
    setItems([]);
    setScanStats(null);
    setResults(null);
    setErrors([]);
    setProgress(null);
    setPhase('idle');
  }

  if (phase === 'done') {
    return (
      <div className="card p-6">
        <div className="mb-4 flex items-center gap-2 text-emerald-700">
          <CheckCircle2 className="h-5 w-5" />
          <h2 className="font-semibold">Import terminé</h2>
        </div>
        <ul className="divide-y divide-paper-line">
          {results.map((r) => (
            <li key={r.orthancId} className="flex flex-wrap items-center gap-3 py-3 text-sm">
              {r.error ? (
                <span className="text-red-700">Erreur : {r.error}</span>
              ) : (
                <>
                  <ModalityChips modalities={r.modalities} />
                  <span className="font-medium">{r.patientName || 'Sans nom'}</span>
                  <span className="text-ink-mute">{r.description}</span>
                  <span className="ml-auto flex items-center gap-3 text-xs">
                    {r.patientHow === 'identifier' && (
                      <span className="flex items-center gap-1 text-emerald-700"><Link2 className="h-3.5 w-3.5" /> Rattaché au dossier existant</span>
                    )}
                    {r.patientHow === 'created' && (
                      <span className="flex items-center gap-1 text-amber-700"><UserPlus className="h-3.5 w-3.5" /> Nouveau patient à valider</span>
                    )}
                    {r.suggestions > 0 && (
                      <span className="flex items-center gap-1 text-sky-700"><GitMerge className="h-3.5 w-3.5" /> Doublon possible</span>
                    )}
                    {!r.created && <span className="text-ink-mute">déjà présent, complété</span>}
                    {studyLink && r.studyId && (
                      <Link className="font-medium text-brand-700 hover:underline" to={studyLink(r.studyId)}>
                        Ouvrir →
                      </Link>
                    )}
                  </span>
                </>
              )}
            </li>
          ))}
        </ul>
        {errors.length > 0 && <FailedList errors={errors} />}
        <button className="btn-outline mt-5" onClick={reset}>
          Importer d'autres examens
        </button>
      </div>
    );
  }

  const busy = phase === 'uploading' || phase === 'finalizing';
  const pct = progress ? Math.round(((progress.done + progress.failed) / progress.total) * 100) : 0;

  return (
    <div className="space-y-4">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          if (!busy) setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          if (!busy) scan(collectFromDrop(e.dataTransfer, setScanStats));
        }}
        className={`card flex flex-col items-center justify-center border-2 border-dashed px-6 py-12 text-center transition ${
          drag ? 'border-brand-500 bg-brand-50' : 'border-paper-line'
        }`}
      >
        {phase === 'scanning' ? (
          <Spinner className="h-8 w-8 text-brand-600" />
        ) : (
          <UploadCloud className="h-10 w-10 text-brand-600" strokeWidth={1.5} />
        )}
        <p className="mt-3 font-medium">Déposez un dossier, un CD ou une archive ZIP</p>
        <p className="mt-1 text-sm text-ink-mute">Les fichiers non-DICOM et DICOMDIR sont ignorés automatiquement.</p>
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          <button className="btn-outline" disabled={busy} onClick={() => folderRef.current.click()}>
            <FolderOpen className="h-4 w-4" /> Choisir un dossier
          </button>
          <button className="btn-outline" disabled={busy} onClick={() => filesRef.current.click()}>
            <FileArchive className="h-4 w-4" /> Fichiers ou ZIP
          </button>
        </div>
        <input ref={folderRef} type="file" className="hidden" webkitdirectory="" directory="" multiple
          onChange={(e) => { scan(collectFromFileList(e.target.files, setScanStats)); e.target.value = ''; }} />
        <input ref={filesRef} type="file" className="hidden" multiple accept=".dcm,.zip,application/dicom,application/zip,*/*"
          onChange={(e) => { scan(collectFromFileList(e.target.files, setScanStats)); e.target.value = ''; }} />
      </div>

      {items.length > 0 && (
        <div className="card p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="font-medium">{items.length} fichier{items.length > 1 ? 's' : ''} DICOM</p>
              <p className="text-sm text-ink-mute">{bytes(totalSize)}</p>
              {scanStats && (
                <p className="text-xs text-ink-mute">
                  {scanStats.read} fichier{scanStats.read > 1 ? 's' : ''} lu{scanStats.read > 1 ? 's' : ''} ·{' '}
                  {scanStats.skipped} ignoré{scanStats.skipped > 1 ? 's' : ''} (non-DICOM)
                </p>
              )}
            </div>
            {!busy && (
              <button className="btn-ghost text-xs" onClick={reset}>
                Vider
              </button>
            )}
          </div>
          {renderFields && <div className="mt-4">{renderFields(busy)}</div>}
          {busy && (
            <div className="mt-4">
              <div className="h-2 overflow-hidden rounded-full bg-paper">
                <div className="h-full rounded-full bg-brand-600 transition-all" style={{ width: `${phase === 'finalizing' ? 100 : pct}%` }} />
              </div>
              <p className="mt-2 text-sm text-ink-mute">
                {phase === 'finalizing'
                  ? 'Création des dossiers patients…'
                  : `${progress?.done || 0} / ${items.length} envoyés · ${bytes(progress?.bytesDone || 0)}${progress?.failed ? ` · ${progress.failed} échec(s)` : ''}`}
              </p>
            </div>
          )}
          <div className="mt-4 flex gap-2">
            {!busy && (
              <button className="btn-primary" onClick={start}>
                <UploadCloud className="h-4 w-4" /> Envoyer
              </button>
            )}
            {phase === 'uploading' && (
              <button className="btn-outline" onClick={() => abortRef.current?.abort()}>
                Annuler
              </button>
            )}
          </div>
        </div>
      )}
      <ErrorNote error={error} />
    </div>
  );
}

function FailedList({ errors }) {
  return (
    <details className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
      <summary className="flex cursor-pointer items-center gap-2">
        <AlertTriangle className="h-4 w-4" /> {errors.length} fichier(s) refusé(s)
      </summary>
      <ul className="mt-2 space-y-1 text-xs">
        {errors.slice(0, 50).map((e, i) => (
          <li key={i} className="mono">{e.name} — {e.error}</li>
        ))}
      </ul>
    </details>
  );
}
