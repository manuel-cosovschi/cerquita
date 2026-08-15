import type { APIRequestContext, Page } from '@playwright/test';

/**
 * Shared ground for the e2e suite.
 *
 * Everything here reads from the seed rather than creating fixtures, because
 * the seed is what a person running the app locally actually sees. A test that
 * builds its own private world can pass while the app a developer opens is
 * broken.
 */

export const PASSWORD = 'cerquita-demo-2026';

/**
 * The API's own origin, spelled out.
 *
 * The web project's baseURL is the Next server, which happily answers
 * `/api/search` with an HTML 404 page. Relative paths in these helpers would
 * therefore work in one project and silently return markup in the other.
 */
export const API = process.env.E2E_API_URL ?? 'http://localhost:4000';

/**
 * The social graph the seed builds, from Manuel's point of view.
 *
 * Manuel gives followers 5% and friends 15%, which is the exact scenario the
 * spec uses, so these three accounts are the three price tiers.
 */
export const AS = {
  /** Friend of Manuel (accepted, bilateral) → 15%. */
  friend: 'fran@cerquita.dev',
  /** Follows Manuel, not a friend → 5%. */
  follower: 'lucia@cerquita.dev',
  /** Follows Manuel and has a *pending* friend request → still only 5%. */
  pendingFriend: 'santiago@cerquita.dev',
  /** The seller. */
  seller: 'manuel@cerquita.dev',
  /** No relationship with Manuel at all. */
  stranger: 'bruno@cerquita.dev',
} as const;

/** Manuel's own listing — not one of his store's, which price differently. */
export const SELLER_LISTING = 'PlayStation 5 con dos joysticks';

export interface Session {
  accessToken: string;
  headers: { Authorization: string };
}

/*
 * Sessions are cached for the run.
 *
 * Credential routes are rate limited per account — deliberately, it is one of
 * the things this suite exists to protect — so a suite that logs in afresh in
 * every test locks itself out around the tenth one. Tokens live 15 minutes,
 * comfortably longer than the whole run.
 */
const sessions = new Map<string, Session>();

export async function login(
  request: APIRequestContext,
  email: string,
  options: { fresh?: boolean } = {},
): Promise<Session> {
  const cached = sessions.get(email);
  if (cached && !options.fresh) return cached;

  const response = await request.post(`${API}/api/auth/login`, {
    data: { email, password: PASSWORD },
  });

  if (!response.ok()) {
    throw new Error(`Login failed for ${email}: ${response.status()} ${await response.text()}`);
  }

  const { accessToken } = (await response.json()) as { accessToken: string };
  const session: Session = { accessToken, headers: { Authorization: `Bearer ${accessToken}` } };

  sessions.set(email, session);
  return session;
}

export interface PriceView {
  list: { amount: number; currency: string };
  effective: { amount: number; currency: string };
  tier: string;
  discountBasisPoints: number;
}

export interface ListingView {
  id: string;
  title: string;
  price?: PriceView;
  location?: { point: { lat: number; lng: number }; precisionMeters: number };
  seller: { id: string; username: string };
  [key: string]: unknown;
}

/**
 * Finds a listing by its exact title.
 *
 * Deliberately not "take the first search result": Manuel sells several
 * PlayStations, one of them through his store, and store listings price by a
 * different path. Ranking is allowed to change; this lookup should not.
 */
export async function findListing(
  request: APIRequestContext,
  title: string,
  headers: Record<string, string> = {},
): Promise<ListingView> {
  const response = await request.post(`${API}/api/search`, {
    headers,
    data: { q: title, kind: 'sale', limit: 24 },
  });

  const body = (await response.json()) as { items: ListingView[] };
  const found = body.items.find((item) => item.title === title);

  if (!found) {
    // Almost always one of two things: the seed never ran, or a local database
    // drifted because somebody sold/paused this listing while clicking around.
    // CI starts from an empty database every run, so there it means the former.
    throw new Error(
      `No active listing titled "${title}". Run \`pnpm db:seed\`, or check that ` +
        `it was not sold or paused locally. Search returned: ${
          body.items.map((item) => item.title).join(', ') || '(nothing)'
        }`,
    );
  }

  return found;
}

export async function getListing(
  request: APIRequestContext,
  id: string,
  headers: Record<string, string> = {},
): Promise<ListingView> {
  const response = await request.get(`${API}/api/listings/${id}`, { headers });
  return (await response.json()) as ListingView;
}

/**
 * Publishes a throwaway listing owned by the caller.
 *
 * Anything a test buys has to be something the test created. Buying a seeded
 * listing works exactly once — the second run finds it sold — and a suite that
 * only passes on a fresh database is a suite nobody runs twice.
 */
export async function publishListing(
  request: APIRequestContext,
  session: Session,
  overrides: Partial<{ title: string; amount: number; quantity: number }> = {},
): Promise<{ id: string; title: string; amount: number }> {
  const categories = await request.get(`${API}/api/categories`);
  const all = (await categories.json()) as Array<{ id: string; parentId: string | null }>;
  // A leaf, not a top-level heading: that is where real listings go.
  const categoryId = all.find((entry) => entry.parentId)?.id;
  if (!categoryId) throw new Error('No categories. Run `pnpm db:seed`.');

  const title = overrides.title ?? `[e2e] Objeto de prueba ${Date.now()}`;
  const amount = overrides.amount ?? 123_400;

  const response = await request.post(`${API}/api/listings`, {
    headers: session.headers,
    data: {
      kind: 'sale',
      title,
      description: 'Publicación creada por la suite e2e.',
      categoryId,
      price: { amount, currency: 'ARS' },
      condition: 'good',
      quantity: overrides.quantity ?? 1,
      deliveryMethods: ['pickup'],
      // Publishing requires a photo, and the suite should go through the same
      // door as everybody else rather than around it.
      images: [{ url: 'https://example.test/e2e.jpg', width: 800, height: 600, position: 0 }],
      location: { lat: -34.6037, lng: -58.3816 },
    },
  });

  if (!response.ok()) {
    throw new Error(`Could not publish: ${response.status()} ${await response.text()}`);
  }

  const listing = (await response.json()) as { id: string; status: string };

  // Created as a draft, exactly like the real publish flow, so the location is
  // written before it goes live.
  if (listing.status !== 'active') {
    await request.patch(`${API}/api/listings/${listing.id}/status`, {
      headers: session.headers,
      data: { status: 'active' },
    });
  }

  return { id: listing.id, title, amount };
}

/** Takes a throwaway listing back off the map. */
export async function retireListing(
  request: APIRequestContext,
  session: Session,
  id: string,
): Promise<void> {
  await request.patch(`${API}/api/listings/${id}/status`, {
    headers: session.headers,
    data: { status: 'removed' },
  });
}

/** Signs in through the real form, so the session is stored the way the app does it. */
export async function signIn(page: Page, email: string, next = '/'): Promise<void> {
  await page.goto(`/login?next=${encodeURIComponent(next)}`);
  await page.fill('#email', email);
  await page.fill('#password', PASSWORD);
  await page.click('button[type=submit]');
  await page.waitForURL(`**${next}`);
}
