export const MODALITIES = {
  CT: 'Scanner', MR: 'IRM', CR: 'Radio', DX: 'Radio', US: 'Écho', MG: 'Mammo',
  XA: 'Angio', NM: 'Médecine nucl.', PT: 'TEP', RF: 'Radioscopie', OT: 'Autre', SC: 'Capture',
};

export const STATUS = {
  new: { label: 'Nouveau', cls: 'bg-sky-50 text-sky-700 ring-sky-200' },
  in_progress: { label: 'En cours', cls: 'bg-amber-50 text-amber-800 ring-amber-200' },
  reported: { label: 'Interprété', cls: 'bg-emerald-50 text-emerald-700 ring-emerald-200' },
};

export const PRIORITY = {
  urgent: { label: 'Urgent', cls: 'bg-orange-50 text-orange-700 ring-orange-200' },
  normal: { label: 'Normal', cls: 'bg-slate-50 text-slate-600 ring-slate-200' },
  low: { label: 'Faible', cls: 'bg-slate-50 text-slate-500 ring-slate-200' },
};

export function fmtDate(d) {
  if (!d) return '—';
  const date = new Date(d.length === 10 ? d + 'T00:00:00' : d);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('fr-DZ', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function fmtDateTime(d) {
  if (!d) return '—';
  return new Date(d).toLocaleString('fr-DZ', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export function ago(d) {
  if (!d) return '';
  const s = (Date.now() - new Date(d).getTime()) / 1000;
  if (s < 60) return "à l'instant";
  if (s < 3600) return `il y a ${Math.floor(s / 60)} min`;
  if (s < 86400) return `il y a ${Math.floor(s / 3600)} h`;
  return `il y a ${Math.floor(s / 86400)} j`;
}

export function age(birth, at) {
  if (!birth) return null;
  const ref = at ? new Date(at) : new Date();
  const a = Math.floor((ref - new Date(birth)) / (365.25 * 864e5));
  return Number.isFinite(a) && a >= 0 ? a : null;
}

export const sexLabel = (s) => ({ M: 'H', F: 'F', O: 'Autre' })[s] || '—';

export function bytes(n) {
  if (n < 1024) return `${n} o`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(0)} Ko`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} Mo`;
  return `${(n / 1024 ** 3).toFixed(2)} Go`;
}
