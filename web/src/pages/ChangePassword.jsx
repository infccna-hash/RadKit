import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useAuth, homeFor } from '../lib/auth.jsx';
import { api } from '../lib/api.js';
import { Logo } from '../components/Layout.jsx';
import { ErrorNote, PageLoader, useToast } from '../components/ui.jsx';

export default function ChangePassword() {
  const { user, refresh } = useAuth();
  const nav = useNavigate();
  const toast = useToast();
  const [f, setF] = useState({ current: '', next: '', confirm: '' });
  const [error, setError] = useState(null);

  if (user === undefined) return <PageLoader />;
  if (!user) return <Navigate to="/login" replace />;

  async function submit(e) {
    e.preventDefault();
    if (f.next !== f.confirm) return setError('Les deux mots de passe ne correspondent pas');
    try {
      await api.post('/auth/password', { current: f.current, next: f.next });
      await refresh();
      toast('Mot de passe modifié');
      nav(homeFor(user.role));
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-6">
      <form onSubmit={submit} className="card w-full max-w-sm p-7">
        <Logo />
        <h2 className="mt-6 text-lg font-semibold">{user.mustChangePassword ? 'Choisissez votre mot de passe' : 'Changer le mot de passe'}</h2>
        {user.mustChangePassword && <p className="mt-1 text-sm text-ink-mute">Le mot de passe provisoire doit être remplacé avant de continuer.</p>}
        <div className="mt-5 space-y-3">
          {[
            ['current', 'Mot de passe actuel', 'current-password'],
            ['next', 'Nouveau (10 caractères min.)', 'new-password'],
            ['confirm', 'Confirmer', 'new-password'],
          ].map(([k, l, ac]) => (
            <label key={k} className="block">
              <span className="label">{l}</span>
              <input className="input" type="password" autoComplete={ac} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} required minLength={k === 'current' ? 1 : 10} />
            </label>
          ))}
          <ErrorNote error={error} />
          <button className="btn-primary w-full">Enregistrer</button>
          {!user.mustChangePassword && (
            <button type="button" className="btn-ghost w-full" onClick={() => nav(-1)}>
              Retour
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
