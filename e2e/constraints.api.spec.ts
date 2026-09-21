import { expect, test } from './fixtures';
import { Client } from 'pg';

/**
 * What the database refuses to store, whatever the code says (spec §84).
 *
 * These are the invariants that survive a bug. Every one of them is also
 * enforced above — the checkout guards stock with a conditional UPDATE, Zod
 * bounds the basis points, the friendship service orders the pair before
 * writing — and that is precisely the point: a CHECK exists for the day the
 * layer above is wrong. Testing them through the API would only prove the API
 * is right, which is the thing being doubted.
 *
 * So this talks to Postgres directly, as a bad actor would: raw INSERTs and
 * UPDATEs that skip every guard in the application and ask the database alone
 * to say no.
 *
 * The constraints are cheap to write and silent to lose. A migration that
 * regenerates the schema, an `ALTER TABLE` while debugging, a restore from a
 * dump taken before them — any of those drops one and nothing anywhere fails.
 */

const URL =
  process.env.DATABASE_URL ??
  'postgresql://cerquita:cerquita@localhost:5432/cerquita?schema=public';

/** Every project CHECK, by the name the migration gives it. */
const EXPECTED = [
  'auction_amounts_coherent',
  'follow_not_self',
  'friendship_canonical_order',
  'listing_discount_bps_range',
  'listing_price_non_negative',
  'listing_published_requires_location',
  'listing_stock_non_negative',
  'order_totals_non_negative',
  'review_rating_range',
  'user_discount_bps_range',
];

let db: Client;

test.beforeAll(async () => {
  db = new Client({ connectionString: URL });
  await db.connect();
});

test.afterAll(async () => {
  await db.end();
});

/**
 * Runs a forbidden write and returns the constraint that stopped it.
 *
 * Inside a transaction that always rolls back, so a constraint that has gone
 * missing leaves no wreckage in the database — the test fails, and the row it
 * managed to write disappears with the rollback.
 */
async function refusedBy(sql: string, params: unknown[] = []): Promise<string> {
  await db.query('BEGIN');
  try {
    await db.query(sql, params);
    return '(the write went through)';
  } catch (error) {
    // Postgres reports a CHECK violation as 23514 and names the constraint.
    const violation = error as { code?: string; constraint?: string; message?: string };
    if (violation.code !== '23514') {
      throw new Error(`Expected a CHECK violation, got ${violation.code}: ${violation.message}`);
    }
    return violation.constraint ?? '(unnamed)';
  } finally {
    await db.query('ROLLBACK');
  }
}

/** A seeded row to mutate, so the test does not have to build a whole object. */
async function anyId(table: string, where = 'TRUE'): Promise<string> {
  const { rows } = await db.query(`SELECT "id" FROM "${table}" WHERE ${where} LIMIT 1`);
  const found = (rows[0] as { id: string } | undefined)?.id;
  if (!found) throw new Error(`No row in "${table}" matching ${where}. Run \`pnpm db:seed\`.`);
  return found;
}

test.describe('the database refuses', () => {
  test('to lose a constraint without anybody noticing', async () => {
    const { rows } = await db.query<{ conname: string }>(
      `SELECT conname FROM pg_constraint
        WHERE contype = 'c'
          AND connamespace = 'public'::regnamespace
          AND conname <> 'spatial_ref_sys_srid_check'
        ORDER BY conname`,
    );

    // Named rather than counted: a failure should say which one went.
    expect(rows.map((row) => row.conname)).toEqual(EXPECTED);
  });

  test('to oversell', async () => {
    /*
     * The one that costs money. The checkout guards it with a conditional
     * UPDATE, but a second code path that forgets — a bulk fix, an admin
     * tool, a migration — would sell the same thing twice and nobody would
     * find out until two buyers arrived.
     */
    const listing = await anyId('Listing', `"quantity" > 0`);

    expect(
      await refusedBy(`UPDATE "Listing" SET "sold" = "quantity" + 1 WHERE "id" = $1::uuid`, [
        listing,
      ]),
    ).toBe('listing_stock_non_negative');

    expect(
      await refusedBy(`UPDATE "Listing" SET "reserved" = -1 WHERE "id" = $1::uuid`, [listing]),
    ).toBe('listing_stock_non_negative');
  });

  test('to hold a negative price', async () => {
    const listing = await anyId('Listing', `"priceAmount" IS NOT NULL`);

    expect(
      await refusedBy(`UPDATE "Listing" SET "priceAmount" = -1 WHERE "id" = $1::uuid`, [listing]),
    ).toBe('listing_price_non_negative');
  });

  test('to hold a negative total on an order', async () => {
    const order = await anyId('Order');

    expect(await refusedBy(`UPDATE "Order" SET "total" = -1 WHERE "id" = $1::uuid`, [order])).toBe(
      'order_totals_non_negative',
    );

    // The commission too: a negative fee is the platform paying to be used.
    expect(
      await refusedBy(`UPDATE "Order" SET "platformFee" = -1 WHERE "id" = $1::uuid`, [order]),
    ).toBe('order_totals_non_negative');
  });

  test('to publish something with no location', async () => {
    /*
     * The whole product is "what is near me". A live listing without a point
     * is invisible on the map and absent from every distance sort, so it looks
     * to its seller like nothing is happening.
     */
    const listing = await anyId('Listing', `"status" = 'active'`);

    expect(
      await refusedBy(`UPDATE "Listing" SET "publicLocation" = NULL WHERE "id" = $1::uuid`, [
        listing,
      ]),
    ).toBe('listing_published_requires_location');

    // A draft may legitimately not have one yet: that is how publishing works
    // — insert as draft, write the points, activate, all in one transaction.
    await db.query('BEGIN');
    await db.query(
      `UPDATE "Listing" SET "status" = 'draft', "publicLocation" = NULL WHERE "id" = $1::uuid`,
      [listing],
    );
    await db.query('ROLLBACK');
  });

  test('to hold a discount outside 0–100%', async () => {
    const user = await anyId('User');

    expect(
      await refusedBy(`UPDATE "User" SET "friendDiscountBps" = 10001 WHERE "id" = $1::uuid`, [
        user,
      ]),
    ).toBe('user_discount_bps_range');

    // Negative is the interesting half: a −5% discount charges more than list,
    // quietly, on exactly the people the seller meant to favour.
    expect(
      await refusedBy(`UPDATE "User" SET "followerDiscountBps" = -500 WHERE "id" = $1::uuid`, [
        user,
      ]),
    ).toBe('user_discount_bps_range');
  });

  test('to store a review outside one to five stars', async () => {
    const review = await anyId('Review');

    expect(
      await refusedBy(`UPDATE "Review" SET "rating" = 0 WHERE "id" = $1::uuid`, [review]),
    ).toBe('review_rating_range');
    expect(
      await refusedBy(`UPDATE "Review" SET "rating" = 6 WHERE "id" = $1::uuid`, [review]),
    ).toBe('review_rating_range');
  });

  test('to store a friendship the wrong way round', async () => {
    /*
     * The canonical order is what makes (A,B) and (B,A) the same row. Without
     * it a pair can be friends twice, and "are we friends?" starts depending
     * on which way the query happens to look.
     */
    const friendship = await anyId('Friendship');
    const { rows } = await db.query<{ userAId: string; userBId: string }>(
      `SELECT "userAId", "userBId" FROM "Friendship" WHERE "id" = $1::uuid`,
      [friendship],
    );
    const pair = rows[0]!;

    expect(
      await refusedBy(
        `UPDATE "Friendship" SET "userAId" = $2::uuid, "userBId" = $3::uuid WHERE "id" = $1::uuid`,
        [friendship, pair.userBId, pair.userAId],
      ),
    ).toBe('friendship_canonical_order');
  });

  test('to let somebody follow themselves', async () => {
    const { rows } = await db.query<{ followerId: string }>(
      `SELECT "followerId" FROM "Follow" LIMIT 1`,
    );
    const follower = rows[0]?.followerId;
    if (!follower) throw new Error('No follows in the seed. Run `pnpm db:seed`.');

    expect(
      await refusedBy(
        `UPDATE "Follow" SET "followeeId" = "followerId" WHERE "followerId" = $1::uuid`,
        [follower],
      ),
    ).toBe('follow_not_self');
  });

  test('to store an auction whose numbers contradict each other', async () => {
    const auction = await anyId('Auction');

    // A reserve below the opening price means the reserve is already met
    // before anybody bids, which is not a reserve.
    expect(
      await refusedBy(
        `UPDATE "Auction" SET "reservePriceAmount" = "startingPriceAmount" - 1 WHERE "id" = $1::uuid`,
        [auction],
      ),
    ).toBe('auction_amounts_coherent');

    // Buy-now at or below the opening price ends the auction on creation.
    expect(
      await refusedBy(
        `UPDATE "Auction" SET "buyNowPriceAmount" = "startingPriceAmount" WHERE "id" = $1::uuid`,
        [auction],
      ),
    ).toBe('auction_amounts_coherent');

    // And an auction that ends before it starts never opens at all.
    expect(
      await refusedBy(`UPDATE "Auction" SET "endsAt" = "startsAt" WHERE "id" = $1::uuid`, [
        auction,
      ]),
    ).toBe('auction_amounts_coherent');
  });
});
