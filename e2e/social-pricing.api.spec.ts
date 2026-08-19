import { expect, test } from '@playwright/test';
import { AS, SELLER_LISTING, findListing, getListing, login } from './helpers';

/**
 * Social pricing (spec §29–§34).
 *
 * This is the product's central claim — "el mismo objeto vale distinto según
 * quién lo mire" — and the single thing that must never be computed in the
 * browser. These tests ask the API the same question as five different people
 * and check the answers differ in exactly the ways the graph says they should.
 */
test.describe('social pricing is resolved on the server', () => {
  test('an anonymous viewer sees the list price and no discount', async ({ request }) => {
    const listing = await findListing(request, SELLER_LISTING);

    expect(listing.price).toBeDefined();
    expect(listing.price!.tier).toBe('public');
    expect(listing.price!.discountBasisPoints).toBe(0);
    expect(listing.price!.effective.amount).toBe(listing.price!.list.amount);
  });

  test('a follower gets 5% and a friend gets 15%, off the same list price', async ({ request }) => {
    const anonymous = await findListing(request, SELLER_LISTING);
    const listPrice = anonymous.price!.list.amount;

    const follower = await login(request, AS.follower);
    const friend = await login(request, AS.friend);

    const asFollower = await getListing(request, anonymous.id, follower.headers);
    const asFriend = await getListing(request, anonymous.id, friend.headers);

    expect(asFollower.price!.tier).toBe('follower');
    expect(asFollower.price!.discountBasisPoints).toBe(500);
    expect(asFollower.price!.effective.amount).toBe(Math.round(listPrice * 0.95));

    expect(asFriend.price!.tier).toBe('friend');
    expect(asFriend.price!.discountBasisPoints).toBe(1500);
    expect(asFriend.price!.effective.amount).toBe(Math.round(listPrice * 0.85));

    // The list price is the same for everyone; only the effective price moves.
    expect(asFollower.price!.list.amount).toBe(listPrice);
    expect(asFriend.price!.list.amount).toBe(listPrice);
  });

  test('a pending friend request is not a friendship', async ({ request }) => {
    // Santiago asked Manuel to be friends and Manuel has not answered. He also
    // follows him, so he gets the follower price — not the friend price. This
    // is the case a naive "is there a row in Friendship" check gets wrong.
    const listing = await findListing(request, SELLER_LISTING);
    const santiago = await login(request, AS.pendingFriend);

    const view = await getListing(request, listing.id, santiago.headers);

    expect(view.price!.tier).toBe('follower');
    expect(view.price!.discountBasisPoints).toBe(500);
  });

  test('prices are never in minor-unit floats', async ({ request }) => {
    // Money is integer centavos end to end. A float here means somebody did
    // arithmetic in pesos somewhere, and that is how you lose a centavo.
    const listing = await findListing(request, SELLER_LISTING);
    const friend = await login(request, AS.friend);
    const view = await getListing(request, listing.id, friend.headers);

    expect(Number.isInteger(view.price!.list.amount)).toBe(true);
    expect(Number.isInteger(view.price!.effective.amount)).toBe(true);
    expect(view.price!.effective.currency).toBe('ARS');
  });
});
