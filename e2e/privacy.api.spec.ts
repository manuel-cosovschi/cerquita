import { expect, test } from '@playwright/test';
import { AS, SELLER_LISTING, findListing, getListing, login } from './helpers';

/**
 * Location privacy (spec §36, §37).
 *
 * A hyperlocal marketplace knows where everybody lives. The rule is that the
 * exact point never leaves the server: what ships is a deterministically
 * fuzzed point plus the radius it was fuzzed by, so the UI can be honest about
 * its own imprecision.
 *
 * Determinism matters as much as the fuzzing. If the offset were random per
 * request, anybody could average a handful of responses and recover the real
 * address — which is worse than not fuzzing at all, because the map claims to
 * be protecting you.
 */
test.describe('exact locations never leave the server', () => {
  test('a listing response carries a fuzzed point and no exact one', async ({ request }) => {
    const listing = await findListing(request, SELLER_LISTING);
    const detail = await getListing(request, listing.id);

    const serialised = JSON.stringify(detail);
    expect(serialised).not.toContain('exactLocation');
    expect(serialised).not.toContain('exactLat');

    expect(detail.location).toBeDefined();
    expect(detail.location!.precisionMeters).toBeGreaterThan(0);
  });

  test('the fuzzed point is stable across requests and across viewers', async ({ request }) => {
    const listing = await findListing(request, SELLER_LISTING);

    const anonymousOnce = await getListing(request, listing.id);
    const anonymousTwice = await getListing(request, listing.id);

    // Same point, request after request. Averaging gets you nothing.
    expect(anonymousTwice.location!.point).toEqual(anonymousOnce.location!.point);

    // And a signed-in viewer — even a friend, who gets a better price — is not
    // told anything more precise about where the thing is.
    const friend = await login(request, AS.friend);
    const asFriend = await getListing(request, listing.id, friend.headers);

    expect(asFriend.location!.point).toEqual(anonymousOnce.location!.point);
    expect(asFriend.location!.precisionMeters).toBe(anonymousOnce.location!.precisionMeters);
  });

  test('the map endpoint fuzzes too', async ({ request }) => {
    // The map is the easiest place to forget, because markers feel like
    // coordinates rather than like somebody's address.
    const response = await request.get('/api/map/listings?bbox=-58.5,-34.7,-58.3,-34.5&zoom=15');

    expect(response.ok()).toBe(true);
    expect(await response.text()).not.toContain('exactLocation');
  });

  test("a stranger cannot read somebody else's private data through a profile", async ({
    request,
  }) => {
    const stranger = await login(request, AS.stranger);
    const response = await request.get('/api/users/manuel', { headers: stranger.headers });
    const profile = await response.text();

    expect(response.ok()).toBe(true);
    // The area ("Palermo, CABA") is public by design; the point is not.
    expect(profile).not.toContain('exactLocation');
    expect(profile).not.toContain('@cerquita.dev');
  });
});
