/**
 * Geographic primitives shared by the API, the map endpoints and the clients.
 *
 * The authoritative geo queries run in PostGIS. These helpers exist for the
 * things that must also work client-side: validating a viewport, formatting a
 * distance, and computing the public (fuzzed) location of a private point.
 */

export interface Coordinates {
  /** Degrees, -90..90. */
  readonly lat: number;
  /** Degrees, -180..180. */
  readonly lng: number;
}

export interface BoundingBox {
  readonly minLat: number;
  readonly minLng: number;
  readonly maxLat: number;
  readonly maxLng: number;
}

export const EARTH_RADIUS_M = 6_371_008.8;

export class GeoError extends Error {}

export function isValidCoordinates(value: unknown): value is Coordinates {
  if (typeof value !== 'object' || value === null) return false;
  const { lat, lng } = value as Partial<Coordinates>;
  return (
    typeof lat === 'number' &&
    typeof lng === 'number' &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180
  );
}

export function assertCoordinates(value: unknown): Coordinates {
  if (!isValidCoordinates(value)) {
    throw new GeoError(`Invalid coordinates: ${JSON.stringify(value)}`);
  }
  return value;
}

const toRadians = (degrees: number): number => (degrees * Math.PI) / 180;
const toDegrees = (radians: number): number => (radians * 180) / Math.PI;

/**
 * Great-circle distance in metres (haversine).
 *
 * Accurate to ~0.5% — more than enough for "800 m" labels. Ordering and radius
 * filtering are done by PostGIS with a geography type, not by this function.
 */
export function distanceMeters(a: Coordinates, b: Coordinates): number {
  const dLat = toRadians(b.lat - a.lat);
  const dLng = toRadians(b.lng - a.lng);
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);

  const h = Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Human distance label, matching the design's marker copy ("800 m", "1,4 km").
 * Below 1 km it rounds to 50 m so the number does not imply false precision —
 * public locations are fuzzed anyway (see `fuzzCoordinates`).
 */
export function formatDistance(meters: number, locale = 'es-AR'): string {
  if (!Number.isFinite(meters) || meters < 0) return '';
  if (meters < 1000) {
    const rounded = Math.max(50, Math.round(meters / 50) * 50);
    return `${new Intl.NumberFormat(locale).format(rounded)} m`;
  }
  const km = meters / 1000;
  const decimals = km < 10 ? 1 : 0;
  return `${new Intl.NumberFormat(locale, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(km)} km`;
}

export function isValidBoundingBox(value: unknown): value is BoundingBox {
  if (typeof value !== 'object' || value === null) return false;
  const box = value as Partial<BoundingBox>;
  return (
    typeof box.minLat === 'number' &&
    typeof box.minLng === 'number' &&
    typeof box.maxLat === 'number' &&
    typeof box.maxLng === 'number' &&
    box.minLat >= -90 &&
    box.maxLat <= 90 &&
    box.minLat <= box.maxLat &&
    box.minLng >= -180 &&
    box.maxLng <= 180 &&
    box.minLng <= box.maxLng
  );
}

/** Parses the `bbox=minLng,minLat,maxLng,maxLat` query parameter (GeoJSON order). */
export function parseBoundingBox(input: string): BoundingBox {
  const parts = input.split(',').map((part) => Number(part.trim()));
  if (parts.length !== 4 || parts.some((part) => !Number.isFinite(part))) {
    throw new GeoError(`bbox must be "minLng,minLat,maxLng,maxLat", received "${input}"`);
  }
  const [minLng, minLat, maxLng, maxLat] = parts as [number, number, number, number];
  const box = { minLat, minLng, maxLat, maxLng };
  if (!isValidBoundingBox(box)) throw new GeoError(`Invalid bbox "${input}"`);
  return box;
}

export function serializeBoundingBox(box: BoundingBox): string {
  return `${box.minLng},${box.minLat},${box.maxLng},${box.maxLat}`;
}

export function boundingBoxCenter(box: BoundingBox): Coordinates {
  return {
    lat: (box.minLat + box.maxLat) / 2,
    lng: (box.minLng + box.maxLng) / 2,
  };
}

export function containsPoint(box: BoundingBox, point: Coordinates): boolean {
  return (
    point.lat >= box.minLat &&
    point.lat <= box.maxLat &&
    point.lng >= box.minLng &&
    point.lng <= box.maxLng
  );
}

/** Approximate diagonal of the viewport, used to pick a default search radius. */
export function boundingBoxDiagonalMeters(box: BoundingBox): number {
  return distanceMeters({ lat: box.minLat, lng: box.minLng }, { lat: box.maxLat, lng: box.maxLng });
}

/** Grows a bbox by a ratio on each side. Used to prefetch just past the viewport. */
export function expandBoundingBox(box: BoundingBox, ratio: number): BoundingBox {
  const latPad = ((box.maxLat - box.minLat) * ratio) / 2;
  const lngPad = ((box.maxLng - box.minLng) * ratio) / 2;
  return {
    minLat: Math.max(-90, box.minLat - latPad),
    maxLat: Math.min(90, box.maxLat + latPad),
    minLng: Math.max(-180, box.minLng - lngPad),
    maxLng: Math.min(180, box.maxLng + lngPad),
  };
}

/** Bounding box that circumscribes a circle. Cheap pre-filter before a PostGIS radius test. */
export function boundingBoxAround(center: Coordinates, radiusMeters: number): BoundingBox {
  const latDelta = toDegrees(radiusMeters / EARTH_RADIUS_M);
  const cosLat = Math.cos(toRadians(center.lat));
  // Near the poles the longitude delta explodes; clamp to the whole range.
  const lngDelta =
    Math.abs(cosLat) < 1e-9 ? 180 : toDegrees(radiusMeters / (EARTH_RADIUS_M * cosLat));

  return {
    minLat: Math.max(-90, center.lat - latDelta),
    maxLat: Math.min(90, center.lat + latDelta),
    minLng: Math.max(-180, center.lng - Math.abs(lngDelta)),
    maxLng: Math.min(180, center.lng + Math.abs(lngDelta)),
  };
}

/**
 * Deterministically offsets a private coordinate to produce the PUBLIC location
 * (spec §10, §100).
 *
 * Properties that matter:
 *  - Deterministic per `seed` (the listing id), so the public point does not
 *    wander between requests. A wandering point can be averaged out to recover
 *    the true location.
 *  - Offset is uniform over the disc of `radiusMeters`, not over (r, angle),
 *    which would cluster points near the centre.
 *
 * This is obfuscation, not anonymity: exact coordinates simply must never leave
 * the server, which is enforced in the listing serializers.
 */
export function fuzzCoordinates(exact: Coordinates, seed: string, radiusMeters = 350): Coordinates {
  const hash = fnv1a(seed);
  // Two independent unit values from separate halves of the hash.
  const u1 = (hash % 100_003) / 100_003;
  const u2 = (Math.floor(hash / 100_003) % 100_019) / 100_019;

  const distance = radiusMeters * Math.sqrt(u1);
  const angle = 2 * Math.PI * u2;

  const latDelta = toDegrees((distance * Math.cos(angle)) / EARTH_RADIUS_M);
  const cosLat = Math.cos(toRadians(exact.lat));
  const lngDelta =
    Math.abs(cosLat) < 1e-9
      ? 0
      : toDegrees((distance * Math.sin(angle)) / (EARTH_RADIUS_M * cosLat));

  return {
    lat: clamp(exact.lat + latDelta, -90, 90),
    lng: wrapLongitude(exact.lng + lngDelta),
  };
}

function fnv1a(input: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

function wrapLongitude(lng: number): number {
  let result = lng;
  while (result > 180) result -= 360;
  while (result < -180) result += 360;
  return result;
}

/**
 * Rounds a distance into a coarse bucket for display on other people's screens,
 * so a precise "812 m" cannot be trilaterated across several viewports.
 */
export function bucketDistanceMeters(meters: number): number {
  if (meters < 500) return 300;
  if (meters < 1000) return 800;
  if (meters < 2000) return 1500;
  if (meters < 5000) return Math.round(meters / 1000) * 1000;
  return Math.round(meters / 5000) * 5000;
}
