import { type APIRequestContext, expect, test } from '@playwright/test';
import { AS, type Session, login, retireListing } from './helpers';

/**
 * Auctions (spec §42–§46).
 *
 * The interesting part of an auction is not the happy path, it is what happens
 * when two people bid the same amount at the same instant. The bid path holds a
 * row lock under READ COMMITTED for exactly this: re-read the current price
 * *after* taking the lock, then decide. Under SERIALIZABLE the snapshot is
 * fixed at statement start and the re-read returns stale state, which is how
 * two winning bids happen.
 *
 * These tests create their own auction so they can bid freely without racing
 * the seeded one, whose lifecycle the scheduler owns.
 */

const START = 100_000;
const INCREMENT = 10_000;

/*
 * Every auction these tests open gets taken back off the map afterwards.
 *
 * Without this, a developer who runs the suite a few times finds their local
 * map covered in "[e2e] Subasta 17..." markers. Retired rather than deleted,
 * which is what the app itself does when a seller withdraws something.
 */
const created: string[] = [];

test.afterAll(async ({ playwright }) => {
  if (created.length === 0) return;

  const request = await playwright.request.newContext();
  const seller = await login(request, AS.seller);
  for (const id of created) {
    await retireListing(request, seller, id);
  }
  await request.dispose();
});

async function createAuction(request: APIRequestContext, seller: Session) {
  const categories = await request.get('/api/categories');
  const all = (await categories.json()) as Array<{ id: string; parentId: string | null }>;
  const categoryId = all.find((entry) => entry.parentId)?.id;
  if (!categoryId) throw new Error('No categories. Run `pnpm db:seed`.');

  const response = await request.post('/api/listings', {
    headers: seller.headers,
    data: {
      kind: 'auction',
      title: `[e2e] Subasta ${Date.now()}`,
      description: 'Subasta creada por la suite e2e.',
      categoryId,
      condition: 'good',
      deliveryMethods: ['pickup'],
      images: [{ url: 'https://example.test/e2e.jpg', width: 800, height: 600, position: 0 }],
      location: { lat: -34.6037, lng: -58.3816 },
      endsAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      startingPrice: { amount: START, currency: 'ARS' },
      minimumIncrement: { amount: INCREMENT, currency: 'ARS' },
    },
  });

  if (!response.ok()) {
    throw new Error(`Could not create the auction: ${response.status()} ${await response.text()}`);
  }

  const listing = (await response.json()) as {
    id: string;
    status: string;
    auction?: { id: string };
  };

  created.push(listing.id);

  if (listing.status !== 'active') {
    await request.patch(`/api/listings/${listing.id}/status`, {
      headers: seller.headers,
      data: { status: 'active' },
    });
  }

  /*
   * A new auction is stored as `scheduled` and the scheduler flips it to `live`
   * on its next pass, within about five seconds. Waiting for that rather than
   * assuming it exercises the scheduler too — an auction that never opens is
   * as broken as one that never closes.
   */
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const detail = await request.get(`/api/listings/${listing.id}`);
    const view = (await detail.json()) as {
      id: string;
      auction?: { id: string; status: string; currentPrice: { amount: number } };
    };

    if (view.auction?.status === 'live') {
      return view as { id: string; auction: { id: string; currentPrice: { amount: number } } };
    }

    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  throw new Error(`Auction on ${listing.id} never went live`);
}

test.describe('auctions', () => {
  test('two simultaneous identical bids produce exactly one winner', async ({ request }) => {
    const seller = await login(request, AS.seller);
    const auction = await createAuction(request, seller);

    const first = await login(request, AS.follower);
    const second = await login(request, AS.stranger);

    const amount = { amount: START + INCREMENT, currency: 'ARS' };

    // Fired together, deliberately without awaiting in between. This is the
    // race the row lock exists for.
    const [a, b] = await Promise.all([
      request.post(`/api/auctions/${auction.auction.id}/bids`, {
        headers: first.headers,
        data: { amount },
      }),
      request.post(`/api/auctions/${auction.auction.id}/bids`, {
        headers: second.headers,
        data: { amount },
      }),
    ]);

    const accepted = [a, b].filter((response) => response.ok());

    // One goes through; the other is told the price moved. Never both, never
    // neither.
    expect(accepted).toHaveLength(1);

    const detail = await request.get(`/api/listings/${auction.id}`);
    const after = (await detail.json()) as {
      auction: { currentPrice: { amount: number }; bidCount: number };
    };

    expect(after.auction.currentPrice.amount).toBe(amount.amount);
    expect(after.auction.bidCount).toBe(1);
  });

  test('the first bid may equal the opening price but not undercut it', async ({ request }) => {
    const seller = await login(request, AS.seller);
    const auction = await createAuction(request, seller);
    const bidder = await login(request, AS.follower);

    const below = await request.post(`/api/auctions/${auction.auction.id}/bids`, {
      headers: bidder.headers,
      data: { amount: { amount: START - 1, currency: 'ARS' } },
    });
    expect(below.ok()).toBe(false);

    // The increment governs bids *against another bid*. Opening at exactly the
    // starting price is the normal way an auction begins.
    const opening = await request.post(`/api/auctions/${auction.auction.id}/bids`, {
      headers: bidder.headers,
      data: { amount: { amount: START, currency: 'ARS' } },
    });
    expect(opening.ok()).toBe(true);
  });

  test('a second bid must clear the increment, not just the standing price', async ({
    request,
  }) => {
    const seller = await login(request, AS.seller);
    const auction = await createAuction(request, seller);
    const first = await login(request, AS.follower);
    const second = await login(request, AS.stranger);

    await request.post(`/api/auctions/${auction.auction.id}/bids`, {
      headers: first.headers,
      data: { amount: { amount: START, currency: 'ARS' } },
    });

    // One peso more than the standing bid. Without the increment rule an
    // auction degenerates into a centavo-at-a-time war.
    const creep = await request.post(`/api/auctions/${auction.auction.id}/bids`, {
      headers: second.headers,
      data: { amount: { amount: START + 1, currency: 'ARS' } },
    });
    expect(creep.ok()).toBe(false);

    const proper = await request.post(`/api/auctions/${auction.auction.id}/bids`, {
      headers: second.headers,
      data: { amount: { amount: START + INCREMENT, currency: 'ARS' } },
    });
    expect(proper.ok()).toBe(true);
  });

  test('a stale expected minimum is refused rather than silently overcharged', async ({
    request,
  }) => {
    const seller = await login(request, AS.seller);
    const auction = await createAuction(request, seller);

    const first = await login(request, AS.follower);
    const second = await login(request, AS.stranger);

    await request.post(`/api/auctions/${auction.auction.id}/bids`, {
      headers: first.headers,
      data: { amount: { amount: START + INCREMENT, currency: 'ARS' } },
    });

    // Somebody who loaded the page before that bid landed still believes the
    // threshold is the starting price. Their bid must bounce, not quietly be
    // charged against the new one.
    const response = await request.post(`/api/auctions/${auction.auction.id}/bids`, {
      headers: second.headers,
      data: {
        amount: { amount: START + INCREMENT * 2, currency: 'ARS' },
        expectedMinimum: { amount: START, currency: 'ARS' },
      },
    });

    expect(response.ok()).toBe(false);
  });

  test('the seller cannot bid on their own auction', async ({ request }) => {
    const seller = await login(request, AS.seller);
    const auction = await createAuction(request, seller);

    const response = await request.post(`/api/auctions/${auction.auction.id}/bids`, {
      headers: seller.headers,
      data: { amount: { amount: START + INCREMENT, currency: 'ARS' } },
    });

    expect(response.ok()).toBe(false);
  });

  test('bidding is refused for anonymous callers', async ({ request }) => {
    const seller = await login(request, AS.seller);
    const auction = await createAuction(request, seller);

    const response = await request.post(`/api/auctions/${auction.auction.id}/bids`, {
      data: { amount: { amount: START + INCREMENT, currency: 'ARS' } },
    });

    expect(response.status()).toBe(401);
  });
});
