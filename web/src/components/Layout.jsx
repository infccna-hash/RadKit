import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { LayoutList, Upload, Users, Share2, Building2, LogOut, FolderClock, ShieldCheck, KeyRound } from 'lucide-react';
import { useAuth } from '../lib/auth.jsx';
import { useLoad } from './ui.jsx';
import { api } from '../lib/api.js';

const NAV = {
  radiologist: [
    { to: '/app', label: 'Liste de travail', icon: LayoutList, end: true },
    { to: '/app/upload', label: 'Importer', icon: Upload },
    { to: '/app/patients', label: 'Patients', icon: Users, badge: 'patients' },
    { to: '/app/shares', label: 'Partages', icon: Share2 },
    { to: '/app/clients', label: 'Cliniques', icon: Building2 },
  ],
  client: [
    { to: '/client', label: 'Mes examens', icon: LayoutList, end: true },
    { to: '/client/upload', label: 'Envoyer un examen', icon: Upload },
    { to: '/client/history', label: 'Historique patients', icon: FolderClock },
  ],
  admin: [{ to: '/admin', label: 'Utilisateurs', icon: ShieldCheck, end: true }],
};

export function Logo({ small }) {
  return (
    <div className="flex items-center gap-2">
      <svg viewBox="0 0 32 32" className={small ? 'h-6 w-6' : 'h-8 w-8'}>
        <rect width="32" height="32" rx="8" fill="#167069" />
        <circle cx="16" cy="16" r="7" fill="none" stroke="white" strokeWidth="3" />
        <path d="M16 4v6M16 22v6M4 16h6M22 16h6" stroke="white" strokeWidth="2" opacity=".5" />
      </svg>
      <span className={`font-semibold tracking-tight ${small ? 'text-base' : 'text-lg'}`}>RadKit</span>
    </div>
  );
}

export default function Layout() {
  const { user, logout } = useAuth();
  const nav = useNavigate();
  const stats = useLoad(() => (user.role === 'radiologist' ? api.get('/stats') : Promise.resolve(null)), [user.role]);
  const pendingCount = stats.data ? stats.data.pending_patients + stats.data.merges : 0;

  return (
    <div className="flex min-h-screen">
      <aside className="no-print sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-paper-line bg-white/60 px-3 py-5 md:flex">
        <div className="px-2">
          <Logo />
        </div>
        <nav className="mt-8 flex flex-1 flex-col gap-0.5">
          {NAV[user.role].map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                `flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition ${
                  isActive ? 'bg-brand-50 font-medium text-brand-700' : 'text-ink-soft hover:bg-paper'
                }`
              }
            >
              <item.icon className="h-4 w-4" strokeWidth={1.75} />
              <span className="flex-1">{item.label}</span>
              {item.badge === 'patients' && pendingCount > 0 && (
                <span className="rounded-full bg-amber-100 px-1.5 text-[11px] font-semibold text-amber-800">{pendingCount}</span>
              )}
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-paper-line px-2 pt-4">
          <p className="truncate text-sm font-medium">{user.fullName}</p>
          <p className="truncate text-xs text-ink-mute">{user.organization || user.email}</p>
          <div className="mt-3 flex gap-1">
            <button className="btn-ghost px-2 py-1 text-xs" onClick={() => nav('/password')}>
              <KeyRound className="h-3.5 w-3.5" /> Mot de passe
            </button>
            <button className="btn-ghost px-2 py-1 text-xs" onClick={logout}>
              <LogOut className="h-3.5 w-3.5" /> Sortir
            </button>
          </div>
        </div>
      </aside>

      {/* mobile top bar */}
      <div className="no-print fixed inset-x-0 top-0 z-30 flex items-center justify-between border-b border-paper-line bg-white px-4 py-2.5 md:hidden">
        <Logo small />
        <button className="btn-ghost px-2 py-1 text-xs" onClick={logout}>
          <LogOut className="h-3.5 w-3.5" />
        </button>
      </div>
      <nav className="no-print fixed inset-x-0 bottom-0 z-30 flex justify-around border-t border-paper-line bg-white py-1.5 md:hidden">
        {NAV[user.role].map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) => `flex flex-col items-center gap-0.5 px-2 py-1 text-[10px] ${isActive ? 'text-brand-700' : 'text-ink-mute'}`}
          >
            <item.icon className="h-5 w-5" strokeWidth={1.75} />
            {item.label.split(' ')[0]}
          </NavLink>
        ))}
      </nav>

      <main className="min-w-0 flex-1 px-4 pb-24 pt-16 md:px-8 md:pb-10 md:pt-8">
        <div className="mx-auto max-w-6xl">
          <Outlet context={{ refreshStats: stats.reload }} />
        </div>
      </main>
    </div>
  );
}
