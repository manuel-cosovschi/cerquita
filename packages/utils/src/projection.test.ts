import { describe, expect, it } from 'vitest';
import {
  TILE_SIZE,
  boundsCenter,
  fromScreen,
  metersPerPixel,
  project,
  toScreen,
  unproject,
  viewportBounds,
  zoomForBounds,
  type Viewport,
} from './projection.js';

/**
 * The projection both apps draw with.
 *
 * It used to live in the web app; the phone now uses the same module, which is
 * what makes these worth writing. A second implementation of Mercator would
 * agree with the first until it did not, and the way it would disagree is a
 * marker a few streets off on one platform — visible only to somebody holding
 * both devices, and impossible to attribute once seen.
 */

const OBELISCO = { lat: -34.6037, lng: -58.3816 };

const viewport = (overrides: Partial<Viewport> = {}): Viewport => ({
  center: OBELISCO,
  zoom: 14,
  width: 400,
  height: 800,
  ...overrides,
});

/** Coordinates are equal to within about a centimetre. */
function expectSamePlace(actual: { lat: number; lng: number }, expected: typeof OBELISCO) {
  expect(actual.lat).toBeCloseTo(expected.lat, 7);
  expect(actual.lng).toBeCloseTo(expected.lng, 7);
}

describe('web mercator', () => {
  it('round-trips a coordinate through pixel space', () => {
    for (const zoom of [3, 10, 14, 19]) {
      expectSamePlace(unproject(project(OBELISCO, zoom), zoom), OBELISCO);
    }
  });

  it('puts the antimeridian at the edges and Greenwich in the middle', () => {
    const scale = TILE_SIZE * 2 ** 5;

    expect(project({ lat: 0, lng: -180 }, 5).x).toBeCloseTo(0, 6);
    expect(project({ lat: 0, lng: 0 }, 5).x).toBeCloseTo(scale / 2, 6);
    expect(project({ lat: 0, lng: 180 }, 5).x).toBeCloseTo(scale, 6);
    // The equator sits halfway down, which is the check that catches a flipped
    // or offset y axis — the failure that puts every marker in the wrong
    // hemisphere while still looking like a map.
    expect(project({ lat: 0, lng: 0 }, 5).y).toBeCloseTo(scale / 2, 6);
  });

  it('doubles the scale for each zoom step', () => {
    // Power-of-two zoom is what lets a raster tile layer be dropped in later
    // without moving a marker.
    const near = project(OBELISCO, 10);
    const far = project(OBELISCO, 11);

    expect(far.x).toBeCloseTo(near.x * 2, 6);
    expect(far.y).toBeCloseTo(near.y * 2, 6);
  });

  it('clamps beyond the latitudes Mercator can represent', () => {
    // Mercator diverges at the poles; without a clamp the pixel coordinate runs
    // to infinity and every marker on the screen disappears with it.
    expect(Number.isFinite(project({ lat: 90, lng: 0 }, 14).y)).toBe(true);
    expect(Number.isFinite(project({ lat: -90, lng: 0 }, 14).y)).toBe(true);
  });
});

describe('screen space', () => {
  it('places the viewport centre at the middle of the screen', () => {
    const at = toScreen(OBELISCO, viewport());

    expect(at.x).toBeCloseTo(200, 6);
    expect(at.y).toBeCloseTo(400, 6);
  });

  it('is its own inverse', () => {
    const view = viewport();
    const somewhere = { x: 137, y: 512 };

    const roundTripped = toScreen(fromScreen(somewhere, view), view);

    expect(roundTripped.x).toBeCloseTo(somewhere.x, 6);
    expect(roundTripped.y).toBeCloseTo(somewhere.y, 6);
  });

  it('puts north up and east right', () => {
    const north = toScreen({ lat: OBELISCO.lat + 0.01, lng: OBELISCO.lng }, viewport());
    const east = toScreen({ lat: OBELISCO.lat, lng: OBELISCO.lng + 0.01 }, viewport());

    expect(north.y).toBeLessThan(400);
    expect(east.x).toBeGreaterThan(200);
  });
});

describe('viewport bounds', () => {
  it('contain the centre and are ordered', () => {
    const bounds = viewportBounds(viewport());

    expect(bounds.minLat).toBeLessThan(OBELISCO.lat);
    expect(bounds.maxLat).toBeGreaterThan(OBELISCO.lat);
    expect(bounds.minLng).toBeLessThan(OBELISCO.lng);
    expect(bounds.maxLng).toBeGreaterThan(OBELISCO.lng);
  });

  it('shrink as the map zooms in', () => {
    const wide = viewportBounds(viewport({ zoom: 12 }));
    const close = viewportBounds(viewport({ zoom: 16 }));

    expect(close.maxLng - close.minLng).toBeLessThan(wide.maxLng - wide.minLng);
  });

  it('come back to roughly the centre they were taken from', () => {
    /*
     * Roughly, and only at the zooms this is used at.
     *
     * `boundsCenter` averages the corners, and latitude is not linear in pixel
     * space, so the two disagree by more the more world is on screen: half a
     * metre at zoom 14, nine metres at zoom 12, over a thousand kilometres at
     * zoom 3. It is used on the bounds of a tapped cluster, which are small, so
     * this pins the range where the approximation holds rather than pretending
     * it is exact.
     */
    const metres = (a: number, b: number) => Math.abs(a - b) * 111_320;

    for (const [zoom, tolerance] of [
      [12, 10],
      [14, 1],
      [16, 0.1],
    ] as const) {
      const view = viewport({ zoom });
      const back = boundsCenter(viewportBounds(view));

      expect(metres(back.lat, OBELISCO.lat), `zoom ${zoom}`).toBeLessThan(tolerance);
      // Longitude *is* linear, so it comes back exactly.
      expect(back.lng).toBeCloseTo(OBELISCO.lng, 9);
    }
  });
});

describe('zoomForBounds', () => {
  it('fits a box tightly enough that its corners stay on screen', () => {
    const bounds = { minLat: -34.62, maxLat: -34.59, minLng: -58.4, maxLng: -58.36 };
    const zoom = zoomForBounds(bounds, 400, 800);

    const view: Viewport = { center: boundsCenter(bounds), zoom, width: 400, height: 800 };
    const visible = viewportBounds(view);

    expect(visible.minLat).toBeLessThanOrEqual(bounds.minLat);
    expect(visible.maxLat).toBeGreaterThanOrEqual(bounds.maxLat);
    expect(visible.minLng).toBeLessThanOrEqual(bounds.minLng);
    expect(visible.maxLng).toBeGreaterThanOrEqual(bounds.maxLng);
  });

  it('steps in rather than dividing by zero on a single point', () => {
    // A cluster of one has no span to fit. Without the guard this is `Infinity`,
    // and tapping it takes the map somewhere it cannot come back from.
    const point = { minLat: -34.6, maxLat: -34.6, minLng: -58.38, maxLng: -58.38 };

    expect(zoomForBounds(point, 400, 800)).toBe(17);
  });

  it('never leaves the usable range', () => {
    const world = { minLat: -85, maxLat: 85, minLng: -180, maxLng: 180 };

    expect(zoomForBounds(world, 400, 800)).toBeGreaterThanOrEqual(1);
    expect(zoomForBounds({ ...world, minLat: -0.000001 }, 400, 800)).toBeLessThanOrEqual(20);
  });
});

describe('metersPerPixel', () => {
  it('halves with each zoom step', () => {
    expect(metersPerPixel(0, 11)).toBeCloseTo(metersPerPixel(0, 10) / 2, 9);
  });

  it('shrinks away from the equator, which is why the scale bar is per-latitude', () => {
    expect(metersPerPixel(-34.6, 14)).toBeLessThan(metersPerPixel(0, 14));
  });
});
