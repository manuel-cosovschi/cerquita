/**
 * Web Mercator projection (EPSG:3857), the same one tile servers use.
 *
 * The map surface positions markers by projecting lat/lng into pixel space at a
 * given zoom, so a marker sits where a tile layer would put it and swapping in
 * real tiles later is a rendering change, not a maths change.
 *
 * Shared rather than web-only because the phone needs exactly the same numbers.
 * Two implementations of Mercator would agree until they did not, and the way
 * they would disagree is a marker in the wrong place on one platform — visible
 * only to somebody holding both.
 */

import type { BoundingBox, Coordinates } from './geo.js';

export const TILE_SIZE = 256;

/** Latitude beyond which Mercator diverges; also what tile servers clamp to. */
const MAX_LATITUDE = 85.05112878;

export interface Point {
  x: number;
  y: number;
}

export function project(coords: Coordinates, zoom: number): Point {
  const scale = TILE_SIZE * 2 ** zoom;
  const lat = Math.max(-MAX_LATITUDE, Math.min(MAX_LATITUDE, coords.lat));
  const sinLat = Math.sin((lat * Math.PI) / 180);

  return {
    x: ((coords.lng + 180) / 360) * scale,
    y: (0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI)) * scale,
  };
}

export function unproject(point: Point, zoom: number): Coordinates {
  const scale = TILE_SIZE * 2 ** zoom;
  const lng = (point.x / scale) * 360 - 180;
  const n = Math.PI - 2 * Math.PI * (point.y / scale);
  const lat = (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));

  return { lat, lng };
}

export interface Viewport {
  center: Coordinates;
  zoom: number;
  width: number;
  height: number;
}

/** Screen position of a coordinate, relative to the viewport's top-left corner. */
export function toScreen(coords: Coordinates, viewport: Viewport): Point {
  const centerPoint = project(viewport.center, viewport.zoom);
  const target = project(coords, viewport.zoom);

  return {
    x: target.x - centerPoint.x + viewport.width / 2,
    y: target.y - centerPoint.y + viewport.height / 2,
  };
}

/** Inverse of `toScreen`, for click-to-locate and drag handling. */
export function fromScreen(point: Point, viewport: Viewport): Coordinates {
  const centerPoint = project(viewport.center, viewport.zoom);

  return unproject(
    {
      x: point.x + centerPoint.x - viewport.width / 2,
      y: point.y + centerPoint.y - viewport.height / 2,
    },
    viewport.zoom,
  );
}

/** The geographic bounds currently visible — this is what the map endpoint takes. */
export function viewportBounds(viewport: Viewport): BoundingBox {
  const topLeft = fromScreen({ x: 0, y: 0 }, viewport);
  const bottomRight = fromScreen({ x: viewport.width, y: viewport.height }, viewport);

  return {
    minLat: Math.min(topLeft.lat, bottomRight.lat),
    maxLat: Math.max(topLeft.lat, bottomRight.lat),
    minLng: Math.min(topLeft.lng, bottomRight.lng),
    maxLng: Math.max(topLeft.lng, bottomRight.lng),
  };
}

/** Zoom that fits a bounding box, used when a cluster is tapped. */
export function zoomForBounds(bounds: BoundingBox, width: number, height: number): number {
  const latSpan = Math.abs(bounds.maxLat - bounds.minLat);
  const lngSpan = Math.abs(bounds.maxLng - bounds.minLng);

  // A degenerate box (one marker) has no span to fit; step in instead.
  if (latSpan < 1e-9 && lngSpan < 1e-9) return 17;

  const lngZoom = Math.log2((width / TILE_SIZE) * (360 / Math.max(lngSpan, 1e-9)));
  const latZoom = Math.log2((height / TILE_SIZE) * (180 / Math.max(latSpan, 1e-9)));

  return Math.max(1, Math.min(20, Math.floor(Math.min(lngZoom, latZoom))));
}

/**
 * The arithmetic centre of a box.
 *
 * Arithmetic, not the Mercator centre — and for a big box those are not the
 * same thing, because latitude is not linear in pixel space. Feeding it the
 * bounds of a whole-world viewport and expecting the viewport's centre back is
 * off by more than a thousand kilometres; at the sizes it is actually used for
 * —the bounds of a tapped cluster— the error is under ten metres at zoom 12 and
 * half a metre at zoom 14, well inside the fuzzing every public coordinate
 * already carries.
 *
 * Written down because the failure is invisible: the map lands *near* the right
 * place, which reads as a rounding artefact rather than as the wrong function.
 */
export function boundsCenter(bounds: BoundingBox): Coordinates {
  return {
    lat: (bounds.minLat + bounds.maxLat) / 2,
    lng: (bounds.minLng + bounds.maxLng) / 2,
  };
}

/** Metres per screen pixel at a latitude and zoom — drives the scale bar. */
export function metersPerPixel(lat: number, zoom: number): number {
  return (156_543.03392 * Math.cos((lat * Math.PI) / 180)) / 2 ** zoom;
}
