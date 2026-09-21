import { expect, test } from './fixtures';
import { type APIRequestContext } from '@playwright/test';
import { API, AS, login, retireListing, type Session } from './helpers';

/**
 * Local demand never points at one person (spec §51).
 *
 * The screen answers "what is the neighbourhood asking for that nobody sells",
 * and the whole reason it is safe to show is that it only ever reports
 * aggregates. A category with a single request is not an aggregate: it is one
 * person, findable, because their wanted post is public on the map and now
 * there is a screen saying "near this corner, somebody wants X".
 *
 * The threshold that prevents that lives in raw SQL — a `HAVING … >= 2` inside
 * the category query — where no unit test can reach it. The word-level
 * threshold beside it is unit-tested; this one was not.
 *
 * The test creates the condition rather than looking for it: a fresh category
 * nobody else is asking about, one request, then a second from a different
 * person. One must be invisible and two must appear, and it has to be the same
 * category both times or the assertion proves nothing.
 */

const CENTER = { lat: -34.6037, lng: -58.3816 };
const DEMAND = `${API}/api/demand?lat=${CENTER.lat}&lng=${CENTER.lng}&radius=5000`;

interface DemandView {
  categories: Array<{ categoryId: string; name: string; wantedCount: number }>;
}

/**
 * A leaf category nobody in the seed asks about.
 *
 * Deliberately not the one the seed already fills with requests: starting from
 * a category that is already over the threshold would make both halves of this
 * test pass no matter what the SQL did.
 */
async function quietCategory(request: APIRequestContext): Promise<{ id: string; name: string }> {
  const response = await request.get(`${API}/api/categories`);
  const all = (await response.json()) as Array<{
    id: string;
    name: string;
    parentId: string | null;
  }>;

  const demand = (await (await request.get(DEMAND)).json()) as DemandView;
  const busy = new Set(demand.categories.map((entry) => entry.categoryId));

  const leaf = all.find((entry) => entry.parentId && !busy.has(entry.id));
  if (!leaf) throw new Error('Every category is already reported. Run `pnpm db:seed`.');

  return { id: leaf.id, name: leaf.name };
}

async function postWanted(
  request: APIRequestContext,
  session: Session,
  categoryId: string,
): Promise<string> {
  const response = await request.post(`${API}/api/listings`, {
    headers: session.headers,
    data: {
      kind: 'wanted',
      title: `[e2e] Busco algo puntual ${Date.now()}${Math.floor(Math.random() * 1000)}`,
      description: 'Publicación creada por la suite e2e para probar el umbral.',
      categoryId,
      images: [],
      location: CENTER,
      wantedRadiusMeters: 5000,
    },
  });

  if (!response.ok()) {
    throw new Error(`Could not post a wanted: ${response.status()} ${await response.text()}`);
  }

  const listing = (await response.json()) as { id: string; status: string };

  if (listing.status !== 'active') {
    await request.patch(`${API}/api/listings/${listing.id}/status`, {
      headers: session.headers,
      data: { status: 'active' },
    });
  }

  return listing.id;
}

async function reported(request: APIRequestContext, categoryId: string): Promise<number | null> {
  const body = (await (await request.get(DEMAND)).json()) as DemandView;
  return body.categories.find((entry) => entry.categoryId === categoryId)?.wantedCount ?? null;
}

test.describe('local demand', () => {
  test('a category one person asked about is not reported', async ({ request }) => {
    const first = await login(request, AS.follower);
    const second = await login(request, AS.stranger);
    const category = await quietCategory(request);

    const created: Array<[Session, string]> = [];

    try {
      expect(await reported(request, category.id), 'the category should start quiet').toBeNull();

      created.push([first, await postWanted(request, first, category.id)]);
      expect(
        await reported(request, category.id),
        `one request in "${category.name}" names the person who made it`,
      ).toBeNull();

      /*
       * And two do appear. Without this half the test would pass against a
       * screen that reports nothing at all, which is private and useless — the
       * threshold is a floor, not an excuse to stay silent.
       */
      created.push([second, await postWanted(request, second, category.id)]);
      expect(await reported(request, category.id)).toBe(2);
    } finally {
      for (const [session, id] of created) await retireListing(request, session, id);
    }
  });

  test('retiring one of the two takes the category back below the line', async ({ request }) => {
    /*
     * The threshold has to keep holding as things change, not only at the
     * moment of publishing. Somebody who finds what they were looking for
     * takes their post down — and that must put the category back under cover
     * rather than leaving the remaining person exposed.
     */
    const first = await login(request, AS.follower);
    const second = await login(request, AS.stranger);
    const category = await quietCategory(request);

    const one = await postWanted(request, first, category.id);
    const two = await postWanted(request, second, category.id);

    try {
      expect(await reported(request, category.id)).toBe(2);

      await retireListing(request, second, two);
      expect(
        await reported(request, category.id),
        'the last one standing should not be reported alone',
      ).toBeNull();
    } finally {
      await retireListing(request, first, one);
      await retireListing(request, second, two);
    }
  });

  test('the response never carries who asked', async ({ request }) => {
    // Titles are shown — "busco bicicleta" is a thing, not a person — but a
    // seller id, a username or a precise point would each turn the screen into
    // a directory of who wants what, near where.
    const raw = await (await request.get(DEMAND)).text();

    for (const leak of ['sellerId', 'username', 'userId', 'exactLocation', 'displayName']) {
      expect(raw, `the demand response should not carry ${leak}`).not.toContain(leak);
    }
  });
});
