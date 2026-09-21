import { expect, test } from './fixtures';
import type { APIRequestContext } from '@playwright/test';
import { API } from './helpers';

/**
 * A shop is one marker, not one plus everything it sells (spec §49).
 *
 * The rule exists because a hardware shop with five hundred items would
 * otherwise bury the neighbourhood under five hundred pins, and the map is the
 * whole product.
 *
 * Half of it was built: stores did get a single marker carrying a product
 * count. The other half was not — their products kept their own pins right
 * beside it, so the shop was one marker *and* five hundred. The count on the
 * marker made it look done.
 *
 * The converse matters just as much and is the reason this is not simply "never
 * show store listings": on a layer that shows no shops, their products have to
 * appear, or a whole category of things for sale silently disappears from the
 * map.
 */

const BBOX = 'bbox=-58.5,-34.7,-58.3,-34.5&zoom=18';

interface Marker {
  type: 'listing' | 'store' | 'cluster';
  id: string;
  title?: string;
  name?: string;
  activeListingCount?: number;
}

async function markers(request: APIRequestContext, layer: string): Promise<Marker[]> {
  const response = await request.get(`${API}/api/map/listings?${BBOX}&layer=${layer}`);
  const body = (await response.json()) as { markers: Marker[]; clustered: boolean };

  // At this zoom the endpoint returns individual pins. A clustered response
  // carries no titles, so every assertion below would pass without looking.
  expect(body.clustered, 'zoom 18 should not cluster').toBe(false);
  return body.markers;
}

/**
 * The titles of every listing that belongs to a shop.
 *
 * Taken from search, which marks each result with its store — the same source
 * the storefront reads. Deriving them from the map instead would mean asking
 * the thing under test what the right answer is.
 */
async function storeListingTitles(request: APIRequestContext): Promise<string[]> {
  const response = await request.post(`${API}/api/search`, { data: { limit: 50 } });
  const { items } = (await response.json()) as {
    items: Array<{ title: string; store?: { name: string } | null }>;
  };

  const titles = items.filter((item) => item.store).map((item) => item.title);
  if (titles.length === 0) throw new Error('No shop has anything for sale. Run `pnpm db:seed`.');

  return titles;
}

test.describe('shops on the map', () => {
  test('appear once, without their products beside them', async ({ request }) => {
    const owned = await storeListingTitles(request);
    const all = await markers(request, 'all');

    const shops = all.filter((marker) => marker.type === 'store');
    expect(shops.length, 'the seeded shops should be on the map').toBeGreaterThan(0);

    const loose = all
      .filter((marker) => marker.type === 'listing')
      .map((marker) => marker.title ?? '')
      .filter((title) => owned.includes(title));

    expect(loose, 'a shop already represents what it sells').toEqual([]);
  });

  test('carry the count instead of the pins', async ({ request }) => {
    // The count is what makes the single marker honest: "Ferretería Pepe · 500"
    // says as much as five hundred pins and costs one.
    const shops = (await markers(request, 'stores')).filter((marker) => marker.type === 'store');

    expect(shops.length).toBeGreaterThan(0);
    for (const shop of shops) {
      expect(shop.activeListingCount, `${shop.name} should carry a count`).toBeDefined();
    }
    // At least one shop actually has something, or the count proves nothing.
    expect(shops.some((shop) => (shop.activeListingCount ?? 0) > 0)).toBe(true);
  });

  test('the stores layer shows shops and nothing else', async ({ request }) => {
    const only = await markers(request, 'stores');

    expect(only.length).toBeGreaterThan(0);
    expect(only.every((marker) => marker.type === 'store')).toBe(true);
  });

  test('a layer without shops still shows what they sell', async ({ request }) => {
    /*
     * The other direction. Hiding store listings everywhere would be a simpler
     * rule and a worse one: on the "en venta" layer there is no shop marker to
     * stand in for them, so the taladro and the iPhone would just be gone.
     */
    const owned = await storeListingTitles(request);
    const sales = await markers(request, 'sales');

    expect(sales.some((marker) => marker.type === 'store')).toBe(false);

    const visible = sales
      .filter((marker) => marker.type === 'listing')
      .map((marker) => marker.title ?? '')
      .filter((title) => owned.includes(title));

    expect(visible.length, 'a shop item for sale should still be findable').toBeGreaterThan(0);
  });
});
