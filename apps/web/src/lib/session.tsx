'use client';

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
import { api, setAccessToken } from './api';

/**
 * The browser session.
 *
 * Two tokens with two different lifetimes and two different homes:
 *
 * - the ACCESS token lives in memory only. It is sent on every request, so an
 *   injected script that can read storage would get a working credential; in a
 *   module variable it dies with the tab.
 * - the REFRESH token lives in `localStorage`, because the session has to
 *   survive a reload and there is nowhere else a browser can keep it. The API
 *   rotates it on every use, so a stolen one stops working as soon as the real
 *   client refreshes — which is the mitigation that actually matters here.
 *
 * Everything social in Cerquita is resolved per viewer: friend pricing, "amiga
 * de Nacho", who can see an exact address. Without a session the whole product
 * renders as if you knew nobody, so this provider sits above the entire app.
 */

const REFRESH_STORAGE_KEY = 'cerquita.refresh';

/** Refresh this long before the access token actually expires. */
const REFRESH_MARGIN_MS = 60_000;

export interface SessionUser {
  readonly userId: string;
  readonly username: string;
}

export interface SessionState {
  readonly user: SessionUser | null;
  /** True until the initial refresh attempt settles — not "logged out". */
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

  // Kept in a ref rather than state: nothing renders from it, and a re-render
  // between "token issued" and "timer armed" would be a window with no refresh.
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const refreshToken = useRef<string | undefined>(undefined);

  const clear = useCallback(() => {
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
    refreshTimer.current = undefined;
    refreshToken.current = undefined;
    setAccessToken(undefined);
    setUser(null);
    try {
      window.localStorage.removeItem(REFRESH_STORAGE_KEY);
    } catch {
      // Private mode and blocked storage both throw. The session still works
      // for this tab; it just will not survive a reload.
    }
  }, []);

  /**
   * Adopt a freshly issued token pair.
   *
   * `renew` is passed in rather than imported so the scheduled refresh can call
   * back into the same function without a circular definition.
   */
  const adopt = useCallback(
    (
      tokens: { accessToken: string; refreshToken: string; expiresIn: number },
      renew: () => void,
    ) => {
      setAccessToken(tokens.accessToken);
      refreshToken.current = tokens.refreshToken;

      try {
        window.localStorage.setItem(REFRESH_STORAGE_KEY, tokens.refreshToken);
      } catch {
        // See above: storage being unavailable is not a login failure.
      }

      if (refreshTimer.current) clearTimeout(refreshTimer.current);
      // `expiresIn` is seconds. Renewing early means a request never races the
      // expiry; the floor stops a short-lived token from spinning the timer.
      const delay = Math.max(tokens.expiresIn * 1000 - REFRESH_MARGIN_MS, 15_000);
      refreshTimer.current = setTimeout(renew, delay);
    },
    [],
  );

  const renew = useCallback(async (): Promise<void> => {
    const stored = refreshToken.current;
    if (!stored) {
      clear();
      return;
    }

    try {
      const tokens = await api.auth.refresh(stored);
      adopt(tokens, () => void renew());
      const me = await api.auth.me();
      setUser(me);
    } catch {
      // An expired or already-rotated refresh token is a normal end of session,
      // not an error worth surfacing: the user simply logs in again.
      clear();
    }
  }, [adopt, clear]);

  // Bootstrap: restore the session from whatever the last visit left behind.
  useEffect(() => {
    let stored: string | null = null;
    try {
      stored = window.localStorage.getItem(REFRESH_STORAGE_KEY);
    } catch {
      stored = null;
    }

    if (!stored) {
      setLoading(false);
      return;
    }

    refreshToken.current = stored;
    void renew().finally(() => setLoading(false));

    return () => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
    };
  }, [renew]);

  const login = useCallback(
    async (email: string, password: string) => {
      const tokens = await api.auth.login({ email, password, deviceName: deviceName() });
      adopt(tokens, () => void renew());
      setUser(await api.auth.me());
    },
    [adopt, renew],
  );

  const register = useCallback(
    async (input: { email: string; password: string; username: string; displayName: string }) => {
      const tokens = await api.auth.register(input);
      adopt(tokens, () => void renew());
      setUser(await api.auth.me());
    },
    [adopt, renew],
  );

  const logout = useCallback(async () => {
    const stored = refreshToken.current;
    // Clear locally first: if the network call fails the user still expects to
    // be logged out of this browser.
    clear();
    if (stored) {
      try {
        await api.auth.logout(stored);
      } catch {
        // The server-side session will expire on its own.
      }
    }
  }, [clear]);

  const value = useMemo<SessionState>(
    () => ({ user, loading, login, register, logout }),
    [user, loading, login, register, logout],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionState {
  const context = useContext(SessionContext);
  if (!context) {
    throw new Error('useSession must be used inside <SessionProvider>');
  }
  return context;
}

/** Labels the session in the user's device list. Best effort, never identifying. */
function deviceName(): string {
  if (typeof navigator === 'undefined') return 'Navegador';
  const ua = navigator.userAgent;
  if (/android/i.test(ua)) return 'Android';
  if (/iphone|ipad|ipod/i.test(ua)) return 'iOS';
  if (/mac os/i.test(ua)) return 'Mac';
  if (/windows/i.test(ua)) return 'Windows';
  return 'Navegador';
}
