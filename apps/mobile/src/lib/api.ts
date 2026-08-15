import Constants from 'expo-constants';
import { createClient } from '@cerquita/api-client';

/**
 * The API base URL.
 *
 * `localhost` is the device's own loopback on a phone, not the developer's
 * machine, so in development the host is taken from whatever address Expo is
 * serving the bundle from — which is reachable from the device by definition.
 * A build sets EXPO_PUBLIC_API_URL and this never runs.
 */
function resolveBaseUrl(): string {
  const configured = process.env.EXPO_PUBLIC_API_URL;
  if (configured) return configured;

  const host = Constants.expoConfig?.hostUri?.split(':')[0];
  return host ? `http://${host}:4000/api` : 'http://localhost:4000/api';
}

let accessToken: string | undefined;

export function setAccessToken(token: string | undefined): void {
  accessToken = token;
}

export const api = createClient({
  baseUrl: resolveBaseUrl(),
  getAccessToken: () => accessToken,
});
