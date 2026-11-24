import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { Loader2, X, CheckCircle2, AlertTriangle } from 'lucide-react';
import { STATUS, PRIORITY, MODALITIES } from '../lib/format.js';

export function Badge({ className = '', children }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium ring-1 ring-inset ${className}`}>
      {children}
    </span>
  );
}

export const StatusBadge = ({ status }) => <Badge className={STATUS[status]?.cls}>{STATUS[status]?.label || status}</Badge>;
export const PriorityBadge = ({ priority }) =>
  priority === 'normal' ? null : <Badge className={PRIORITY[priority]?.cls}>{PRIORITY[priority]?.label}</Badge>;

export function ModalityChips({ modalities = [] }) {
  return (
    <span className="inline-flex flex-wrap gap-1">
      {modalities.map((m) => (
        <span key={m} title={MODALITIES[m] || m} className="mono rounded bg-ink/[0.06] px-1.5 py-0.5 font-medium text-ink-soft">
          {m}
        </span>
      ))}
    </span>
  );
}

export function Spinner({ className = 'h-4 w-4' }) {
  return <Loader2 className={`animate-spin ${className}`} />;
}

export function PageLoader() {
  return (
    <div className="flex h-64 items-center justify-center text-ink-mute">
      <Spinner className="h-6 w-6" />
    </div>
  );
}

export function Empty({ icon: Icon, title, children }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      {Icon && <Icon className="mb-3 h-8 w-8 text-ink-mute/60" strokeWidth={1.5} />}
      <p className="font-medium text-ink">{title}</p>
      {children && <div className="mt-1 max-w-sm text-sm text-ink-mute">{children}</div>}
    </div>
  );
}

export function PageHeader({ title, subtitle, actions }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-ink-mute">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Modal({ open, onClose, title, children, footer, wide }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => e.key === 'Escape' && onClose?.();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink/30 p-4 pt-[10vh]" onMouseDown={onClose}>
      <div className={`card w-full ${wide ? 'max-w-2xl' : 'max-w-md'}`} onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-paper-line px-5 py-3.5">
          <h2 className="font-semibold">{title}</h2>
          <button className="btn-ghost -mr-2 p-1.5" onClick={onClose} aria-label="Fermer">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="px-5 py-4">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-paper-line px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}

export function Field({ label, children, hint }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-ink-mute">{hint}</span>}
    </label>
  );
}

export function ErrorNote({ error }) {
  if (!error) return null;
  return (
    <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
      <span>{typeof error === 'string' ? error : error.message}</span>
    </div>
  );
}

// ---- Toasts ----
const ToastCtx = createContext(() => {});
export function ToastProvider({ children }) {
  const [items, setItems] = useState([]);
  const push = useCallback((msg, kind = 'ok') => {
    const id = Math.random();
    setItems((x) => [...x, { id, msg, kind }]);
    setTimeout(() => setItems((x) => x.filter((i) => i.id !== id)), 3800);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="no-print fixed bottom-4 right-4 z-[60] flex flex-col gap-2">
        {items.map((t) => (
          <div
            key={t.id}
            className={`flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm shadow-lg ${
              t.kind === 'error' ? 'bg-red-700 text-white' : 'bg-ink text-white'
            }`}
          >
            {t.kind === 'error' ? <AlertTriangle className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4 text-brand-100" />}
            {t.msg}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);

/** Small data-loading hook */
export function useLoad(fn, deps = []) {
  const [state, setState] = useState({ data: null, error: null, loading: true });
  const reload = useCallback(async () => {
    setState((s) => ({ ...s, loading: true }));
    try {
      setState({ data: await fn(), error: null, loading: false });
    } catch (e) {
      setState({ data: null, error: e, loading: false });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => {
    reload();
  }, [reload]);
  return { ...state, reload };
}

/** Preparation status of a share's anonymized copy */
export function ShareStatus({ status, error }) {
  if (status === 'preparing')
    return (
      <span className="inline-flex items-center gap-1 rounded-md bg-sky-50 px-1.5 py-0.5 text-[11px] font-medium text-sky-700 ring-1 ring-inset ring-sky-200">
        <Loader2 className="h-3 w-3 animate-spin" /> En préparation
      </span>
    );
  if (status === 'failed')
    return <Badge className="bg-red-50 text-red-700 ring-red-200"><span title={error || ''}>Échec</span></Badge>;
  return null;
}
