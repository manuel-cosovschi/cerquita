import { expect, test, type APIRequestContext } from '@playwright/test';
import { API, AS, SELLER_LISTING, findListing, login, type Session } from './helpers';

/**
 * A block works in both directions, on every surface.
 *
 * "Both directions" is the part that quietly breaks. Filtering out the people
 * *I* blocked is the obvious half and the one anybody writes; the other half —
 * that somebody who blocked me stops appearing to me too, and that I stop being
 * able to reach them — is a separate clause in every one of the eight places
 * that enforce it. A single `WHERE blockerId = viewer` left in one of those
 * eight leaves the surface half-blind, and the person who did the blocking is
 * the last to find out.
 *
 * So this checks the direction that is easy to get wrong: the block is placed by
 * the *seller*, and everything is then read as the buyer, who never blocked
 * anybody.
 */

const BLOCKER = AS.seller;
const VIEWER = AS.stranger;

async function userId(request: APIRequestContext, session: Session): Promise<string> {
  const me = await request.get(`${API}/api/auth/me`, { headers: session.headers });
  return ((await me.json()) as { userId: string }).userId;
}

/**
 * Blocks for the duration of one check and always lifts it.
 *
 * A block left behind does not fail the next run loudly — it makes the seeded
 * listings quietly invisible, and the failure lands in some unrelated test with
 * a message about a missing product.
 */
async function whileBlocked(
  request: APIRequestContext,
  body: (viewer: Session) => Promise<void>,
): Promise<void> {
  const blocker = await login(request, BLOCKER);
  const viewer = await login(request, VIEWER);
  const target = await userId(request, viewer);

  await request.post(`${API}/api/users/${target}/block`, {
    headers: blocker.headers,
    data: {},
  });

  try {
    await body(viewer);
  } finally {
    await request.delete(`${API}/api/users/${target}/block`, { headers: blocker.headers });
  }
}

test.describe('a block cuts both ways', () => {
  test('the blocked person stops seeing the blocker in search', async ({ request }) => {
    // Visible first, so the assertion afterwards is about the block and not
    // about the listing having been sold or the search being broken.
    const viewer = await login(request, VIEWER);
    const before = await findListing(request, SELLER_LISTING, viewer.headers);
    expect(before.title).toBe(SELLER_LISTING);

    await whileBlocked(request, async (blocked) => {
      const search = await request.post(`${API}/api/search`, {
        headers: blocked.headers,
        data: { q: SELLER_LISTING, kind: 'sale', limit: 24 },
      });
      const { items } = (await search.json()) as Array<never> & { items: Array<{ title: string }> };

      expect(items.map((item) => item.title)).not.toContain(SELLER_LISTING);
    });

    // And back afterwards, which is what makes the block a block and not a
    // deletion.
    const after = await findListing(request, SELLER_LISTING, viewer.headers);
    expect(after.title).toBe(SELLER_LISTING);
  });

  test('and stops seeing them on the map', async ({ request }) => {
    const listing = await findListing(request, SELLER_LISTING);
    const bbox = 'bbox=-58.5,-34.7,-58.3,-34.5&zoom=18';

    const viewer = await login(request, VIEWER);
    const visible = await request.get(`${API}/api/map/listings?${bbox}`, {
      headers: viewer.headers,
    });
    const ids = (before: { markers: Array<{ id: string }> }) => before.markers.map((m) => m.id);

    // Zoomed in far enough that markers are individual listings rather than
    // clusters — a clustered response carries no listing ids, so the assertion
    // below would pass without ever having looked.
    expect(ids((await visible.json()) as { markers: Array<{ id: string }> })).toContain(listing.id);

    await whileBlocked(request, async (blocked) => {
      const map = await request.get(`${API}/api/map/listings?${bbox}`, {
        headers: blocked.headers,
      });
      expect(ids((await map.json()) as { markers: Array<{ id: string }> })).not.toContain(
        listing.id,
      );
    });
  });

  test('neither of them can open a chat with the other', async ({ request }) => {
    const blocker = await login(request, BLOCKER);
    const blockerId = await userId(request, blocker);

    /*
     * Checked by error code, not by "it failed".
     *
     * A wrong id, a missing field or a rate limit would all make this call fail
     * too, and the test would report the block as working while nothing had been
     * blocked at all.
     */
    const refusal = async (response: import('@playwright/test').APIResponse) => {
      expect(response.ok()).toBe(false);
      return ((await response.json()) as { code?: string }).code;
    };

    await whileBlocked(request, async (blocked) => {
      // The blocked person reaching out.
      const outbound = await request.post(`${API}/api/conversations`, {
        headers: blocked.headers,
        data: { recipientId: blockerId, firstMessage: 'Hola.' },
      });
      expect(await refusal(outbound)).toBe('blocked');

      // And the one who blocked, reaching back — the same wall, from the other
      // side. Somebody who blocks and then changes their mind unblocks; they do
      // not get a private exception.
      const target = await userId(request, blocked);
      const inbound = await request.post(`${API}/api/conversations`, {
        headers: blocker.headers,
        data: { recipientId: target, firstMessage: 'Perdón.' },
      });
      expect(await refusal(inbound)).toBe('blocked');
    });
  });

  test('the listing itself is not reachable by its id either', async ({ request }) => {
    /*
     * Hiding something from the list while still serving it by direct link is
     * the classic half-fix: the id is in anybody's history, and a block that
     * only tidies the index is decoration.
     */
    const listing = await findListing(request, SELLER_LISTING);
    const viewer = await login(request, VIEWER);

    // The same id, from the same account, opens fine a moment earlier — so a
    // 404 afterwards is the block and not a stale id.
    const open = await request.get(`${API}/api/listings/${listing.id}`, {
      headers: viewer.headers,
    });
    expect(open.status()).toBe(200);

    await whileBlocked(request, async (blocked) => {
      const detail = await request.get(`${API}/api/listings/${listing.id}`, {
        headers: blocked.headers,
      });

      /*
       * 404, not 403. A distinct status would confirm to the blocked person
       * both that the listing exists and that they have been blocked — the one
       * thing this is meant not to announce.
       */
      expect(detail.status()).toBe(404);
    });
  });

  test('blocking drops the relationship rather than pausing it', async ({ request }) => {
    /*
     * A block deletes the follow, both ways. If it only hid content and left the
     * row alone, unblocking would silently restore a discount somebody had
     * stopped meaning to give.
     *
     * Checked on a follow rather than on the seeded friendship: the same code
     * path deletes both, but a follow is unilateral and can be put back exactly
     * as it was. Undoing a friendship would take a request and an acceptance,
     * and every pricing test in this suite reads that friendship — a restore
     * that half-worked would break them all with a message about a price.
     */
    const blocker = await login(request, BLOCKER);
    const follower = await login(request, AS.follower);
    const blockerId = await userId(request, blocker);
    const followerId = await userId(request, follower);

    const listing = await findListing(request, SELLER_LISTING);

    const before = await request.get(`${API}/api/listings/${listing.id}`, {
      headers: follower.headers,
    });
    expect(((await before.json()) as { price: { tier: string } }).price.tier).toBe('follower');

    await request.post(`${API}/api/users/${followerId}/block`, {
      headers: blocker.headers,
      data: {},
    });
    await request.delete(`${API}/api/users/${followerId}/block`, { headers: blocker.headers });

    try {
      const after = await request.get(`${API}/api/listings/${listing.id}`, {
        headers: follower.headers,
      });
      expect(((await after.json()) as { price: { tier: string } }).price.tier).toBe('public');
    } finally {
      // Put the seed back: several tests read this follow.
      await request.post(`${API}/api/users/${blockerId}/follow`, {
        headers: follower.headers,
        data: {},
      });
    }
  });
});
