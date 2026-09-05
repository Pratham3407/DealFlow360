import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from './api';
import type { AuthProfile, Capability } from './types';

const ME_QUERY_KEY = ['auth', 'me'] as const;

/**
 * A 401 from /auth/me means "not signed in", which is an expected state rather
 * than an error. Anything else genuinely failed and should surface.
 */
async function fetchProfile(): Promise<AuthProfile | null> {
  try {
    return await api<AuthProfile>('/auth/me');
  } catch (error) {
    if (error instanceof ApiError && error.isUnauthenticated) return null;
    throw error;
  }
}

export type LoginSurface = 'internal' | 'portal';

interface LoginInput {
  email: string;
  password: string;
  surface: LoginSurface;
}

interface AuthContextValue {
  profile: AuthProfile | null;
  /** True only while the initial session check is in flight. */
  isLoading: boolean;
  /** Set when the session check itself failed, e.g. the API is unreachable. */
  error: ApiError | null;
  login: (input: LoginInput) => Promise<AuthProfile>;
  logout: () => Promise<void>;
  isLoggingIn: boolean;
  isLoggingOut: boolean;
  can: (capability: Capability) => boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }): ReactNode {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ME_QUERY_KEY,
    queryFn: fetchProfile,
    // An expired session should not be retried; it will not recover.
    retry: false,
    staleTime: 30_000,
  });

  const loginMutation = useMutation({
    mutationFn: ({ email, password, surface }: LoginInput) =>
      api<AuthProfile>(surface === 'portal' ? '/portal/auth/login' : '/auth/login', {
        method: 'POST',
        body: { email, password },
      }),
    onSuccess: (profile) => {
      // Seed the cache so the app renders without a second round trip.
      queryClient.setQueryData(ME_QUERY_KEY, profile);
    },
  });

  const logoutMutation = useMutation({
    mutationFn: () => api<void>('/auth/logout', { method: 'POST' }),
    onSettled: async () => {
      // Drop every cached response: the next user must not see the previous
      // user's data, and the session may be gone even if logout errored.
      queryClient.setQueryData(ME_QUERY_KEY, null);
      await queryClient.resetQueries();
    },
  });

  const login = useCallback(
    (input: LoginInput) => loginMutation.mutateAsync(input),
    [loginMutation],
  );

  const logout = useCallback(async () => {
    await logoutMutation.mutateAsync();
  }, [logoutMutation]);

  const profile = query.data ?? null;

  const value = useMemo<AuthContextValue>(
    () => ({
      profile,
      isLoading: query.isLoading,
      error: query.error instanceof ApiError ? query.error : null,
      login,
      logout,
      isLoggingIn: loginMutation.isPending,
      isLoggingOut: logoutMutation.isPending,
      can: (capability) => profile?.capabilities.includes(capability) ?? false,
    }),
    [profile, query.isLoading, query.error, login, logout, loginMutation.isPending, logoutMutation.isPending],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside <AuthProvider>');
  return context;
}
