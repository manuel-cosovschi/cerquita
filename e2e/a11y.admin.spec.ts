import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { PASSWORD } from './helpers';

/**
 * Accessibility of the moderation console (spec §68).
 *
 * The console draws from the same token file as the storefront, which is
 * precisely why it needs its own pass: the contrast bug that hit twelve
 * storefront screens came from one semantic token, and every screen in here
 * reads from that same token. A check that only covers the storefront would
 * have reported a fix that was, for these five screens, unverified.
 *
 * Its layout is nothing like the storefront's — a sidebar, dense tables, queue
 * counts — so the failures it can produce are different too: a table without
 * headers, a count badge that is colour alone, a control whose only label is an
 * icon.
 */

/**
 * Every screen the console has, behind the same login.
 *
 * The heading is carried alongside the path, not for readability: axe finds
 * nothing wrong with a blank page, so without something to wait for, a console
 * that failed to load would report five clean passes.
 */
const PAGES: Array<[path: string, label: string, heading: string]> = [
  ['/', 'resumen', 'Resumen'],
  ['/reports', 'denuncias', 'Denuncias'],
  ['/disputes', 'disputas', 'Disputas'],
  ['/audit', 'auditoría', 'Auditoría'],
  ['/config', 'configuración', 'Configuración'],
];

const STANDARD = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

/** The seeded super admin. Console accounts are granted, never self-served. */
const CONSOLE_ACCOUNT = 'admin@cerquita.dev';

/**
 * Signs in through the console's own form.
 *
 * There is no `/login` route here: the shell renders the form in place of the
 * console whenever there is no session, and swaps it for the sidebar once there
 * is. So "signed in" is not a URL change — it is the navigation appearing.
 */
async function signInToConsole(page: Page, path: string): Promise<void> {
  await page.goto(path);

  // Every test gets a fresh context, so this is always the signed-out state.
  await page.fill('#email', CONSOLE_ACCOUNT);
  await page.fill('#password', PASSWORD);
  await page.click('button[type=submit]');

  await expect(page.getByRole('navigation', { name: 'Secciones' })).toBeVisible({
    timeout: 15_000,
  });
}

test.describe('consola', () => {
  test('la pantalla de acceso no tiene violaciones WCAG AA', async ({ page }) => {
    // Checked signed out on purpose: this form is the only thing a locked-out
    // moderator can see, and it is the one screen the sign-in helper skips past.
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Consola' })).toBeVisible();

    const { violations } = await new AxeBuilder({ page }).withTags(STANDARD).analyze();

    expect(describe(violations)).toEqual([]);
  });

  for (const [path, label, heading] of PAGES) {
    test(`${label} no tiene violaciones WCAG AA`, async ({ page }) => {
      await signInToConsole(page, path);
      await expect(page.getByRole('heading', { name: heading })).toBeVisible();

      /*
       * The heading alone is not enough: it comes from the shell and is there
       * while the page underneath still says "Cargando…". Every one of these
       * screens is a loader over a fetch, so waiting for the last of them to
       * clear is what separates "the console rendered" from "the console is
       * about to". An empty queue is still a rendered page — its empty state is
       * text somebody has to read, and worth the pass.
       */
      await expect(page.getByText('Cargando…')).toHaveCount(0, { timeout: 15_000 });
      await page.waitForLoadState('networkidle');

      const { violations } = await new AxeBuilder({ page }).withTags(STANDARD).analyze();

      expect(describe(violations)).toEqual([]);
    });
  }

  test('una cuenta común no ve la consola, y se lo dice', async ({ page }) => {
    /*
     * Failing closed is an accessibility matter as much as a security one: a
     * non-staff account that is shown an empty console with no explanation has
     * been told nothing. The API refuses every route regardless; this checks
     * that the refusal is legible.
     */
    await page.goto('/');
    await page.fill('#email', 'manuel@cerquita.dev');
    await page.fill('#password', PASSWORD);
    await page.click('button[type=submit]');

    await expect(page.getByText('Esta cuenta no tiene acceso a la consola.')).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByRole('navigation', { name: 'Secciones' })).toBeHidden();
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
