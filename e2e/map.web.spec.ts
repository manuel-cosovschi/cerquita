import { expect, test } from '@playwright/test';

/**
 * The map is the home screen (direction 1a), so "does it have anything on it"
 * is the first question the app answers about itself.
 *
 * This exists because it once answered wrong. The map only asked the server for
 * listings after the user moved it, so arriving showed "no hay publicaciones en
 * esta zona" over a neighbourhood full of them, and the only way out was to
 * happen to drag. Nothing else caught it: the page rendered, hydrated, passed
 * its accessibility checks and made zero network requests.
 */
/** The interactive surface itself — several things on this screen say "Mapa". */
const mapSurface = (page: import('@playwright/test').Page) =>
  page.getByRole('application', { name: 'Mapa de publicaciones cercanas' });

test.describe('the map', () => {
  test('loads listings on arrival, without being touched first', async ({ page }) => {
    const mapRequests: string[] = [];
    page.on('request', (request) => {
      if (request.url().includes('/api/map/')) mapRequests.push(request.url());
    });

    await page.goto('/');

    // The seed scatters everything around the Obelisco, which is where the
    // browser is standing, so an empty map here means broken rather than remote.
    await expect(page.getByLabel('Resultados')).toContainText(/[1-9]\d* publicacion/, {
      timeout: 20_000,
    });

    expect(mapRequests.length).toBeGreaterThan(0);
    await expect(mapSurface(page)).toBeVisible();
  });

  test('keeps its share of a phone screen once results arrive', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByLabel('Resultados')).toContainText(/[1-9]\d* publicacion/, {
      timeout: 20_000,
    });

    // The results sheet used to size itself to its content, so a search that
    // found something squeezed the map to zero height — it disappeared exactly
    // when it finally had markers to draw. On a map-first app, on the form
    // factor it was designed for.
    const box = await mapSurface(page).boundingBox();
    expect(box).not.toBeNull();
    expect(box!.height).toBeGreaterThan(150);
  });

  test('does not offer to search an area it has just searched', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByLabel('Resultados')).toContainText(/publicacion/, { timeout: 20_000 });

    // The map reporting its own size is not somebody panning it, so the prompt
    // must not be armed before the first search has even run.
    await expect(page.getByRole('button', { name: 'Buscar en esta zona' })).toBeHidden();
  });

  test('offers to search the new area once the map moves, and clears it after', async ({
    page,
  }) => {
    await page.goto('/');
    await expect(page.getByLabel('Resultados')).toContainText(/publicacion/, { timeout: 20_000 });

    const box = await mapSurface(page).boundingBox();
    if (!box) throw new Error('The map never laid itself out');

    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, -300);

    const searchHere = page.getByRole('button', { name: 'Buscar en esta zona' });
    await expect(searchHere).toBeVisible();

    // Moving arms the prompt rather than refetching — results shifting mid-pan
    // is disorienting, and every pan would be a wasted query.
    await searchHere.click();
    await expect(searchHere).toBeHidden();
    await expect(page.getByLabel('Resultados')).toContainText(/publicacion/);
  });
});
