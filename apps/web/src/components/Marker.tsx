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
 * A map marker, direction 1a.
 *
 * Three stacked parts — photo, price bubble overlapping it, caption underneath —
 * that read as one object. Which is a deliberate choice from the export: the
 * thing you recognise on a map is the *photo*, and the price is what decides
 * whether you tap. A text-only pin makes every listing look identical.
 *
 * Relationship is encoded in the RING, not in extra text: a teal ring means
 * friend. Auctions swap the price for a countdown in an orange bubble. Wanted
 * posts are not photos at all — they are outlined pills, because there is no
 * item to show yet.
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
    return (
      <span className={`${styles.cluster} ${styles[`cluster_${clusterSizeBucket(marker.count)}`]}`}>
        {formatClusterCount(marker.count)}
      </span>
    );
  }

  if (marker.type === 'store') {
    return (
      <span className={styles.storePill}>
        <span className={styles.storeName}>{marker.name}</span>
        <span className={styles.storeCount}>
          +{marker.activeListingCount} producto{marker.activeListingCount === 1 ? '' : 's'}
        </span>
        {marker.hasActivePromotion && <span className={styles.storePromo}>Promo</span>}
      </span>
    );
  }

  // "Busco" has no product photo — there is nothing to photograph yet.
  if (marker.kind === 'wanted') {
    return (
      <span className={styles.wantedPill}>
        <span className={styles.wantedAvatar} aria-hidden="true">
          ?
        </span>
        <span>
          <span className={styles.wantedLabel}>BUSCA</span>
          <span className={styles.wantedTitle}>{truncate(marker.title, 18)}</span>
        </span>
      </span>
    );
  }

  const isAuction = marker.kind === 'auction';
  const price = marker.price;

  return (
    <>
      <span className={styles.thumb}>
        {marker.thumbnailUrl ? (
          <img className={styles.thumbImage} src={marker.thumbnailUrl} alt="" loading="lazy" />
        ) : (
          <span className={styles.thumbPlaceholder}>{truncate(marker.title, 10)}</span>
        )}
      </span>

      <span className={styles.bubble}>
        {isAuction && marker.auctionEndsAt ? (
          <Countdown endsAt={marker.auctionEndsAt} compact />
        ) : price ? (
          formatMoneyCompact(money(price.amount, price.currency))
        ) : (
          '—'
        )}
      </span>

      <Caption marker={marker} isAuction={isAuction} />
    </>
  );
}

/**
 * The caption carries whichever fact matters most for this marker: the
 * relationship if there is one, the type if it is an auction, otherwise distance.
 * Showing all three at once would turn the map into a wall of text.
 */
function Caption({ marker, isAuction }: { marker: MapMarker; isAuction: boolean }) {
  if (marker.type !== 'listing') return null;

  if (marker.tier === 'friend') {
    return <span className={`${styles.caption} ${styles.captionFriend}`}>AMIGO</span>;
  }
  if (isAuction) {
    return <span className={`${styles.caption} ${styles.captionAuction}`}>SUBASTA</span>;
  }
  if (marker.distanceMeters !== undefined) {
    return <span className={styles.caption}>{formatDistanceShort(marker.distanceMeters)}</span>;
  }
  return null;
}

function markerVariant(
  marker: MapMarker,
): 'clusterMarker' | 'sale' | 'auction' | 'wanted' | 'store' | 'friend' {
  if (marker.type === 'cluster') return 'clusterMarker';
  if (marker.type === 'store') return 'store';
  if (marker.kind === 'wanted') return 'wanted';
  if (marker.kind === 'auction') return 'auction';
  // The friend ring wins over the default sale treatment.
  if (marker.tier === 'friend') return 'friend';
  return 'sale';
}

/** Screen-reader label. A pin with no text is invisible to assistive tech. */
function markerLabel(marker: MapMarker): string {
  if (marker.type === 'cluster') {
    return `${marker.count} publicaciones en esta zona. Activar para acercar.`;
  }
  if (marker.type === 'store') {
    // A shop with exactly one thing for sale is an ordinary state, and the
    // screen reader is the one place nobody proof-reads.
    const products = marker.activeListingCount === 1 ? 'producto activo' : 'productos activos';
    return `Tienda ${marker.name}, ${marker.activeListingCount} ${products}`;
  }

  const kind =
    marker.kind === 'auction' ? 'Subasta' : marker.kind === 'wanted' ? 'Busco' : 'En venta';
  const price = marker.price ?? marker.maxBudget;
  const priceText = price ? `, ${formatMoneyCompact(money(price.amount, price.currency))}` : '';
  const relationship = marker.tier === 'friend' ? ', de un amigo' : '';
  const distance =
    marker.distanceMeters !== undefined ? `, a ${formatDistanceShort(marker.distanceMeters)}` : '';

  return `${kind}: ${marker.title}${priceText}${relationship}${distance}`;
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function formatDistanceShort(meters: number): string {
  if (meters < 1000) return `${meters} m`;
  const km = meters / 1000;
  return `${km % 1 === 0 ? km : km.toFixed(1).replace('.', ',')} km`;
}
