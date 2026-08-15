import { expect, test } from '@playwright/test';
import { AS, SELLER_LISTING, findListing, signIn } from './helpers';

/**
 * The same listing, seen by three different people, in a real browser.
 *
 * The API tests prove the server resolves the price. This proves the number the
 * server resolved is the number on the screen — that nothing in the client
 * recomputes, rounds or caches its way to a different answer, and that a
 * signed-in viewer sees *why* they are getting it.
 */
test.describe('a listing shows the viewer their own price', () => {
  test('anonymous sees the list price and no social badge', async ({ page, request }) => {
    const listing = await findListing(request, SELLER_LISTING);

    await page.goto(`/listing/${listing.id}`);
    await expect(page.getByRole('heading', { name: SELLER_LISTING })).toBeVisible();

    const body = await page.innerText('body');

    // 580.000 style formatting: assert on the digits, not the separators.
    expect(body).toContain(formatArs(listing.price!.list.amount));

    // No badge *claiming* a social price. The page does invite you to sign in
    // and find out — that is the point of a social marketplace — so the check
    // is on the claim, not on the word "amigo".
    expect(body).not.toMatch(/Estás viendo el precio/);
    expect(body).toMatch(/para ver si tenés precio de amigo/);
  });

  test('a friend sees the discounted price and is told why', async ({ page, request }) => {
    const listing = await findListing(request, SELLER_LISTING);
    const listPrice = listing.price!.list.amount;

    await signIn(page, AS.friend, `/listing/${listing.id}`);
    await page.waitForLoadState('networkidle');

    const body = await page.innerText('body');

    // 15% off, and the original still visible so the saving is checkable.
    expect(body).toContain(formatArs(Math.round(listPrice * 0.85)));
    expect(body).toContain(formatArs(listPrice));
    expect(body).toMatch(/amigo/i);
  });

  test('a follower sees the follower price, not the friend one', async ({ page, request }) => {
    const listing = await findListing(request, SELLER_LISTING);
    const listPrice = listing.price!.list.amount;

    await signIn(page, AS.follower, `/listing/${listing.id}`);
    await page.waitForLoadState('networkidle');

    const body = await page.innerText('body');

    expect(body).toContain(formatArs(Math.round(listPrice * 0.95)));
    expect(body).not.toContain(formatArs(Math.round(listPrice * 0.85)));
  });
});

/** Centavos to the digits the page renders, without assuming the separator. */
function formatArs(amountInCentavos: number): string {
  return new Intl.NumberFormat('es-AR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amountInCentavos / 100);
}
