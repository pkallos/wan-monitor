import { Effect } from "effect";
import type { ReactNode } from "react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { runEffectWithError } from "@/api/effect-bridge";
import { WanMonitorClient } from "@/api/effect-client";
import { TOKEN_KEY } from "@/constants/auth";

interface AuthState {
  isAuthenticated: boolean;
  isLoading: boolean;
  username: string | null;
  authRequired: boolean;
}

interface AuthContextValue extends AuthState {
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  checkAuth: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({
    isAuthenticated: false,
    isLoading: true,
    username: null,
    authRequired: false,
  });

  const retryRef = useRef<{ timeoutId: number | null; attempt: number }>({
    timeoutId: null,
    attempt: 0,
  });

  const clearRetry = useCallback(() => {
    const { timeoutId } = retryRef.current;
    if (timeoutId !== null) {
      window.clearTimeout(timeoutId);
    }
    retryRef.current.timeoutId = null;
    retryRef.current.attempt = 0;
  }, []);

  const checkAuth = useCallback(async () => {
    try {
      // First check if auth is required
      const statusResponse = await runEffectWithError(
        Effect.gen(function* () {
          const client = yield* WanMonitorClient;
          return yield* client.auth.status();
        })
      );

      clearRetry();

      if (!statusResponse.authRequired) {
        setState({
          isAuthenticated: true,
          isLoading: false,
          username: null,
          authRequired: false,
        });
        return;
      }

      // Auth is required, check if we have a valid token
      const token = localStorage.getItem(TOKEN_KEY);
      if (!token) {
        setState({
          isAuthenticated: false,
          isLoading: false,
          username: null,
          authRequired: true,
        });
        return;
      }

      // Verify token with server
      const meResponse = await runEffectWithError(
        Effect.gen(function* () {
          const client = yield* WanMonitorClient;
          return yield* client.auth.me();
        })
      );
      setState({
        isAuthenticated: meResponse.authenticated,
        isLoading: false,
        username: meResponse.username,
        authRequired: true,
      });
    } catch {
      localStorage.removeItem(TOKEN_KEY);
      setState((prev) => ({
        isAuthenticated: !prev.authRequired,
        isLoading: false,
        username: null,
        authRequired: prev.authRequired,
      }));

      if (retryRef.current.timeoutId === null) {
        const attempt = retryRef.current.attempt;
        const delay = Math.min(30_000, 1000 * 2 ** attempt);
        retryRef.current.attempt = attempt + 1;

        retryRef.current.timeoutId = window.setTimeout(() => {
          retryRef.current.timeoutId = null;
          checkAuth();
        }, delay);
      }
    }
  }, [clearRetry]);

  const login = useCallback(async (username: string, password: string) => {
    const response = await runEffectWithError(
      Effect.gen(function* () {
        const client = yield* WanMonitorClient;
        return yield* client.auth.login({
          payload: {
            username,
            password,
          },
        });
      })
    );

    localStorage.setItem(TOKEN_KEY, response.token);
    setState({
      isAuthenticated: true,
      isLoading: false,
      username: response.username,
      authRequired: true,
    });
  }, []);

  const logout = useCallback(async () => {
    try {
      await runEffectWithError(
        Effect.gen(function* () {
          const client = yield* WanMonitorClient;
          return yield* client.auth.logout();
        })
      );
    } finally {
      localStorage.removeItem(TOKEN_KEY);
      setState({
        isAuthenticated: false,
        isLoading: false,
        username: null,
        authRequired: true,
      });
    }
  }, []);

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  useEffect(() => clearRetry, [clearRetry]);

  const value = useMemo(
    () => ({
      ...state,
      login,
      logout,
      checkAuth,
    }),
    [state, login, logout, checkAuth]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
