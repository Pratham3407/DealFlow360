/** Auth context — minimal, only what the routes need. */

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, clearSession, loadSession, login as apiLogin, logout as apiLogout, type Session } from './api.js';

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
    const onAuthCleared = () => {
      setSession(null);
      navigate('/login', { replace: true });
    };
    window.addEventListener('storage', onStorage);
    window.addEventListener('dealflow:auth-cleared', onAuthCleared);

    if (session?.token) {
      api<{ user: unknown }>('/api/auth/me').catch(() => {
        // If the session token is expired or the user no longer exists,
        // api() calls clearSession() on 401, firing onAuthCleared.
      });
    }

    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('dealflow:auth-cleared', onAuthCleared);
    };
  }, [navigate]);

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
