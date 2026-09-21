/**
 * Map clustering geometry (spec §11, §129).
 *
 * The actual grouping runs in PostGIS (`ST_SnapToGrid` over a projected point),
 * because clustering client-side would mean shipping every marker to the client
 * first — exactly what §92 forbids. What lives here is the shared decision of
 * HOW COARSE the grid is at a given zoom, so the server and the client agree on
 * what a cluster means and the client can predict when a cluster will split.
 */

/** Web-mercator tile zoom levels we support. */
export const MIN_ZOOM = 0;
export const MAX_ZOOM = 22;

/**
 * Zoom at and above which the server stops clustering and returns individual
 * listings. Below this, markers are too dense to be useful.
 */
export const INDIVIDUAL_MARKER_ZOOM = 15;

/** Hard cap on markers returned for one viewport request. */
export const MAX_MARKERS_PER_VIEWPORT = 200;

/**
 * Grid cell size in degrees for a zoom level.
 *
 * A web-mercator tile spans 360/2^zoom degrees of longitude. Using a fraction of
 * a tile gives a cell that stays visually constant as the user zooms, so
 * clusters split at a predictable rate (128 -> 38 -> 12 -> 5 -> individual).
 */
export function gridSizeDegrees(zoom: number, cellsPerTile = 4): number {
  const clamped = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.floor(zoom)));
  return 360 / (2 ** clamped * cellsPerTile);
}

export function shouldCluster(zoom: number): boolean {
  return zoom < INDIVIDUAL_MARKER_ZOOM;
}

/**
 * Display size bucket for a cluster bubble, so a cluster of 5 and a cluster of
 * 1200 do not render identically. Maps onto the `marker.clusterSize*` tokens.
 */
export type ClusterSizeBucket = 'sm' | 'md' | 'lg';

export function clusterSizeBucket(count: number): ClusterSizeBucket {
  if (count < 10) return 'sm';
  if (count < 100) return 'md';
  return 'lg';
}

/** Abbreviates a cluster count so it fits inside the bubble: 1234 -> "1,2k". */
export function formatClusterCount(count: number, locale = 'es-AR'): string {
  if (count < 1000) return String(count);
  if (count < 100_000) {
    return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(count / 1000)}k`;
  }
  return `${Math.round(count / 1000)}k`;
}
