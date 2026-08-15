'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Coordinates } from '@cerquita/utils';
import { fromScreen, project } from '@/lib/projection';
import styles from './LocationPicker.module.css';

/** Buenos Aires. Only used until the browser or the user says otherwise. */
const FALLBACK_CENTER: Coordinates = { lat: -34.6037, lng: -58.3816 };

const ZOOM = 15;

/**
 * Roughly the radius the API fuzzes a public point by. Drawn to scale so the
 * seller can see how vague the published circle is.
 */
const APPROX_FUZZ_METRES = 350;

/**
 * Picks the exact location of a listing.
 *
 * The exact point is stored privately and never served back: buyers only ever
 * see a fuzzed point inside a circle (spec §10, §47). That is a promise the
 * seller has to be able to believe, so the circle is drawn to scale on the same
 * map as the pin rather than described in a sentence underneath it.
 */
export function LocationPicker({
  value,
  onChange,
}: {
  value: Coordinates | null;
  onChange: (value: Coordinates) => void;
}) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [center, setCenter] = useState<Coordinates>(value ?? FALLBACK_CENTER);
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const element = canvasRef.current;
    if (!element) return;

    const observer = new ResizeObserver(([entry]) => {
      if (entry) setSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const locate = useCallback(() => {
    if (!navigator.geolocation) {
      setError('Tu navegador no permite ubicarte. Tocá el mapa para marcar el lugar.');
      return;
    }

    setLocating(true);
    setError(null);

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const found = { lat: position.coords.latitude, lng: position.coords.longitude };
        setCenter(found);
        onChange(found);
        setLocating(false);
      },
      () => {
        // Denied permission is a choice, not a failure — the map still works.
        setError('No pudimos ubicarte. Tocá el mapa para marcar el lugar.');
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  }, [onChange]);

  const pin = value
    ? screenPositionOf(value, center, size)
    : { x: size.width / 2, y: size.height / 2 };

  // Metres per pixel at this latitude and zoom, so the halo is the real size.
  const metresPerPixel = (156543.03392 * Math.cos((center.lat * Math.PI) / 180)) / 2 ** ZOOM;
  const haloDiameter = (APPROX_FUZZ_METRES / metresPerPixel) * 2;

  const template = process.env.NEXT_PUBLIC_MAP_TILE_URL;

  return (
    <div className={styles.picker}>
      <div
        ref={canvasRef}
        className={styles.canvas}
        role="application"
        aria-label="Elegí dónde está"
        onClick={(event) => {
          const bounds = event.currentTarget.getBoundingClientRect();
          const point = { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
          onChange(
            fromScreen(point, { center, zoom: ZOOM, width: bounds.width, height: bounds.height }),
          );
        }}
      >
        {template && size.width > 0 && (
          <div className={styles.tiles}>
            {tilesFor(center, size).map((tile) => (
              <img
                key={tile.key}
                className={styles.tile}
                src={template
                  .replace('{z}', String(ZOOM))
                  .replace('{x}', String(tile.x))
                  .replace('{y}', String(tile.y))}
                alt=""
                style={{ left: tile.left, top: tile.top }}
              />
            ))}
          </div>
        )}

        {value && (
          <>
            <span
              className={styles.halo}
              style={{ left: pin.x, top: pin.y, width: haloDiameter, height: haloDiameter }}
            />
            <span className={styles.pin} style={{ left: pin.x, top: pin.y }} />
          </>
        )}
      </div>

      <div className={styles.row}>
        <button type="button" className={styles.button} onClick={locate} disabled={locating}>
          {locating ? 'Ubicando…' : 'Usar mi ubicación'}
        </button>
        {value && (
          <span className={styles.coords}>
            {value.lat.toFixed(5)}, {value.lng.toFixed(5)}
          </span>
        )}
      </div>

      <p className={styles.hint}>
        {error ??
          'Marcá dónde está. Nadie ve este punto: los compradores ven el círculo naranja, de unos ' +
            `${APPROX_FUZZ_METRES} metros, y la dirección exacta la acordás por chat.`}
      </p>
    </div>
  );
}

function screenPositionOf(
  target: Coordinates,
  center: Coordinates,
  size: { width: number; height: number },
) {
  const centerPoint = project(center, ZOOM);
  const targetPoint = project(target, ZOOM);
  return {
    x: targetPoint.x - centerPoint.x + size.width / 2,
    y: targetPoint.y - centerPoint.y + size.height / 2,
  };
}

/** The tiles covering the canvas at a fixed zoom. */
function tilesFor(center: Coordinates, size: { width: number; height: number }) {
  const centerPx = project(center, ZOOM);
  const maxTile = 2 ** ZOOM - 1;

  const tiles: Array<{ key: string; x: number; y: number; left: number; top: number }> = [];

  for (
    let x = Math.floor((centerPx.x - size.width / 2) / 256);
    x <= Math.floor((centerPx.x + size.width / 2) / 256);
    x += 1
  ) {
    for (
      let y = Math.floor((centerPx.y - size.height / 2) / 256);
      y <= Math.floor((centerPx.y + size.height / 2) / 256);
      y += 1
    ) {
      if (y < 0 || y > maxTile) continue;
      tiles.push({
        key: `${x}/${y}`,
        x: ((x % (maxTile + 1)) + maxTile + 1) % (maxTile + 1),
        y,
        left: x * 256 - centerPx.x + size.width / 2,
        top: y * 256 - centerPx.y + size.height / 2,
      });
    }
  }

  return tiles;
}
