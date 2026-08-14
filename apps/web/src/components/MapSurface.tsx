'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { MapMarker } from '@cerquita/types';
import type { Coordinates } from '@cerquita/utils';
import {
  boundsCenter,
  fromScreen,
  metersPerPixel,
  toScreen,
  zoomForBounds,
  type Viewport,
} from '@/lib/projection';
import { Marker } from './Marker';
import styles from './MapSurface.module.css';

export interface MapSurfaceProps {
  center: Coordinates;
  zoom: number;
  markers: MapMarker[];
  selectedId?: string;
  hoveredId?: string;
  loading?: boolean;
  /** Fires after the user finishes panning or zooming, debounced by the parent. */
  onViewportChange: (viewport: {
    center: Coordinates;
    zoom: number;
    width: number;
    height: number;
  }) => void;
  onMarkerClick?: (marker: MapMarker) => void;
  onMarkerHover?: (id: string | undefined) => void;
  /**
   * Raster tile template, e.g. `https://…/{z}/{x}/{y}.png`. Optional on purpose:
   * the map is fully functional without it, so development needs no tile
   * provider and no API key.
   */
  tileUrlTemplate?: string;
}

/**
 * The map (spec §9, §61).
 *
 * Markers are positioned by real Web Mercator projection rather than a fake
 * linear mapping, so the surface behaves like a map: panning is geographically
 * correct, zoom steps are power-of-two, and a raster tile layer can be dropped
 * in without moving a single marker.
 *
 * Interaction is drag-to-pan, wheel/buttons-to-zoom, with keyboard equivalents —
 * a mouse-only map is unusable for anyone navigating by keyboard (spec §68).
 */
export function MapSurface({
  center,
  zoom,
  markers,
  selectedId,
  hoveredId,
  loading,
  onViewportChange,
  onMarkerClick,
  onMarkerHover,
  tileUrlTemplate,
}: MapSurfaceProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const dragState = useRef<{ startX: number; startY: number; moved: boolean } | null>(null);

  // Track the container's real size; the projection needs pixel dimensions.
  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;

    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (rect) setSize({ width: rect.width, height: rect.height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const viewport: Viewport = { center, zoom, width: size.width, height: size.height };

  const commitViewport = useCallback(
    (next: { center: Coordinates; zoom: number }) => {
      onViewportChange({ ...next, width: size.width, height: size.height });
    },
    [onViewportChange, size.width, size.height],
  );

  /** Converts an in-progress drag (pixels) into a new geographic centre. */
  const centerAfterDrag = useCallback(
    (offsetX: number, offsetY: number): Coordinates =>
      fromScreen(
        { x: size.width / 2 - offsetX, y: size.height / 2 - offsetY },
        { center, zoom, width: size.width, height: size.height },
      ),
    [center, zoom, size.width, size.height],
  );

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    dragState.current = { startX: event.clientX, startY: event.clientY, moved: false };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragState.current;
    if (!drag) return;

    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;

    // A few pixels of travel is a click, not a drag — otherwise every marker tap
    // would also nudge the map.
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) drag.moved = true;
    setDragOffset({ x: dx, y: dy });
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragState.current;
    dragState.current = null;
    if (!drag) return;

    event.currentTarget.releasePointerCapture(event.pointerId);

    if (drag.moved) {
      commitViewport({ center: centerAfterDrag(dragOffset.x, dragOffset.y), zoom });
    }
    setDragOffset({ x: 0, y: 0 });
  };

  const handleWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    const delta = event.deltaY > 0 ? -1 : 1;
    const nextZoom = Math.max(3, Math.min(19, zoom + delta));
    if (nextZoom !== zoom) commitViewport({ center, zoom: nextZoom });
  };

  const step = (dx: number, dy: number) => {
    commitViewport({ center: centerAfterDrag(dx, dy), zoom });
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const PAN = 80;
    switch (event.key) {
      case 'ArrowLeft':
        event.preventDefault();
        step(PAN, 0);
        break;
      case 'ArrowRight':
        event.preventDefault();
        step(-PAN, 0);
        break;
      case 'ArrowUp':
        event.preventDefault();
        step(0, PAN);
        break;
      case 'ArrowDown':
        event.preventDefault();
        step(0, -PAN);
        break;
      case '+':
      case '=':
        event.preventDefault();
        commitViewport({ center, zoom: Math.min(19, zoom + 1) });
        break;
      case '-':
        event.preventDefault();
        commitViewport({ center, zoom: Math.max(3, zoom - 1) });
        break;
      default:
        break;
    }
  };

  const handleMarkerActivate = (marker: MapMarker) => {
    if (marker.type === 'cluster') {
      // Tapping a cluster zooms to the extent of what it contains.
      commitViewport({
        center: boundsCenter(marker.bounds),
        zoom: Math.max(zoom + 1, zoomForBounds(marker.bounds, size.width, size.height)),
      });
      return;
    }
    onMarkerClick?.(marker);
  };

  const scaleMeters = size.width > 0 ? Math.round(metersPerPixel(center.lat, zoom) * 100) : 0;

  return (
    <div
      ref={containerRef}
      className={styles.surface}
      role="application"
      aria-label="Mapa de publicaciones cercanas"
      aria-busy={loading}
      tabIndex={0}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onWheel={handleWheel}
      onKeyDown={handleKeyDown}
    >
      {tileUrlTemplate ? (
        <TileLayer viewport={viewport} offset={dragOffset} template={tileUrlTemplate} />
      ) : (
        <div className={styles.grid} aria-hidden="true" />
      )}

      <div
        className={styles.markerLayer}
        style={{ transform: `translate3d(${dragOffset.x}px, ${dragOffset.y}px, 0)` }}
      >
        {size.width > 0 &&
          markers.map((marker) => {
            const position = toScreen(marker.point, viewport);
            // Skip anything well outside the frame rather than mounting it.
            if (
              position.x < -120 ||
              position.y < -120 ||
              position.x > size.width + 120 ||
              position.y > size.height + 120
            ) {
              return null;
            }

            return (
              <Marker
                key={marker.id}
                marker={marker}
                x={position.x}
                y={position.y}
                selected={marker.id === selectedId}
                hovered={marker.id === hoveredId}
                onActivate={() => handleMarkerActivate(marker)}
                onHover={(entering) => onMarkerHover?.(entering ? marker.id : undefined)}
              />
            );
          })}
      </div>

      {loading && (
        <div className={styles.loadingBar} role="status">
          <span className="sr-only">Buscando publicaciones…</span>
        </div>
      )}

      <div className={styles.scale} aria-hidden="true">
        <span className={styles.scaleBar} />
        <span className="numeric">
          {scaleMeters >= 1000 ? `${(scaleMeters / 1000).toFixed(1)} km` : `${scaleMeters} m`}
        </span>
      </div>

      <div className={styles.zoomControls}>
        <button
          type="button"
          onClick={() => commitViewport({ center, zoom: Math.min(19, zoom + 1) })}
          aria-label="Acercar"
        >
          +
        </button>
        <button
          type="button"
          onClick={() => commitViewport({ center, zoom: Math.max(3, zoom - 1) })}
          aria-label="Alejar"
        >
          −
        </button>
      </div>
    </div>
  );
}

/**
 * Raster tile layer. Rendered only when a template is configured, so the app has
 * no hard dependency on a tile provider.
 */
function TileLayer({
  viewport,
  offset,
  template,
}: {
  viewport: Viewport;
  offset: { x: number; y: number };
  template: string;
}) {
  const z = Math.round(viewport.zoom);
  const scale = 256 * 2 ** z;
  const centerPx = {
    x: ((viewport.center.lng + 180) / 360) * scale,
    y:
      (0.5 -
        Math.log(
          (1 + Math.sin((viewport.center.lat * Math.PI) / 180)) /
            (1 - Math.sin((viewport.center.lat * Math.PI) / 180)),
        ) /
          (4 * Math.PI)) *
      scale,
  };

  const minX = Math.floor((centerPx.x - viewport.width / 2) / 256);
  const maxX = Math.floor((centerPx.x + viewport.width / 2) / 256);
  const minY = Math.floor((centerPx.y - viewport.height / 2) / 256);
  const maxY = Math.floor((centerPx.y + viewport.height / 2) / 256);
  const maxTile = 2 ** z - 1;

  const tiles: Array<{ key: string; url: string; left: number; top: number }> = [];
  for (let x = minX; x <= maxX; x += 1) {
    for (let y = minY; y <= maxY; y += 1) {
      if (y < 0 || y > maxTile) continue;
      const wrappedX = ((x % (maxTile + 1)) + maxTile + 1) % (maxTile + 1);
      tiles.push({
        key: `${z}/${x}/${y}`,
        url: template
          .replace('{z}', String(z))
          .replace('{x}', String(wrappedX))
          .replace('{y}', String(y)),
        left: x * 256 - centerPx.x + viewport.width / 2,
        top: y * 256 - centerPx.y + viewport.height / 2,
      });
    }
  }

  return (
    <div
      className={styles.tileLayer}
      aria-hidden="true"
      style={{ transform: `translate3d(${offset.x}px, ${offset.y}px, 0)` }}
    >
      {tiles.map((tile) => (
        <img
          key={tile.key}
          src={tile.url}
          alt=""
          width={256}
          height={256}
          loading="lazy"
          style={{ position: 'absolute', left: tile.left, top: tile.top }}
        />
      ))}
    </div>
  );
}
