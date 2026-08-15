import { type APIRequestContext, expect, test } from '@playwright/test';
import { AS, type Session, login, publishListing, retireListing } from './helpers';

/**
 * Checkout (spec §41).
 *
 * The rule is that the server recalculates everything and the browser's numbers
 * are never an input to what gets charged. `quotedTotal` is a tripwire — "this
 * is what I was shown" — so that a price moving between the cart and the
 * confirm button stops the sale instead of silently overcharging.
 *
 * Every test publishes the thing it buys. Buying seeded stock works exactly
 * once; the second run finds it sold, and a suite that only passes on a fresh
 * database is a suite nobody runs twice.
 */

const PRICE = 123_400;

async function cartFor(request: APIRequestContext, session: Session, listingId: string) {
  await request.post('/api/cart/items', {
    headers: session.headers,
    data: { listingId, quantity: 1 },
  });

  const response = await request.get('/api/cart', { headers: session.headers });
  const carts = (await response.json()) as Array<{
    id: string;
    total: { amount: number; currency: string };
    items: Array<{ id: string; listingId: string }>;
  }>;

  const cart = carts.find((entry) => entry.items.some((item) => item.listingId === listingId));
  if (!cart) throw new Error('The listing did not land in any cart');
  return cart;
}

async function clearCarts(request: APIRequestContext, session: Session) {
  const response = await request.get('/api/cart', { headers: session.headers });
  const carts = (await response.json()) as Array<{ items: Array<{ id: string }> }>;

  for (const cart of carts) {
    for (const item of cart.items) {
      await request.delete(`/api/cart/items/${item.id}`, { headers: session.headers });
    }
  }
}

test.describe('checkout recalculates instead of trusting the client', () => {
  test('a tampered quoted total is refused, and the cart survives', async ({ request }) => {
    const seller = await login(request, AS.seller);
    const buyer = await login(request, AS.stranger);
    await clearCarts(request, buyer);

    const listing = await publishListing(request, seller, { amount: PRICE });
    const cart = await cartFor(request, buyer, listing.id);

    const response = await request.post('/api/checkout', {
      headers: buyer.headers,
      data: {
        cartId: cart.id,
        deliveryMethod: 'pickup',
        // One peso. If this were ever the amount charged, the marketplace is
        // free to anybody who can open dev tools.
        quotedTotal: { amount: 100, currency: 'ARS' },
      },
    });

    expect(response.ok()).toBe(false);
    expect(response.status()).toBe(409);

    // Refusing must leave the cart alone: a rejected checkout that emptied it
    // anyway would lose the buyer's basket over a price that merely moved.
    const after = await request.get('/api/cart', { headers: buyer.headers });
    const carts = (await after.json()) as Array<{ items: Array<{ listingId: string }> }>;
    expect(carts.some((entry) => entry.items.some((item) => item.listingId === listing.id))).toBe(
      true,
    );

    await clearCarts(request, buyer);
    await retireListing(request, seller, listing.id);
  });

  test('the cart total agrees with the listing endpoint', async ({ request }) => {
    // The same number must come out of one code path. Two implementations of
    // "what does this cost" is how a cart and a checkout page start disagreeing.
    const seller = await login(request, AS.seller);
    const buyer = await login(request, AS.friend);
    await clearCarts(request, buyer);

    const listing = await publishListing(request, seller, { amount: PRICE });

    const detail = await request.get(`/api/listings/${listing.id}`, { headers: buyer.headers });
    const view = (await detail.json()) as { price: { effective: { amount: number } } };

    const cart = await cartFor(request, buyer, listing.id);

    expect(cart.total.amount).toBe(view.price.effective.amount);
    // Fran is Manuel's friend, so this is the 15% price and not the list one.
    expect(view.price.effective.amount).toBe(Math.round(PRICE * 0.85));

    await clearCarts(request, buyer);
    await retireListing(request, seller, listing.id);
  });

  test('a correct quote goes through and the order snapshots what was bought', async ({
    request,
  }) => {
    const seller = await login(request, AS.seller);
    const buyer = await login(request, AS.stranger);
    await clearCarts(request, buyer);

    const listing = await publishListing(request, seller, { amount: PRICE });
    const cart = await cartFor(request, buyer, listing.id);

    const response = await request.post('/api/checkout', {
      headers: buyer.headers,
      data: { cartId: cart.id, deliveryMethod: 'pickup', quotedTotal: cart.total },
    });

    expect(response.ok()).toBe(true);

    const { order } = (await response.json()) as {
      order: {
        id: string;
        total: { amount: number };
        items: Array<{ titleSnapshot: string; unitPriceSnapshot: { amount: number } }>;
      };
    };

    expect(order.total.amount).toBe(cart.total.amount);
    // A snapshot, not a join: the order says what was bought even if the
    // listing is later renamed, repriced or removed.
    expect(order.items[0]!.titleSnapshot).toBe(listing.title);

    const reread = await request.get(`/api/orders/${order.id}`, { headers: buyer.headers });
    const stored = (await reread.json()) as { total: { amount: number } };
    expect(stored.total.amount).toBe(order.total.amount);

    // The single unit is gone, so the listing is sold rather than still active.
    const detail = await request.get(`/api/listings/${listing.id}`);
    const sold = (await detail.json()) as { status: string };
    expect(sold.status).toBe('sold');
  });

  test("a completed sale counts towards the seller's profile", async ({ request }) => {
    // "0 ventas" next to a five-star review is the kind of number that makes a
    // marketplace look broken. The counter was read in two places and written
    // in none, so it sat at zero however much anybody sold.
    const seller = await login(request, AS.seller);
    const buyer = await login(request, AS.stranger);
    await clearCarts(request, buyer);

    const before = await request.get('/api/users/manuel');
    const { salesCount: salesBefore } = (await before.json()) as { salesCount: number };

    const listing = await publishListing(request, seller, { amount: PRICE });
    const cart = await cartFor(request, buyer, listing.id);

    const response = await request.post('/api/checkout', {
      headers: buyer.headers,
      data: { cartId: cart.id, deliveryMethod: 'pickup', quotedTotal: cart.total },
    });
    expect(response.ok()).toBe(true);

    const after = await request.get('/api/users/manuel');
    const { salesCount: salesAfter } = (await after.json()) as { salesCount: number };

    // Once per order, not per item: a cart holds one seller, and "3 ventas"
    // should mean three people who bought rather than three objects.
    expect(salesAfter).toBe(salesBefore + 1);
  });

  test('somebody else cannot read the order', async ({ request }) => {
    const seller = await login(request, AS.seller);
    const buyer = await login(request, AS.stranger);
    await clearCarts(request, buyer);

    const listing = await publishListing(request, seller, { amount: PRICE });
    const cart = await cartFor(request, buyer, listing.id);

    const response = await request.post('/api/checkout', {
      headers: buyer.headers,
      data: { cartId: cart.id, deliveryMethod: 'pickup', quotedTotal: cart.total },
    });
    const { order } = (await response.json()) as { order: { id: string } };

    // Lucía is neither the buyer nor the seller. An order is a private document
    // between two people; a guessable id must not be enough to read it.
    const outsider = await login(request, AS.follower);
    const denied = await request.get(`/api/orders/${order.id}`, { headers: outsider.headers });
    expect([403, 404]).toContain(denied.status());

    // The seller, on the other hand, has every right to see what they sold.
    const asSeller = await request.get(`/api/orders/${order.id}`, { headers: seller.headers });
    expect(asSeller.ok()).toBe(true);
  });

  test('an anonymous checkout is refused outright', async ({ request }) => {
    const response = await request.post('/api/checkout', {
      data: { cartId: 'whatever', deliveryMethod: 'pickup' },
    });

    expect(response.status()).toBe(401);
  });
});
