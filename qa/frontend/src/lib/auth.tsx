import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { api, clearTokens, getAccessToken, setTokens } from "./apiClient";
import { can as canAct } from "./rbac";
import type { AuthResponse, Role, User } from "./types";

type Permission = Parameters<typeof canAct>[1];

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<User>;
  register: (args: {
    email: string;
    password: string;
    full_name: string;
    organization_name?: string;
  }) => Promise<User>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
  can: (perm: Permission) => boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const loadUser = useCallback(async () => {
    if (!getAccessToken()) {
      setLoading(false);
      return;
    }
    try {
      const me = await api.get<User>("/auth/me");
      setUser(me);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadUser();
  }, [loadUser]);

  const login = useCallback(
    async (email: string, password: string) => {
      const res = await api.post<AuthResponse>(
        "/auth/login",
        { email, password },
        { auth: false },
      );
      setTokens(res.accessToken, res.refreshToken);
      setUser(res.user);
      return res.user;
    },
    [],
  );

  const register = useCallback(
    async (args: {
      email: string;
      password: string;
      full_name: string;
      organization_name?: string;
    }) => {
      const res = await api.post<AuthResponse>("/auth/register", args, {
        auth: false,
      });
      setTokens(res.accessToken, res.refreshToken);
      setUser(res.user);
      return res.user;
    },
    [],
  );

  const logout = useCallback(async () => {
    try {
      await api.post("/auth/logout");
    } catch {
      /* ignore */
    }
    clearTokens();
    setUser(null);
  }, []);

  const refreshUser = useCallback(async () => {
    await loadUser();
  }, [loadUser]);

  const can = useCallback(
    (perm: Permission) => {
      if (!user) return false;
      return canAct(user.role as Role, perm);
    },
    [user],
  );

  const value = useMemo<AuthContextValue>(
    () => ({ user, loading, login, register, logout, refreshUser, can }),
    [user, loading, login, register, logout, refreshUser, can],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
