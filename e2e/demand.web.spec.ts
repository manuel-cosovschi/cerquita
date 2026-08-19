import { expect, test } from '@playwright/test';

/**
 * Local demand (spec §51).
 *
 * The screen answers "what are people around here asking for that nobody
 * sells?", which makes it the one place the app aggregates other people's
 * posts. So the tests check both that it reports the pattern and that it stops
 * where it should: counts and words, never who asked.
 */
test.describe('what people are looking for nearby', () => {
  test('asks for a location before claiming to know the neighbourhood', async ({
    browser,
    browserName,
  }) => {
    // A context with the permission withheld, unlike the suite default.
    const context = await browser.newContext({ permissions: [] });
    const page = await context.newPage();

    await page.goto('/demand');
    await expect(page.getByText(/Necesitamos tu ubicación/)).toBeVisible();
    expect(browserName).toBeTruthy();

    await context.close();
  });

  test('reports categories with the gap between demand and supply', async ({ page }) => {
    await page.goto('/demand');
    await page.getByRole('button', { name: 'Activar' }).click();

    await expect(page.getByRole('heading', { name: 'Dónde falta oferta' })).toBeVisible({
      timeout: 15_000,
    });

    const body = await page.innerText('body');

    /*
     * This test reads the seed's two deliberate shapes: bicicletas with three
     * people asking against one listing, and electrodomésticos with nobody
     * selling at all.
     *
     * That makes it sensitive to a local database that has drifted — buying the
     * one seeded bike while clicking around is enough to break it, because the
     * shape it describes is genuinely gone. CI seeds fresh every run, so there
     * a failure means the feature, not the fixture.
     */
    const drifted = 'If this fails locally, re-seed: the shape it describes is seed state.';

    expect(body, drifted).toMatch(/Bicicletas/);
    expect(body, drifted).toMatch(/Electrodomésticos/);

    // "Nadie vende" is the strongest signal there is, so it sorts to the top —
    // above any finite ratio, rather than being dropped for dividing by zero.
    const noSupply = body.indexOf('Electrodomésticos');
    const someSupply = body.indexOf('Bicicletas');
    expect(noSupply, 'A category nobody sells outranks one with supply').toBeLessThan(someSupply);

    // Singular and plural have to agree; "1 publicaciones" reads as a bug.
    expect(body, drifted).toContain('1 publicación en venta');
    expect(body, drifted).toContain('0 publicaciones en venta');
  });

  test('names things, not people', async ({ page }) => {
    await page.goto('/demand');
    await page.getByRole('button', { name: 'Activar' }).click();
    await expect(page.getByRole('heading', { name: 'Lo que más se nombra' })).toBeVisible({
      timeout: 15_000,
    });

    const terms = await page.locator('a[href^="/search?q="]').allInnerTexts();
    const joined = terms.join(' ').toLowerCase();

    expect(joined).toContain('bicicleta');
    // Function words repeat across any two Spanish sentences and name nothing.
    expect(joined).not.toMatch(/\bpara\b/);
    // The aggregate section must not carry a username. The individual posts
    // below it do, but those are already public on the map one by one.
    const aggregate = await page.locator('section[aria-label="Palabras repetidas"]').innerText();
    expect(aggregate).not.toMatch(/Lucía|Fran|Bruno|Santiago|Manuel/);
  });

  test('a repeated word leads to a search that actually ran', async ({ page }) => {
    await page.goto('/demand');
    await page.getByRole('button', { name: 'Activar' }).click();
    await expect(page.getByRole('heading', { name: 'Lo que más se nombra' })).toBeVisible({
      timeout: 15_000,
    });

    await page.locator('a[href="/search?q=bicicleta"]').click();
    await page.waitForURL('**/search**');

    // The point of the link is arriving at results, not at an empty box the
    // visitor has to retype into.
    await expect(page.locator('#q')).toHaveValue('bicicleta');
    await expect(page.getByText(/Bicicleta/).first()).toBeVisible({ timeout: 15_000 });
  });

  test('is reachable from the publish chooser', async ({ page }) => {
    // Unreachable screens do not exist. This is the moment it is useful: right
    // before deciding what to list.
    await page.goto('/sell');
    await page.locator('a[href="/demand"]').click();
    await expect(page.getByRole('heading', { name: 'Qué se busca' })).toBeVisible();
  });
});
