import { describe, expect, it } from 'vitest';
import {
  boundingBoxAround,
  bucketDistanceMeters,
  distanceMeters,
  formatDistance,
  fuzzCoordinates,
  GeoError,
  parseBoundingBox,
  serializeBoundingBox,
} from './geo.js';

// Two points in Buenos Aires roughly 1.1 km apart.
const OBELISCO = { lat: -34.6037, lng: -58.3816 };
const CONGRESO = { lat: -34.6097, lng: -58.3925 };

describe('distance', () => {
  it('measures a known short distance within tolerance', () => {
    const meters = distanceMeters(OBELISCO, CONGRESO);
    expect(meters).toBeGreaterThan(1000);
    expect(meters).toBeLessThan(1400);
  });

  it('is zero for identical points and symmetric', () => {
    expect(distanceMeters(OBELISCO, OBELISCO)).toBeCloseTo(0);
    expect(distanceMeters(OBELISCO, CONGRESO)).toBeCloseTo(distanceMeters(CONGRESO, OBELISCO));
  });
});

describe('formatDistance', () => {
  it('renders sub-kilometre distances in rounded metres', () => {
    expect(formatDistance(812)).toBe('800 m');
    expect(formatDistance(10)).toBe('50 m');
  });

  it('renders kilometres with one decimal below 10 km', () => {
    expect(formatDistance(1400)).toMatch(/1,4\s?km/);
  });
});

describe('bbox parsing', () => {
  it('round-trips GeoJSON ordering', () => {
    const box = parseBoundingBox('-58.5,-34.7,-58.3,-34.5');
    expect(box).toEqual({ minLng: -58.5, minLat: -34.7, maxLng: -58.3, maxLat: -34.5 });
    expect(serializeBoundingBox(box)).toBe('-58.5,-34.7,-58.3,-34.5');
  });

  it('rejects malformed and inverted boxes', () => {
    expect(() => parseBoundingBox('1,2,3')).toThrow(GeoError);
    expect(() => parseBoundingBox('a,b,c,d')).toThrow(GeoError);
    // maxLat below minLat
    expect(() => parseBoundingBox('-58.5,-34.5,-58.3,-34.7')).toThrow(GeoError);
  });
});

describe('boundingBoxAround', () => {
  it('contains the whole circle it circumscribes', () => {
    const box = boundingBoxAround(OBELISCO, 5000);
    expect(box.minLat).toBeLessThan(OBELISCO.lat);
    expect(box.maxLat).toBeGreaterThan(OBELISCO.lat);
    expect(distanceMeters(OBELISCO, { lat: box.maxLat, lng: OBELISCO.lng })).toBeGreaterThanOrEqual(
      4900,
    );
  });
});

describe('fuzzCoordinates (spec §100)', () => {
  it('is deterministic for the same seed, so the point cannot be averaged out', () => {
    const first = fuzzCoordinates(OBELISCO, 'listing-1');
    const second = fuzzCoordinates(OBELISCO, 'listing-1');
    expect(first).toEqual(second);
  });

  it('moves the point, and never reveals the exact one', () => {
    const fuzzed = fuzzCoordinates(OBELISCO, 'listing-1');
    expect(fuzzed).not.toEqual(OBELISCO);
  });

  it('stays within the requested radius', () => {
    for (let index = 0; index < 200; index += 1) {
      const fuzzed = fuzzCoordinates(OBELISCO, `listing-${index}`, 350);
      // Small tolerance for the spherical approximation.
      expect(distanceMeters(OBELISCO, fuzzed)).toBeLessThanOrEqual(360);
    }
  });

  it('produces different points for different listings at the same address', () => {
    const a = fuzzCoordinates(OBELISCO, 'listing-a');
    const b = fuzzCoordinates(OBELISCO, 'listing-b');
    expect(a).not.toEqual(b);
  });
});

describe('bucketDistanceMeters', () => {
  it('coarsens distances so they cannot be trilaterated', () => {
    expect(bucketDistanceMeters(812)).toBe(800);
    expect(bucketDistanceMeters(120)).toBe(300);
    expect(bucketDistanceMeters(3400)).toBe(3000);
  });
});
