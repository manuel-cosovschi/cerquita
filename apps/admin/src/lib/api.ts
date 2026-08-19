import { createClient } from '@cerquita/api-client';

const baseUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api';

/**
 * Admin client.
 *
 * Same token discipline as the storefront: the access token lives in memory
 * only, the refresh token in storage. Under a separate storage key, so signing
 * in to the console does not hand a normal browser session admin credentials
 * and vice versa — the two apps are meant to be two logins.
 */
let accessToken: string | undefined;

export const REFRESH_STORAGE_KEY = 'cerquita.admin.refresh';

export function setAccessToken(token: string | undefined): void {
  accessToken = token;
}

export const api = createClient({ baseUrl, getAccessToken: () => accessToken });
