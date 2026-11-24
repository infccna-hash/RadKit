import { useState } from 'react';
import { Plus, Copy, KeyRound, Power } from 'lucide-react';
import { api } from '../../lib/api.js';
import { ago, fmtDateTime } from '../../lib/format.js';
import { useLoad, PageHeader, PageLoader, Modal, Field, ErrorNote, Badge, useToast } from '../../components/ui.jsx';

const ROLE = { admin: 'Admin', radiologist: 'Radiologue', client: 'Clinique' };

export default function AdminUsers() {
  const toast = useToast();
  const [tab, setTab] = useState('users');
  const users = useLoad(() => api.get('/admin/users'), []);
  const audit = useLoad(() => (tab === 'audit' ? api.get('/admin/audit') : Promise.resolve(null)), [tab]);
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ fullName: '', email: '', role: 'radiologist', organization: '' });
  const [secret, setSecret] = useState(null);
  const [error, setError] = useState(null);

  async function create() {
    setError(null);
    try {
      const r = await api.post('/admin/users', f);
      setSecret({ email: f.email, pw: r.tempPassword });
      setOpen(false);
      setF({ fullName: '', email: '', role: 'radiologist', organization: '' });
      users.reload();
    } catch (e) {
      setError(e.message);
    }
  }
  async function toggle(u) {
    try {
      await api.patch(`/admin/users/${u.id}`, { active: !u.active });
      users.reload();
    } catch (e) {
      toast(e.message, 'error');
    }
  }
  async function reset(u) {
    const r = await api.patch(`/admin/users/${u.id}`, { resetPassword: true });
    setSecret({ email: u.email, pw: r.tempPassword });
  }

  return (
    <>
      <PageHeader title="Administration" actions={tab === 'users' && <button className="btn-primary" onClick={() => setOpen(true)}><Plus className="h-4 w-4" /> Nouveau compte</button>} />
      <div className="mb-4 flex gap-1 border-b border-paper-line">
        {[['users', 'Comptes'], ['audit', "Journal d'accès"]].map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)} className={`-mb-px border-b-2 px-3 py-2 text-sm ${tab === k ? 'border-brand-600 font-medium' : 'border-transparent text-ink-mute'}`}>{l}</button>
        ))}
      </div>

      {tab === 'users' && (
        <div className="card overflow-x-auto">
          {users.loading && !users.data ? <PageLoader /> : (
            <table className="w-full text-sm">
              <thead><tr className="border-b border-paper-line">
                <th className="table-head px-4 py-2.5">Nom</th><th className="table-head px-3 py-2.5">Rôle</th>
                <th className="table-head px-3 py-2.5">Examens</th><th className="table-head px-3 py-2.5">Connexion</th><th />
              </tr></thead>
              <tbody>
                {users.data.users.map((u) => (
                  <tr key={u.id} className={`border-b border-paper-line/70 last:border-0 ${u.active ? '' : 'opacity-50'}`}>
                    <td className="px-4 py-3"><p className="font-medium">{u.full_name}</p><p className="text-xs text-ink-mute">{u.email}{u.organization && ` · ${u.organization}`}</p></td>
                    <td className="px-3 py-3"><Badge className="bg-paper text-ink-soft ring-paper-line">{ROLE[u.role]}</Badge></td>
                    <td className="px-3 py-3 tabular-nums">{u.role === 'radiologist' ? u.studies : '—'}</td>
                    <td className="px-3 py-3 text-ink-mute">{u.last_login_at ? ago(u.last_login_at) : 'jamais'}</td>
                    <td className="px-3 py-3 text-right whitespace-nowrap">
                      <button className="btn-ghost px-2 py-1" title="Réinitialiser le mot de passe" onClick={() => reset(u)}><KeyRound className="h-4 w-4" /></button>
                      <button className="btn-ghost px-2 py-1" title={u.active ? 'Désactiver' : 'Réactiver'} onClick={() => toggle(u)}><Power className="h-4 w-4" /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {tab === 'audit' && (
        <div className="card overflow-x-auto">
          {audit.loading || !audit.data ? <PageLoader /> : (
            <table className="w-full text-xs">
              <thead><tr className="border-b border-paper-line">
                <th className="table-head px-4 py-2">Date</th><th className="table-head px-3 py-2">Utilisateur</th>
                <th className="table-head px-3 py-2">Action</th><th className="table-head px-3 py-2">Cible</th><th className="table-head px-3 py-2">IP</th>
              </tr></thead>
              <tbody>
                {audit.data.entries.map((a) => (
                  <tr key={a.id} className="border-b border-paper-line/60">
                    <td className="whitespace-nowrap px-4 py-1.5 text-ink-mute">{fmtDateTime(a.at)}</td>
                    <td className="px-3 py-1.5">{a.email || '—'}</td>
                    <td className="mono px-3 py-1.5">{a.action}</td>
                    <td className="mono px-3 py-1.5 text-ink-mute">{a.target?.slice(0, 13)}</td>
                    <td className="mono px-3 py-1.5 text-ink-mute">{a.ip}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title="Nouveau compte"
        footer={<><button className="btn-ghost" onClick={() => setOpen(false)}>Annuler</button><button className="btn-primary" onClick={create}>Créer</button></>}>
        <div className="space-y-3">
          <Field label="Nom complet"><input className="input" value={f.fullName} onChange={(e) => setF({ ...f, fullName: e.target.value })} /></Field>
          <Field label="Email"><input className="input" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Rôle">
              <select className="input" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}>
                <option value="radiologist">Radiologue</option><option value="client">Clinique</option><option value="admin">Admin</option>
              </select>
            </Field>
            <Field label="Établissement"><input className="input" value={f.organization} onChange={(e) => setF({ ...f, organization: e.target.value })} /></Field>
          </div>
          <ErrorNote error={error} />
        </div>
      </Modal>

      <Modal open={Boolean(secret)} onClose={() => setSecret(null)} title="Mot de passe provisoire" footer={<button className="btn-primary" onClick={() => setSecret(null)}>Fermé</button>}>
        <p className="mb-2 text-sm text-ink-soft">À transmettre à {secret?.email}. Il devra le changer à la première connexion.</p>
        <div className="flex gap-2">
          <input readOnly className="input mono" value={secret?.pw || ''} onFocus={(e) => e.target.select()} />
          <button className="btn-outline" onClick={() => navigator.clipboard.writeText(secret.pw).then(() => toast('Copié'))}><Copy className="h-4 w-4" /></button>
        </div>
      </Modal>
    </>
  );
}
