'use client';

import type { MapMarker } from '@cerquita/types';
import { clusterSizeBucket, formatClusterCount, formatMoneyCompact, money } from '@cerquita/utils';
import { Countdown } from './Countdown';
import styles from './Marker.module.css';

export interface MarkerProps {
  marker: MapMarker;
  x: number;
  y: number;
  selected: boolean;
  hovered: boolean;
  onActivate: () => void;
  onHover: (entering: boolean) => void;
}

/**
 * A map marker (spec §9).
 *
 * The marker carries the information that decides whether the listing is worth
 * a tap: price, type, distance, countdown, and the social relationship. Each
 * variant reads a distinct semantic token (`sale`, `auction`, `wanted`,
 * `friend`, `store`) so the type is legible at a glance and stays correct when
 * the exported design replaces the palette.
 */
export function Marker({ marker, x, y, selected, hovered, onActivate, onHover }: MarkerProps) {
  const className = [
    styles.marker,
    styles[markerVariant(marker)],
    selected ? styles.selected : '',
    hovered ? styles.hovered : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <button
      type="button"
      className={className}
      style={{ left: x, top: y }}
      onClick={(event) => {
        event.stopPropagation();
        onActivate();
      }}
      onPointerEnter={() => onHover(true)}
      onPointerLeave={() => onHover(false)}
      aria-label={markerLabel(marker)}
      aria-pressed={selected}
    >
      <MarkerBody marker={marker} />
    </button>
  );
}

function MarkerBody({ marker }: { marker: MapMarker }) {
  if (marker.type === 'cluster') {
    const bucket = clusterSizeBucket(marker.count);
    return (
      <span className={`${styles.cluster} ${styles[`cluster_${bucket}`]} numeric`}>
        {formatClusterCount(marker.count)}
      </span>
    );
  }

  if (marker.type === 'store') {
    return (
      <span className={styles.body}>
        <span className={styles.title}>{marker.name}</span>
        <span className={styles.meta}>
          +{marker.activeListingCount} producto{marker.activeListingCount === 1 ? '' : 's'}
        </span>
        {marker.hasActivePromotion && <span className={styles.flash}>Promo</span>}
      </span>
    );
  }

  const price = marker.price ?? marker.maxBudget;

  return (
    <span className={styles.body}>
      {marker.kind === 'wanted' && <span className={styles.tag}>BUSCO</span>}
      {marker.kind === 'auction' && <span className={styles.tag}>SUBASTA</span>}
      {marker.tier === 'friend' && <span className={styles.tagSocial}>AMIGO</span>}
      {marker.tier === 'follower' && marker.kind === 'sale' && (
        <span className={styles.tagSocial}>SIGUIENDO</span>
      )}

      <span className={styles.title}>{marker.title}</span>

      {price && (
        <span className={`${styles.price} numeric`}>
          {marker.kind === 'wanted' && <span className={styles.upTo}>Hasta </span>}
          {formatMoneyCompact(money(price.amount, price.currency))}
        </span>
      )}

      {marker.auctionEndsAt && (
        <span className={styles.countdown}>
          <Countdown endsAt={marker.auctionEndsAt} compact />
        </span>
      )}

      {marker.distanceMeters !== undefined && (
        <span className={styles.meta}>{formatDistanceShort(marker.distanceMeters)}</span>
      )}
    </span>
  );
}

function markerVariant(
  marker: MapMarker,
): 'clusterMarker' | 'sale' | 'auction' | 'wanted' | 'store' {
  if (marker.type === 'cluster') return 'clusterMarker';
  if (marker.type === 'store') return 'store';
  if (marker.kind === 'auction') return 'auction';
  if (marker.kind === 'wanted') return 'wanted';
  return 'sale';
}

/** Screen-reader label. A pin with no text is invisible to assistive tech. */
function markerLabel(marker: MapMarker): string {
  if (marker.type === 'cluster') {
    return `${marker.count} publicaciones en esta zona. Activar para acercar.`;
  }
  if (marker.type === 'store') {
    return `Tienda ${marker.name}, ${marker.activeListingCount} productos activos`;
  }

  const kind =
    marker.kind === 'auction' ? 'Subasta' : marker.kind === 'wanted' ? 'Busco' : 'En venta';
  const price = marker.price ?? marker.maxBudget;
  const priceText = price ? `, ${formatMoneyCompact(money(price.amount, price.currency))}` : '';
  const distance =
    marker.distanceMeters !== undefined ? `, a ${formatDistanceShort(marker.distanceMeters)}` : '';

  return `${kind}: ${marker.title}${priceText}${distance}`;
}

function formatDistanceShort(meters: number): string {
  if (meters < 1000) return `${meters} m`;
  const km = meters / 1000;
  return `${km % 1 === 0 ? km : km.toFixed(1).replace('.', ',')} km`;
}
