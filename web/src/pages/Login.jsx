import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useAuth, homeFor } from '../lib/auth.jsx';
import { Logo } from '../components/Layout.jsx';
import { ErrorNote, Spinner } from '../components/ui.jsx';

export default function Login() {
  const { user, login } = useAuth();
  const nav = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to={user.mustChangePassword ? '/password' : homeFor(user.role)} replace />;

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const u = await login(email, password);
      nav(u.mustChangePassword ? '/password' : homeFor(u.role));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid min-h-screen md:grid-cols-[1fr_minmax(420px,520px)]">
      <section className="relative hidden overflow-hidden bg-[#0f2a2c] p-12 text-white md:flex md:flex-col md:justify-between">
        <svg className="absolute -right-24 -top-24 h-[560px] w-[560px] opacity-[0.12]" viewBox="0 0 200 200">
          {[90, 70, 50, 30].map((r) => (
            <circle key={r} cx="100" cy="100" r={r} fill="none" stroke="white" strokeWidth="0.6" />
          ))}
          <path d="M100 0v200M0 100h200" stroke="white" strokeWidth="0.4" />
        </svg>
        <div className="flex items-center gap-2 text-lg font-semibold">RadKit</div>
        <div className="relative max-w-md">
          <h1 className="text-3xl font-semibold leading-tight">L'espace de travail du radiologue.</h1>
          <p className="mt-4 text-white/70">
            Importez vos examens en un geste, laissez les dossiers patients se créer seuls, partagez un cas anonymisé
            avec un confrère et rendez vos comptes rendus aux cliniques.
          </p>
        </div>
        <p className="relative text-xs text-white/40">Hébergé sur votre serveur · conçu dans l'esprit de la loi 18-07</p>
      </section>

      <section className="flex items-center justify-center px-6 py-12">
        <form onSubmit={submit} className="w-full max-w-sm">
          <Logo />
          <h2 className="mt-8 text-xl font-semibold">Connexion</h2>
          <p className="mt-1 text-sm text-ink-mute">Radiologues, cliniques et administrateurs.</p>
          <div className="mt-6 space-y-4">
            <label className="block">
              <span className="label">Email</span>
              <input className="input" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </label>
            <label className="block">
              <span className="label">Mot de passe</span>
              <input className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            </label>
            <ErrorNote error={error} />
            <button className="btn-primary w-full py-2.5" disabled={busy}>
              {busy && <Spinner />} Se connecter
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
