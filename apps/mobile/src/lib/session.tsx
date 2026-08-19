import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import * as SecureStore from 'expo-secure-store';
import { api, setAccessToken } from './api';

/**
 * The device session.
 *
 * Same two-token shape as the web app, with one difference that matters: the
 * refresh token goes into the OS keychain (`expo-secure-store`) rather than
 * localStorage. On a phone that is the actual secure storage available, and a
 * long-lived credential in plain AsyncStorage is readable by anything with
 * filesystem access on a rooted device.
 *
 * The access token still lives only in memory, and the API rotates the refresh
 * token on every use.
 */

const REFRESH_KEY = 'cerquita.refresh';
const REFRESH_MARGIN_MS = 60_000;

export interface SessionUser {
  readonly userId: string;
  readonly username: string;
}

export interface SessionState {
  readonly user: SessionUser | null;
  readonly loading: boolean;
  login(email: string, password: string): Promise<void>;
  register(input: {
    email: string;
    password: string;
    username: string;
    displayName: string;
  }): Promise<void>;
  logout(): Promise<void>;
}

const SessionContext = createContext<SessionState | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const refreshToken = useRef<string | undefined>(undefined);

  const clear = useCallback(async () => {
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
    refreshTimer.current = undefined;
    refreshToken.current = undefined;
    setAccessToken(undefined);
    setUser(null);
    await SecureStore.deleteItemAsync(REFRESH_KEY).catch(() => undefined);
  }, []);

  const adopt = useCallback(
    async (
      tokens: { accessToken: string; refreshToken: string; expiresIn: number },
      renew: () => void,
    ) => {
      setAccessToken(tokens.accessToken);
      refreshToken.current = tokens.refreshToken;

      // Keychain writes can fail on a device with no passcode set; the session
      // still works for this launch, it just will not survive a restart.
      await SecureStore.setItemAsync(REFRESH_KEY, tokens.refreshToken).catch(() => undefined);

      if (refreshTimer.current) clearTimeout(refreshTimer.current);
      const delay = Math.max(tokens.expiresIn * 1000 - REFRESH_MARGIN_MS, 15_000);
      refreshTimer.current = setTimeout(renew, delay);
    },
    [],
  );

  const renew = useCallback(async (): Promise<void> => {
    const stored = refreshToken.current;
    if (!stored) {
      await clear();
      return;
    }

    try {
      const tokens = await api.auth.refresh(stored);
      await adopt(tokens, () => void renew());
      setUser(await api.auth.me());
    } catch {
      // An expired or already-rotated token is a normal end of session.
      await clear();
    }
  }, [adopt, clear]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const stored = await SecureStore.getItemAsync(REFRESH_KEY).catch(() => null);
      if (cancelled) return;

      if (!stored) {
        setLoading(false);
        return;
      }

      refreshToken.current = stored;
      await renew();
      if (!cancelled) setLoading(false);
    })();

    return () => {
      cancelled = true;
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
    };
  }, [renew]);

  const login = useCallback(
    async (email: string, password: string) => {
      const tokens = await api.auth.login({ email, password, deviceName: 'Móvil' });
      await adopt(tokens, () => void renew());
      setUser(await api.auth.me());
    },
    [adopt, renew],
  );

  const register = useCallback(
    async (input: { email: string; password: string; username: string; displayName: string }) => {
      const tokens = await api.auth.register(input);
      await adopt(tokens, () => void renew());
      setUser(await api.auth.me());
    },
    [adopt, renew],
  );

  const logout = useCallback(async () => {
    const stored = refreshToken.current;
    await clear();
    if (stored) await api.auth.logout(stored).catch(() => undefined);
  }, [clear]);

  const value = useMemo<SessionState>(
    () => ({ user, loading, login, register, logout }),
    [user, loading, login, register, logout],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionState {
  const context = useContext(SessionContext);
  if (!context) throw new Error('useSession must be used inside <SessionProvider>');
  return context;
}
