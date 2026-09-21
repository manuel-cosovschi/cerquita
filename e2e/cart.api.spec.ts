import { expect, test, type APIRequestContext } from '@playwright/test';
import {
  API,
  AS,
  SELLER_LISTING,
  findListing,
  login,
  publishListing,
  retireListing,
  type Session,
} from './helpers';

/**
 * One cart per seller (spec §40).
 *
 * Not a display choice. One payment settles to one payee, so a basket holding
 * two people's things cannot be paid for — and the failure, if the partition
 * ever broke, would land at the last possible moment: at checkout, on somebody
 * who has already entered their card, with a total that cannot be paid to
 * anybody in particular.
 *
 * Which makes it the kind of rule worth pinning from the outside: two items
 * from two sellers, and the answer has to be two carts with the right thing in
 * each.
 */

async function emptyEverything(request: APIRequestContext, session: Session): Promise<void> {
  const response = await request.get(`${API}/api/cart`, { headers: session.headers });
  const carts = (await response.json()) as Array<{ items: Array<{ id: string }> }>;

  for (const cart of carts) {
    for (const item of cart.items) {
      await request.delete(`${API}/api/cart/items/${item.id}`, { headers: session.headers });
    }
  }
}

async function carts(request: APIRequestContext, session: Session) {
  const response = await request.get(`${API}/api/cart`, { headers: session.headers });
  return (await response.json()) as Array<{
    id: string;
    sellerId: string;
    total: { amount: number };
    items: Array<{ id: string; listingId: string; quantity: number }>;
  }>;
}

/** Two active listings from two different sellers. */
async function twoSellers(request: APIRequestContext) {
  const mine = await findListing(request, SELLER_LISTING);

  const search = await request.post(`${API}/api/search`, {
    data: { kind: 'sale', limit: 50 },
  });
  const { items } = (await search.json()) as {
    items: Array<{ id: string; title: string; seller: { id: string } }>;
  };

  const other = items.find((item) => item.seller.id !== mine.seller.id);
  if (!other) throw new Error('Only one seller has listings. Run `pnpm db:seed`.');

  return { mine, other };
}

test.describe('the cart', () => {
  test('splits by seller instead of mixing them', async ({ request }) => {
    const buyer = await login(request, AS.follower);
    // Cleaned before as well as after: a run that dies midway leaves items
    // behind, and the next run then counts carts that are not its own.
    await emptyEverything(request, buyer);

    const { mine, other } = await twoSellers(request);

    try {
      for (const listing of [mine, other]) {
        const response = await request.post(`${API}/api/cart/items`, {
          headers: buyer.headers,
          data: { listingId: listing.id, quantity: 1 },
        });
        expect(response.ok(), `adding ${listing.title} should work`).toBe(true);
      }

      const all = await carts(request, buyer);

      expect(all).toHaveLength(2);
      // Each seller's cart holds exactly their own item, and nobody else's.
      for (const cart of all) {
        expect(cart.items).toHaveLength(1);
      }
      expect(all.flatMap((cart) => cart.items.map((item) => item.listingId)).sort()).toEqual(
        [mine.id, other.id].sort(),
      );
      expect(new Set(all.map((cart) => cart.sellerId)).size).toBe(2);
    } finally {
      await emptyEverything(request, buyer);
    }
  });

  test('keeps one cart when two things come from the same seller', async ({ request }) => {
    /*
     * The other half. A partition that opened a cart per *item* would pass the
     * test above and be just as wrong — the buyer would pay twice for one
     * meeting with one person.
     *
     * The second listing is published here rather than taken from the seed:
     * Manuel has exactly one personal sale listing, and the rest of his are a
     * wanted, an auction and his shop's, none of which share a cart with it.
     */
    const seller = await login(request, AS.seller);
    const buyer = await login(request, AS.follower);
    await emptyEverything(request, buyer);

    const mine = await findListing(request, SELLER_LISTING);
    const sibling = await publishListing(request, seller, {
      title: `[e2e] Segundo objeto ${Date.now()}`,
    });

    try {
      for (const id of [mine.id, sibling.id]) {
        const response = await request.post(`${API}/api/cart/items`, {
          headers: buyer.headers,
          data: { listingId: id, quantity: 1 },
        });
        expect(response.ok(), `adding ${id} should work`).toBe(true);
      }

      const all = await carts(request, buyer);

      expect(all).toHaveLength(1);
      expect(all[0]?.items).toHaveLength(2);
    } finally {
      await emptyEverything(request, buyer);
      await retireListing(request, seller, sibling.id);
    }
  });

  test('refuses to let somebody add their own listing', async ({ request }) => {
    // Buying from yourself is not a cart the checkout could ever settle, and
    // it is the easiest way to give yourself a sale and a review.
    const seller = await login(request, AS.seller);
    const mine = await findListing(request, SELLER_LISTING);

    const response = await request.post(`${API}/api/cart/items`, {
      headers: seller.headers,
      data: { listingId: mine.id, quantity: 1 },
    });

    expect(response.ok()).toBe(false);
  });

  test("each cart's total covers only its own seller's items", async ({ request }) => {
    /*
     * A total computed across the whole basket rather than per cart would show
     * each seller the other's money, and charge it.
     */
    const buyer = await login(request, AS.follower);
    await emptyEverything(request, buyer);

    const { mine, other } = await twoSellers(request);

    try {
      for (const listing of [mine, other]) {
        await request.post(`${API}/api/cart/items`, {
          headers: buyer.headers,
          data: { listingId: listing.id, quantity: 1 },
        });
      }

      const all = await carts(request, buyer);

      for (const cart of all) {
        const listingId = cart.items[0]?.listingId;
        const detail = await request.get(`${API}/api/listings/${listingId}`, {
          headers: buyer.headers,
        });
        const view = (await detail.json()) as { price: { effective: { amount: number } } };

        expect(cart.total.amount, `cart for listing ${listingId}`).toBe(
          view.price.effective.amount,
        );
      }

      // And the two totals differ, so an equality above is not two copies of
      // the same number agreeing with itself.
      expect(all[0]?.total.amount).not.toBe(all[1]?.total.amount);
    } finally {
      await emptyEverything(request, buyer);
    }
  });
});
