import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useNavigate } from 'react-router-dom';
import {
  api,
  clearTokens,
  getRefreshToken,
  refreshAccessToken,
  setAccessToken,
  setRefreshToken,
  setUnauthorizedHandler,
  toApiError,
} from '../lib/api';
import type {
  AuthResponse,
  ChangePasswordPayload,
  LoginPayload,
  RegisterPayload,
  UpdateProfilePayload,
  User,
} from '../types';

interface AuthContextValue {
  user: User | null;
  /** True until the stored refresh token has been exchanged (or proven dead). */
  isBootstrapping: boolean;
  isAuthenticated: boolean;
  login: (payload: LoginPayload) => Promise<void>;
  register: (payload: RegisterPayload) => Promise<void>;
  logout: () => Promise<void>;
  updateProfile: (payload: UpdateProfilePayload) => Promise<User>;
  changePassword: (payload: ChangePasswordPayload) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isBootstrapping, setIsBootstrapping] = useState(true);
  const navigate = useNavigate();

  const applySession = useCallback((response: AuthResponse) => {
    setAccessToken(response.access);
    setRefreshToken(response.refresh);
    setUser(response.user);
  }, []);

  /* Restore the session once on mount: refresh → /auth/me/ (architecture §6.1). */
  useEffect(() => {
    let cancelled = false;

    const bootstrap = async (): Promise<void> => {
      if (!getRefreshToken()) {
        setIsBootstrapping(false);
        return;
      }
      try {
        await refreshAccessToken();
        const { data } = await api.get<User>('/auth/me/');
        if (!cancelled) setUser(data);
      } catch {
        clearTokens();
        if (!cancelled) setUser(null);
      } finally {
        if (!cancelled) setIsBootstrapping(false);
      }
    };

    void bootstrap();
    return () => {
      cancelled = true;
    };
  }, []);

  /* The axios layer calls this when a refresh fails: drop state and go to /login. */
  useEffect(() => {
    setUnauthorizedHandler(() => {
      setUser(null);
      setIsBootstrapping(false);
      navigate('/login', { replace: true });
    });
    return () => setUnauthorizedHandler(null);
  }, [navigate]);

  const login = useCallback(
    async (payload: LoginPayload) => {
      const { data } = await api.post<AuthResponse>('/auth/login/', payload);
      applySession(data);
    },
    [applySession],
  );

  const register = useCallback(
    async (payload: RegisterPayload) => {
      const { data } = await api.post<AuthResponse>('/auth/register/', payload);
      applySession(data);
    },
    [applySession],
  );

  const logout = useCallback(async () => {
    const refresh = getRefreshToken();
    let failure: unknown = null;
    try {
      if (refresh) await api.post('/auth/logout/', { refresh });
    } catch (error) {
      failure = error;
    } finally {
      clearTokens();
      setUser(null);
    }
    // The local session is already gone; surface the server error so the caller
    // can toast it without blocking the sign-out.
    if (failure) throw toApiError(failure);
  }, []);

  const updateProfile = useCallback(
    async (payload: UpdateProfilePayload) => {
      const { data } = await api.patch<User>('/auth/me/', payload);
      setUser(data);
      return data;
    },
    [],
  );

  const changePassword = useCallback(async (payload: ChangePasswordPayload) => {
    await api.post('/auth/password/change/', payload);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      isBootstrapping,
      isAuthenticated: user !== null,
      login,
      register,
      logout,
      updateProfile,
      changePassword,
    }),
    [
      user,
      isBootstrapping,
      login,
      register,
      logout,
      updateProfile,
      changePassword,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used inside <AuthProvider>');
  }
  return context;
}
