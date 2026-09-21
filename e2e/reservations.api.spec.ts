import { expect, test } from './fixtures';
import type { APIRequestContext } from '@playwright/test';
import { API, AS, login, publishListing, retireListing, type Session } from './helpers';

/**
 * Nothing is sold twice (spec §40, §84).
 *
 * The reservation path and the checkout path both hold stock, both with the
 * same conditional UPDATE — `WHERE quantity - reserved - sold >= n` — written
 * out twice, in two files. They have to agree exactly, and two copies of an
 * invariant is how a pair stops agreeing.
 *
 * What makes this worth testing from the outside rather than reading: the
 * failure is not an error. Overselling succeeds. Two people get a confirmation
 * for the same object and find out when they both turn up, which is the worst
 * possible place to discover it.
 *
 * The listing is published by the test and retired afterwards, so this never
 * eats a seeded one — the map and every pricing test read those.
 */

async function reserve(
  request: APIRequestContext,
  buyer: Session,
  listingId: string,
  quantity: number,
) {
  return request.post(`${API}/api/reservations`, {
    headers: buyer.headers,
    data: { listingId, quantity },
  });
}

/**
 * The reason a hold was refused, as a code rather than a boolean.
 *
 * `response.ok() === false` was the first version and it was worthless: with the
 * conditional UPDATE deleted the tests still passed, because the CHECK in the
 * database caught the oversell and the 500 it produced is also "not ok". The
 * constraint is meant to be the last line, not the first — a 500 means every
 * layer above it failed and the person gets "algo salió mal" instead of "ya no
 * queda".
 *
 * So the refusal is pinned to the one the application makes on purpose.
 */
async function refusal(response: import('@playwright/test').APIResponse): Promise<string> {
  const body = (await response.json()) as { code?: string };
  return `${response.status()} ${body.code ?? '(no code)'}`;
}

test.describe('holding stock', () => {
  test('a reservation cannot take more than exists', async ({ request }) => {
    const seller = await login(request, AS.seller);
    const buyer = await login(request, AS.follower);

    const listing = await publishListing(request, seller, {
      title: `[e2e] Dos unidades ${Date.now()}`,
      quantity: 2,
    });

    try {
      const tooMany = await reserve(request, buyer, listing.id, 3);
      expect(await refusal(tooMany), 'three of two should be refused, cleanly').toBe(
        '409 insufficient_stock',
      );

      // And exactly two is fine, so the refusal above is the count and not the
      // endpoint being broken.
      const justRight = await reserve(request, buyer, listing.id, 2);
      expect(justRight.ok()).toBe(true);
    } finally {
      await retireListing(request, seller, listing.id);
    }
  });

  test('two people cannot hold the same last unit', async ({ request }) => {
    /*
     * Fired together on purpose. The guard is a single conditional UPDATE
     * precisely so the database decides the winner; a read-then-write would
     * let both reads see one unit available and both writes succeed.
     */
    const seller = await login(request, AS.seller);
    const first = await login(request, AS.follower);
    const second = await login(request, AS.stranger);

    const listing = await publishListing(request, seller, {
      title: `[e2e] Última unidad ${Date.now()}`,
      quantity: 1,
    });

    try {
      const [a, b] = await Promise.all([
        reserve(request, first, listing.id, 1),
        reserve(request, second, listing.id, 1),
      ]);

      const winners = [a, b].filter((response) => response.ok());
      expect(winners, 'exactly one of the two should get it').toHaveLength(1);

      // And the loser was told why, rather than meeting a constraint violation
      // on its way out.
      const loser = [a, b].find((response) => !response.ok())!;
      expect(await refusal(loser)).toBe('409 insufficient_stock');
    } finally {
      await retireListing(request, seller, listing.id);
    }
  });

  test('a reservation blocks the checkout, and releasing it unblocks', async ({ request }) => {
    /*
     * The two paths share the invariant, so they have to see each other's
     * holds. If the checkout ignored `reserved`, a reservation would be a
     * promise the app does not keep — somebody else buys it out from under the
     * person holding it.
     */
    const seller = await login(request, AS.seller);
    const holder = await login(request, AS.follower);
    const other = await login(request, AS.stranger);

    const listing = await publishListing(request, seller, {
      title: `[e2e] Reservada ${Date.now()}`,
      quantity: 1,
    });

    try {
      const held = await reserve(request, holder, listing.id, 1);
      expect(held.ok()).toBe(true);
      const { id: reservationId } = (await held.json()) as { id: string };

      const blocked = await request.post(`${API}/api/cart/items`, {
        headers: other.headers,
        data: { listingId: listing.id, quantity: 1 },
      });
      // The same code the reservation and the checkout use. It was a 400 here,
      // which tells a client its request was malformed when in fact somebody
      // else simply got there first.
      expect(await refusal(blocked), 'the held unit is not available to anybody else').toBe(
        '409 insufficient_stock',
      );

      await request.delete(`${API}/api/reservations/${reservationId}`, {
        headers: holder.headers,
      });

      const free = await request.post(`${API}/api/cart/items`, {
        headers: other.headers,
        data: { listingId: listing.id, quantity: 1 },
      });
      expect(free.ok(), 'releasing should put it back').toBe(true);

      const carts = (await (
        await request.get(`${API}/api/cart`, { headers: other.headers })
      ).json()) as Array<{ items: Array<{ id: string }> }>;
      for (const cart of carts) {
        for (const item of cart.items) {
          await request.delete(`${API}/api/cart/items/${item.id}`, { headers: other.headers });
        }
      }
    } finally {
      await retireListing(request, seller, listing.id);
    }
  });

  test('somebody else cannot release a hold that is not theirs', async ({ request }) => {
    const seller = await login(request, AS.seller);
    const holder = await login(request, AS.follower);
    const other = await login(request, AS.stranger);

    const listing = await publishListing(request, seller, {
      title: `[e2e] Reserva ajena ${Date.now()}`,
      quantity: 1,
    });

    try {
      const held = await reserve(request, holder, listing.id, 1);
      const { id: reservationId } = (await held.json()) as { id: string };

      const stolen = await request.delete(`${API}/api/reservations/${reservationId}`, {
        headers: other.headers,
      });
      expect(stolen.ok(), 'releasing somebody else’s hold frees it for the thief').toBe(false);
    } finally {
      await retireListing(request, seller, listing.id);
    }
  });
});
