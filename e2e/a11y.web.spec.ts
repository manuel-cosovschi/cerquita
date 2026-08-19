import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
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

/** Screens that need a session to render anything. */
const PRIVATE_PAGES: Array<[string, string]> = [
  ['/feed', 'feed'],
  ['/messages', 'chats'],
  ['/favorites', 'favoritos'],
  ['/cart', 'carrito'],
  ['/alerts', 'alertas'],
  ['/settings/pricing', 'precios sociales'],
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

  for (const [path, label] of PRIVATE_PAGES) {
    test(`${label} no tiene violaciones WCAG AA`, async ({ page }) => {
      await signIn(page, AS.seller, path);
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
