import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Building2, Plus, Copy, Unlink } from 'lucide-react';
import { api } from '../../lib/api.js';
import { ago } from '../../lib/format.js';
import { useLoad, PageHeader, PageLoader, Empty, Modal, Field, ErrorNote, useToast } from '../../components/ui.jsx';

export default function Clients() {
  const toast = useToast();
  const { data, loading, reload } = useLoad(() => api.get('/clients'), []);
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ organization: '', fullName: '', email: '', phone: '' });
  const [created, setCreated] = useState(null);
  const [error, setError] = useState(null);

  async function submit() {
    setError(null);
    try {
      const r = await api.post('/clients', f);
      setCreated({ ...r, email: f.email });
      reload();
    } catch (e) {
      setError(e.message);
    }
  }
  async function unlink(c) {
    if (!confirm(`Détacher ${c.organization} ? Elle ne pourra plus vous envoyer d'examens (l'historique est conservé).`)) return;
    await api.del(`/clients/${c.id}`);
    toast('Clinique détachée');
    reload();
  }
  const close = () => {
    setOpen(false);
    setCreated(null);
    setF({ organization: '', fullName: '', email: '', phone: '' });
  };
  const credentials = created && `Accès RadKit\n${window.location.origin}\nEmail : ${created.email}\nMot de passe provisoire : ${created.tempPassword}`;

  return (
    <>
      <PageHeader
        title="Cliniques"
        subtitle="Les établissements qui vous envoient des examens. Ils voient leur historique et vos comptes rendus validés."
        actions={<button className="btn-primary" onClick={() => setOpen(true)}><Plus className="h-4 w-4" /> Ajouter une clinique</button>}
      />
      <div className="card">
        {loading && !data ? (
          <PageLoader />
        ) : !data.clients.length ? (
          <Empty icon={Building2} title="Aucune clinique">Créez un accès pour qu'une clinique ou un cabinet vous envoie ses examens.</Empty>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-paper-line">
                <th className="table-head px-4 py-2.5">Établissement</th>
                <th className="table-head px-3 py-2.5">Contact</th>
                <th className="table-head px-3 py-2.5">Examens</th>
                <th className="table-head px-3 py-2.5">Dernière connexion</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.clients.map((c) => (
                <tr key={c.id} className="border-b border-paper-line/70 last:border-0">
                  <td className="px-4 py-3 font-medium">{c.organization}</td>
                  <td className="px-3 py-3 text-ink-soft">{c.full_name}<div className="text-xs text-ink-mute">{c.email}{c.phone && ` · ${c.phone}`}</div></td>
                  <td className="px-3 py-3">
                    <Link to={`/app?client=${c.id}`} className="tabular-nums">{c.studies}</Link>
                    {c.open_studies > 0 && <span className="ml-2 text-xs text-amber-700">{c.open_studies} en attente</span>}
                  </td>
                  <td className="px-3 py-3 text-ink-mute">{c.last_login_at ? ago(c.last_login_at) : 'jamais'}</td>
                  <td className="px-3 py-3 text-right">
                    <button className="btn-ghost px-2 py-1" title="Détacher" onClick={() => unlink(c)}><Unlink className="h-4 w-4" /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <Modal open={open} onClose={close} title={created ? 'Accès créé' : 'Nouvelle clinique'}
        footer={created ? <button className="btn-primary" onClick={close}>Terminé</button> : <><button className="btn-ghost" onClick={close}>Annuler</button><button className="btn-primary" onClick={submit}>Créer l'accès</button></>}>
        {created ? (
          created.created ? (
            <div className="space-y-3">
              <p className="text-sm text-ink-soft">Transmettez ces identifiants à la clinique. Le mot de passe ne sera plus affiché.</p>
              <pre className="mono whitespace-pre-wrap rounded-lg bg-paper p-3">{credentials}</pre>
              <button className="btn-outline w-full" onClick={() => navigator.clipboard.writeText(credentials).then(() => toast('Copié'))}><Copy className="h-4 w-4" /> Copier</button>
            </div>
          ) : (
            <p className="text-sm text-ink-soft">Ce compte clinique existait déjà : il est maintenant rattaché à vous et peut vous envoyer des examens.</p>
          )
        ) : (
          <div className="space-y-3">
            <Field label="Établissement"><input className="input" placeholder="Clinique El Amel" value={f.organization} onChange={(e) => setF({ ...f, organization: e.target.value })} /></Field>
            <Field label="Nom du contact"><input className="input" value={f.fullName} onChange={(e) => setF({ ...f, fullName: e.target.value })} /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Email (identifiant)"><input className="input" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
              <Field label="Téléphone"><input className="input" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
            </div>
            <ErrorNote error={error} />
          </div>
        )}
      </Modal>
    </>
  );
}
