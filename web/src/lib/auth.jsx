import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api } from './api.js';

const AuthCtx = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(undefined); // undefined = loading, null = logged out
  const [config, setConfig] = useState({ aiEnabled: false });

  const refresh = useCallback(async () => {
    try {
      const r = await api.get('/auth/me');
      setUser(r.user);
    } catch {
      setUser(null);
    }
  }, []);

  useEffect(() => {
    refresh();
    api.get('/config').then(setConfig).catch(() => {});
    const onUnauth = () => setUser(null);
    window.addEventListener('rk:unauthorized', onUnauth);
    return () => window.removeEventListener('rk:unauthorized', onUnauth);
  }, [refresh]);

  const login = async (email, password) => {
    const r = await api.post('/auth/login', { email, password });
    setUser(r.user);
    return r.user;
  };
  const logout = async () => {
    await api.post('/auth/logout').catch(() => {});
    setUser(null);
  };

  return <AuthCtx.Provider value={{ user, config, login, logout, refresh }}>{children}</AuthCtx.Provider>;
}

export const useAuth = () => useContext(AuthCtx);

export const homeFor = (role) => ({ admin: '/admin', radiologist: '/app', client: '/client' })[role] || '/';
