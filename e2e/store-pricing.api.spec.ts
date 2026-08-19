import { expect, test } from '@playwright/test';
import { API, AS, login } from './helpers';

/**
 * A shop's price is the shop's, and its followers are its own.
 *
 * Two rules that were half-wired: the column, the pricing engine and the domain
 * comment all said shops discount for their followers, but following a shop was
 * never counted when working out what a viewer was, so the rate could be set and
 * nobody could ever earn it. The only way to get a discount on a shop's listing
 * was to follow the *person* who owned it — which is a different thing to have
 * done, and gave them the owner's personal rate rather than the shop's.
 *
 * It read as working because the seeded shop and its owner happened to offer the
 * same 5%.
 */

const SHOP = 'tecno-almagro';
const SHOP_LISTING = 'iPhone 15 Pro 256GB';

async function shopListing(request: import('@playwright/test').APIRequestContext) {
  const response = await request.post(`${API}/api/search`, {
    data: { q: SHOP_LISTING, kind: 'sale', limit: 10 },
  });
  const body = (await response.json()) as {
    items: Array<{ id: string; title: string; price: { list: { amount: number } } }>;
  };

  const found = body.items.find((item) => item.title === SHOP_LISTING);
  if (!found) throw new Error(`No listing "${SHOP_LISTING}". Run \`pnpm db:seed\`.`);
  return found;
}

/**
 * A known starting point.
 *
 * These tests follow a shop and empty a cart, and a run that dies midway leaves
 * both behind — which then breaks the *next* run at its first assertion, with
 * an error about the product rather than about the leftovers. Cleaning up front
 * costs two requests and makes the suite repeatable.
 */
async function reset(
  request: import('@playwright/test').APIRequestContext,
  headers: Record<string, string>,
  storeId: string,
) {
  await request.delete(`${API}/api/stores/${storeId}/follow`, { headers });

  const carts = await request.get(`${API}/api/cart`, { headers });
  const all = (await carts.json()) as Array<{ items: Array<{ id: string }> }>;
  for (const cart of all) {
    for (const item of cart.items) {
      await request.delete(`${API}/api/cart/items/${item.id}`, { headers });
    }
  }
}

test.describe("a shop's followers", () => {
  test("earn the rate the shop set, on the shop's listings", async ({ request }) => {
    const shop = await request.get(`${API}/api/stores/${SHOP}`);
    const { id: storeId, followerBasisPoints } = (await shop.json()) as {
      id: string;
      followerBasisPoints: number;
    };

    // The rate has to be visible before following: "seguime y te hago 4%" is an
    // offer, and an offer you can only read after accepting it is not one.
    expect(followerBasisPoints).toBeGreaterThan(0);

    const listing = await shopListing(request);
    const viewer = await login(request, AS.friend);
    const headers = viewer.headers;
    await reset(request, headers, storeId);

    const before = await request.get(`${API}/api/listings/${listing.id}`, { headers });
    const asStranger = (await before.json()) as {
      price: { effective: { amount: number }; tier: string };
    };
    expect(asStranger.price.tier).toBe('public');

    await request.post(`${API}/api/stores/${storeId}/follow`, { headers, data: {} });

    try {
      const after = await request.get(`${API}/api/listings/${listing.id}`, { headers });
      const asFollower = (await after.json()) as {
        price: { list: { amount: number }; effective: { amount: number }; tier: string };
        discountBasisPoints?: number;
      };

      expect(asFollower.price.tier).toBe('follower');

      const expected = Math.round(
        asFollower.price.list.amount * (1 - followerBasisPoints / 10_000),
      );
      expect(asFollower.price.effective.amount).toBe(expected);
    } finally {
      await request.delete(`${API}/api/stores/${storeId}/follow`, { headers });
    }
  });

  test("a shop does not borrow its owner's mutual friends", async ({ request }) => {
    /*
     * "Tecno Almagro · Amigo de Manuel" read as though the shop were somebody's
     * friend. The mutual friend is the person who owns it, and the rest of the
     * system already holds that shops have followers and no friends — pricing
     * enforces exactly that — so the badge was the one place contradicting it.
     */
    const viewer = await login(request, AS.follower);
    const headers = viewer.headers;

    const shopListingView = await shopListing(request);
    const shopDetail = await request.get(`${API}/api/listings/${shopListingView.id}`, { headers });
    expect(((await shopDetail.json()) as { socialProof: string | null }).socialProof).toBeNull();

    // And a person's listing still carries it, which is the point of the badge.
    const search = await request.post(`${API}/api/search`, {
      data: { q: 'PlayStation 5 con dos joysticks', kind: 'sale', limit: 5 },
    });
    const items = ((await search.json()) as { items: Array<{ id: string; title: string }> }).items;
    const personal = items.find((item) => item.title === 'PlayStation 5 con dos joysticks');
    if (!personal) throw new Error('Seed listing missing. Run `pnpm db:seed`.');

    const detail = await request.get(`${API}/api/listings/${personal.id}`, { headers });
    const { socialProof } = (await detail.json()) as { socialProof: string | null };
    expect(socialProof).toMatch(/Amigo de/);
  });

  test('the cart charges the same rate the listing showed', async ({ request }) => {
    // The basket and the bill are built by different code paths; this is the
    // assertion that keeps them agreeing about a shop's discount.
    const shop = await request.get(`${API}/api/stores/${SHOP}`);
    const { id: storeId } = (await shop.json()) as { id: string };

    const listing = await shopListing(request);
    const buyer = await login(request, AS.friend);
    const headers = buyer.headers;
    await reset(request, headers, storeId);

    await request.post(`${API}/api/stores/${storeId}/follow`, { headers, data: {} });

    try {
      const detail = await request.get(`${API}/api/listings/${listing.id}`, { headers });
      const view = (await detail.json()) as { price: { effective: { amount: number } } };

      await request.post(`${API}/api/cart/items`, {
        headers,
        data: { listingId: listing.id, quantity: 1 },
      });

      const carts = await request.get(`${API}/api/cart`, { headers });
      const all = (await carts.json()) as Array<{
        total: { amount: number };
        items: Array<{ id: string; listingId: string }>;
      }>;
      const cart = all.find((entry) => entry.items.some((i) => i.listingId === listing.id));

      expect(cart?.total.amount).toBe(view.price.effective.amount);

      // Agreement alone is not enough: with the discount missing entirely, both
      // sides read the public price and match each other perfectly. The cart has
      // to actually be below list.
      expect(cart?.total.amount).toBeLessThan(listing.price.list.amount);

      for (const item of cart?.items ?? []) {
        await request.delete(`${API}/api/cart/items/${item.id}`, { headers });
      }
    } finally {
      await request.delete(`${API}/api/stores/${storeId}/follow`, { headers });
    }
  });
});
