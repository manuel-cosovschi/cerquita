import { createClient } from '@cerquita/api-client';

const baseUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api';

/**
 * Browser client.
 *
 * The access token lives in memory rather than `localStorage`: a token in
 * storage is readable by any injected script, and the refresh token flow can
 * restore the session on load anyway.
 */
let accessToken: string | undefined;

export function setAccessToken(token: string | undefined): void {
  accessToken = token;
}

export const api = createClient({
  baseUrl,
  getAccessToken: () => accessToken,
});

/** Server-side client for React Server Components — always anonymous. */
export const serverApi = createClient({ baseUrl });
