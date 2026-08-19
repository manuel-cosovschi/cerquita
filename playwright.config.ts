import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests.
 *
 * These run against a real stack — real Postgres with PostGIS, the real Nest
 * API with its real guards and rate limits, the real Next build. Nothing is
 * mocked, because the things worth testing here are exactly the ones that only
 * break when the pieces are wired together: that a price is resolved on the
 * server and not in the browser, that the exact location never leaves the API,
 * that two people bidding at the same time produce one winner.
 *
 * Prerequisites (see docs/setup.md):
 *   pnpm db:migrate && pnpm db:seed
 *   pnpm dev:api  &&  pnpm dev:web
 *
 * Or let this config start the servers itself, which is what `pnpm e2e` does.
 */

const WEB = process.env.E2E_WEB_URL ?? 'http://localhost:3000';
const API = process.env.E2E_API_URL ?? 'http://localhost:4000';
const ADMIN = process.env.E2E_ADMIN_URL ?? 'http://localhost:3001';

export default defineConfig({
  testDir: './e2e',
  outputDir: './e2e/.results',

  /*
   * One worker.
   *
   * The API's rate limits are real here — that is the point — and parallel
   * workers hammering one IP would produce 429s that look like product bugs.
   * The suite is small and fast enough that serialising it costs little.
   */
  workers: 1,
  fullyParallel: false,

  // A retry absorbs a genuinely slow cold start; it will not paper over a
  // failing assertion, since a real failure fails both times.
  retries: process.env.CI ? 1 : 0,
  forbidOnly: !!process.env.CI,

  reporter: process.env.CI ? [['github'], ['list']] : [['list']],

  use: {
    baseURL: WEB,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    // Buenos Aires: the seed scatters everything around the Obelisco, so a
    // browser that "is" somewhere else sees an empty map and every distance
    // assertion becomes meaningless.
    geolocation: { latitude: -34.6037, longitude: -58.3816 },
    permissions: ['geolocation'],
    locale: 'es-AR',
    timezoneId: 'America/Argentina/Buenos_Aires',
  },

  projects: [
    {
      // API-level checks: the server-side invariants, tested without a browser
      // in the way, so a failure names the rule rather than a selector.
      name: 'api',
      testMatch: /.*\.api\.spec\.ts/,
      use: { baseURL: API },
    },
    {
      name: 'web',
      testMatch: /.*\.web\.spec\.ts/,
      use: {
        ...devices['Pixel 7'],
        baseURL: WEB,
        geolocation: { latitude: -34.6037, longitude: -58.3816 },
        permissions: ['geolocation'],
        locale: 'es-AR',
        timezoneId: 'America/Argentina/Buenos_Aires',
      },
    },
    {
      // The moderation console. A desktop viewport rather than the storefront's
      // phone: this is a sidebar-and-tables layout used at a desk, and checking
      // it at 412px would report overflow that nobody will ever meet.
      name: 'admin',
      testMatch: /.*\.admin\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        baseURL: ADMIN,
        locale: 'es-AR',
        timezoneId: 'America/Argentina/Buenos_Aires',
      },
    },
  ],

  // Reuse whatever is already running locally; start it from scratch in CI.
  webServer: process.env.E2E_NO_SERVER
    ? undefined
    : [
        {
          command: 'pnpm --filter @cerquita/api start',
          url: `${API}/api/health`,
          reuseExistingServer: !process.env.CI,
          timeout: 120_000,
        },
        {
          command: 'pnpm --filter @cerquita/web start',
          url: WEB,
          reuseExistingServer: !process.env.CI,
          timeout: 120_000,
        },
        {
          command: 'pnpm --filter @cerquita/admin start',
          url: ADMIN,
          reuseExistingServer: !process.env.CI,
          timeout: 120_000,
        },
      ],
});
