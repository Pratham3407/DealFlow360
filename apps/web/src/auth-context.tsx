/** Auth context — minimal, only what the routes need. */

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { clearSession, loadSession, login as apiLogin, logout as apiLogout, type Session } from './api.js';

interface AuthContext {
  session: Session | null;
  setSession: (s: Session | null) => void;
  login: (email: string, password: string) => Promise<Session>;
  logout: () => void;
}

const Context = createContext<AuthContext | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(() => loadSession());
  const navigate = useNavigate();

  useEffect(() => {
    const onStorage = () => setSession(loadSession());
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const value: AuthContext = {
    session,
    setSession: (s) => {
      setSession(s);
      if (!s) navigate('/login', { replace: true });
    },
    login: async (email, password) => {
      const next = await apiLogin(email, password);
      setSession(next);
      return next;
    },
    logout: () => {
      apiLogout();
      setSession(null);
      navigate('/login', { replace: true });
    },
  };

  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useAuth(): AuthContext {
  const ctx = useContext(Context);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}

export function clearStoredSession(): void {
  clearSession();
}
