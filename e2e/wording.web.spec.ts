import { expect, test } from '@playwright/test';
import { API, AS, SELLER_LISTING, findListing, login, signIn } from './helpers';

/**
 * Singular and plural agreement.
 *
 * This has now been wrong in four places — a stat reading "1 RESEÑAS", a shop
 * with "1 PUBLICACIONES", a seller's "1 reseñas", and a screen-reader label
 * saying "1 productos activos". None are edge cases: every seller has exactly
 * one review before they have two, and every shop has one thing for sale before
 * it has more. Everybody passes through these states.
 *
 * Checked against an explicit list of the nouns this UI actually counts, rather
 * than any number followed by a word. The general version was tried first and
 * flagged "500, CABA" in a street address — a rule loose enough to catch
 * everything catches things that were never counts.
 */

/** The nouns the interface puts a number in front of, singular then plural. */
const COUNTED: Array<[singular: string, plural: string]> = [
  ['publicación', 'publicaciones'],
  ['reseña', 'reseñas'],
  ['venta', 'ventas'],
  ['amigo', 'amigos'],
  ['seguidor', 'seguidores'],
  ['producto', 'productos'],
  ['comentario', 'comentarios'],
  ['resultado', 'resultados'],
  ['foto', 'fotos'],
  ['oferta', 'ofertas'],
  ['puja', 'pujas'],
  ['mensaje', 'mensajes'],
  ['conversación', 'conversaciones'],
];

/**
 * Every disagreement on the page, named so a failure reads as the fix.
 *
 * Case-insensitive because these appear both as prose and as upper-cased stat
 * labels, and the uppercase ones are the easiest to skim past.
 */
function disagreements(raw: string): string[] {
  const found: string[] = [];

  /*
   * Collapse whitespace first.
   *
   * A stat renders the number and its label as two block spans, so `innerText`
   * puts a newline between them: the page reads "1 RESEÑAS" and the string says
   * "1\nRESEÑAS". Matching on a literal space finds nothing — this check
   * silently passed against a page that had the bug on screen until the space
   * was made flexible.
   */
  const text = raw.replace(/\s+/g, ' ');

  for (const [singular, plural] of COUNTED) {
    for (const [wrong, right] of [
      [`1 ${plural}`, `1 ${singular}`],
      // "0 publicación" is as wrong as "1 publicaciones"; zero takes the plural.
      [`0 ${singular}`, `0 ${plural}`],
    ]) {
      const pattern = new RegExp(`\\b${wrong}\\b`, 'i');
      if (pattern.test(text)) found.push(`"${wrong}" should read "${right}"`);
    }
  }

  return found;
}

test.describe('counts agree with the nouns beside them', () => {
  test("a seller's profile", async ({ page }) => {
    // Manuel has exactly one review in the seed, which is the case that broke.
    await page.goto('/user/manuel');
    await expect(page.getByRole('heading', { name: 'Manuel' }).first()).toBeVisible();

    expect(disagreements(await page.innerText('body'))).toEqual([]);
  });

  test('a storefront', async ({ page }) => {
    // One listing and, for one of the seeded shops, one follower.
    await page.goto('/store/tecno-almagro');
    await expect(page.getByText('Tecno Almagro').first()).toBeVisible();

    expect(disagreements(await page.innerText('body'))).toEqual([]);
  });

  test('a listing, seen by nobody in particular', async ({ page, request }) => {
    const listing = await findListing(request, SELLER_LISTING);

    await page.goto(`/listing/${listing.id}`);
    await expect(page.getByRole('heading', { name: SELLER_LISTING })).toBeVisible();

    expect(disagreements(await page.innerText('body'))).toEqual([]);
  });

  test('the message list', async ({ page, request }) => {
    /*
     * Creates the case rather than hoping for it.
     *
     * "1 mensajes sin leer" needs a thread with exactly one unread message, and
     * whether the seeded inbox happens to contain one depends on what anybody
     * clicked last. The first version of this test passed against the bug for
     * precisely that reason.
     */
    const sender = await login(request, AS.follower);
    const seller = await login(request, AS.seller);

    const me = await request.get(`${API}/api/users/manuel`);
    const { id: sellerId } = (await me.json()) as { id: string };

    const opened = await request.post(`${API}/api/conversations`, {
      headers: sender.headers,
      data: { recipientId: sellerId, firstMessage: 'Una sola pregunta.' },
    });
    const conversation = (await opened.json()) as { id: string };

    // Read it first so the count starts from zero, then send exactly one.
    await request.post(`${API}/api/conversations/${conversation.id}/read`, {
      headers: seller.headers,
      data: {},
    });
    await request.post(`${API}/api/conversations/${conversation.id}/messages`, {
      headers: sender.headers,
      data: { body: 'Y ahora sí, una sin leer.' },
    });

    await signIn(page, AS.seller, '/messages');
    await expect(page.getByRole('heading', { name: 'Chats' }).first()).toBeVisible();
    // Wait for the thread to appear before reading the page, so the assertion
    // is not racing the fetch.
    await expect(page.getByText('Y ahora sí, una sin leer.')).toBeVisible({ timeout: 15_000 });

    expect(disagreements(await page.innerText('body'))).toEqual([]);
  });

  test('nothing sticks out of its card in the inbox', async ({ page }) => {
    /*
     * Not wording, but found the same way and in the same place.
     *
     * The listing title and the message preview are spans, and
     * `text-overflow: ellipsis` only applies to a block container — so a long
     * title ran straight out of the card, over the unread badge, and collided
     * with the preview on the same line.
     */
    await signIn(page, AS.seller, '/messages');
    await expect(page.getByRole('heading', { name: 'Chats' }).first()).toBeVisible();

    const spilling = await page.evaluate(() => {
      const out: string[] = [];
      for (const row of document.querySelectorAll('a')) {
        const bounds = row.getBoundingClientRect();
        if (bounds.width === 0) continue;

        for (const child of row.querySelectorAll('span')) {
          const box = child.getBoundingClientRect();
          // A pixel of slack for sub-pixel layout rounding.
          if (box.width > 0 && box.right > bounds.right + 1) {
            out.push(child.textContent?.slice(0, 40) ?? '');
          }
        }
      }
      return out;
    });

    expect(spilling).toEqual([]);
  });

  test('the map and its results', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByLabel('Resultados')).toContainText(/publicaci[oó]n/, {
      timeout: 20_000,
    });

    expect(disagreements(await page.innerText('body'))).toEqual([]);
  });
});
