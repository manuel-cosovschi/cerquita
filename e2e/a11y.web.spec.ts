import AxeBuilder from '@axe-core/playwright';
import { expect, test } from './fixtures';
import { AS, SELLER_LISTING, findListing, signIn } from './helpers';

/**
 * Accessibility (spec §68).
 *
 * An automated pass catches the systemic kind of problem, which is the kind
 * this app had: one token used for every hint, timestamp and empty state, sitting
 * at 2.7:1 against the cream. Not a mistake on one screen — the same mistake on
 * twelve, because they all draw from the same well.
 *
 * It does not catch everything. Whether a label *says* the right thing is not
 * something a machine can check, and neither is whether the reading order makes
 * sense. What it does catch, it catches on every screen, every run.
 */

/** Every screen a signed-out visitor can reach. */
const PUBLIC_PAGES: Array<[string, string]> = [
  ['/', 'el mapa'],
  ['/search?q=playstation', 'búsqueda con resultados'],
  ['/demand', 'demanda local'],
  ['/sell', 'publicar'],
  ['/login', 'ingresar'],
  ['/register', 'crear cuenta'],
];

/**
 * Screens that need a session, each checked as a different person.
 *
 * Not for variety's sake, though that is a real bonus — a cart with something
 * in it and an empty one are different renderings, and an inbox with threads
 * exercises markup an empty one never reaches.
 *
 * The reason is that signing in is rate limited to ten attempts a minute per
 * account, deliberately, and the whole suite now runs in about three minutes.
 * Six screens as one person, plus the other specs that sign in as the same
 * seller, crossed that line and the failures looked like the app being broken.
 * The limit is right; the suite was wrong to lean on one account.
 */
const PRIVATE_PAGES: Array<[path: string, label: string, as: string]> = [
  ['/feed', 'feed', AS.seller],
  ['/messages', 'chats', AS.friend],
  ['/favorites', 'favoritos', AS.follower],
  ['/cart', 'carrito', AS.stranger],
  ['/alerts', 'alertas', AS.pendingFriend],
  ['/settings/pricing', 'precios sociales', AS.admin],
];

const STANDARD = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

test.describe('accessibility', () => {
  for (const [path, label] of PUBLIC_PAGES) {
    test(`${label} no tiene violaciones WCAG AA`, async ({ page }) => {
      await page.goto(path);
      await page.waitForLoadState('networkidle');

      const { violations } = await new AxeBuilder({ page }).withTags(STANDARD).analyze();

      expect(describe(violations)).toEqual([]);
    });
  }

  for (const [path, label, as] of PRIVATE_PAGES) {
    test(`${label} no tiene violaciones WCAG AA`, async ({ page }) => {
      await signIn(page, as, path);
      await page.waitForLoadState('networkidle');

      const { violations } = await new AxeBuilder({ page }).withTags(STANDARD).analyze();

      expect(describe(violations)).toEqual([]);
    });
  }

  test('el detalle de una publicación no tiene violaciones WCAG AA', async ({ page, request }) => {
    const listing = await findListing(request, SELLER_LISTING);

    await page.goto(`/listing/${listing.id}`);
    await page.waitForLoadState('networkidle');

    const { violations } = await new AxeBuilder({ page }).withTags(STANDARD).analyze();

    expect(describe(violations)).toEqual([]);
  });

  test('se puede llegar al contenido con el teclado, y se ve dónde está el foco', async ({
    page,
  }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // The skip link is the first stop, so somebody on a keyboard is not made to
    // walk the whole map before reaching the results.
    await page.keyboard.press('Tab');
    await expect(page.locator(':focus')).toHaveText(/Saltar al contenido/i);

    // Every stop after it draws a focus ring. Without this, tab order is a
    // guessing game even when the order itself is correct.
    for (let stop = 0; stop < 12; stop += 1) {
      await page.keyboard.press('Tab');

      const focused = await page.evaluate(() => {
        const element = document.activeElement;
        if (!element || element === document.body) return null;

        const style = getComputedStyle(element);
        return {
          description: `${element.tagName.toLowerCase()} ${element.textContent?.trim().slice(0, 30)}`,
          hasRing: style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0,
        };
      });

      if (focused) expect(focused, focused.description).toHaveProperty('hasRing', true);
    }
  });
});

/** Turns axe's output into something a failure message can actually be read from. */
function describe(
  violations: Array<{ id: string; help: string; impact?: string | null; nodes: unknown[] }>,
): string[] {
  return violations
    .filter((violation) => violation.nodes.length > 0)
    .map(
      (violation) =>
        `${violation.id} [${violation.impact}] ${violation.help} (${violation.nodes.length} elementos)`,
    );
}
