'use client';

import Link from 'next/link';
import type { ListingSummary } from '@cerquita/types';
import { formatDistance, formatMoney, money } from '@cerquita/utils';
import { Price } from './Price';
import { Countdown } from './Countdown';
import { ListingImage } from './ListingImage';
import styles from './ListingCard.module.css';

export interface ListingCardProps {
  listing: ListingSummary;
  hovered?: boolean;
  selected?: boolean;
  onHover?: (id: string | undefined) => void;
  onSelect?: (id: string) => void;
}

/**
 * Result card, paired with a map marker (spec §61).
 *
 * Hovering a card highlights its marker and vice versa; the parent owns that
 * state so the two views cannot disagree.
 */
export function ListingCard({ listing, hovered, selected, onHover, onSelect }: ListingCardProps) {
  const isWanted = listing.kind === 'wanted';
  const isAuction = listing.kind === 'auction';

  return (
    <article
      className={[styles.card, hovered ? styles.hovered : '', selected ? styles.selected : '']
        .filter(Boolean)
        .join(' ')}
      onPointerEnter={() => onHover?.(listing.id)}
      onPointerLeave={() => onHover?.(undefined)}
      onFocus={() => onHover?.(listing.id)}
      onBlur={() => onHover?.(undefined)}
    >
      <Link
        href={`/listing/${listing.id}`}
        className={styles.link}
        onClick={() => onSelect?.(listing.id)}
      >
        <div className={styles.media}>
          {/* The kind tag below already says "Busco", so the stand-in does not
              repeat it — that read as a stutter on every photo-less wanted
              post, which is most of them. */}
          <ListingImage
            image={listing.coverImage}
            title={listing.title}
            className={styles.image}
            fallbackClassName={styles.imagePlaceholder}
            fallbackLabel="Sin foto"
          />

          {listing.isPromoted && <span className={styles.promoted}>Destacado</span>}
          {isAuction && <span className={styles.auctionTag}>Subasta</span>}
          {isWanted && <span className={styles.wantedTag}>Busco</span>}
        </div>

        <div className={styles.content}>
          <h3 className={styles.title}>{listing.title}</h3>

          <div className={styles.priceRow}>
            {listing.price ? (
              <Price price={listing.price} size="md" />
            ) : listing.maxBudget ? (
              <span className={`${styles.budget} numeric`}>
                Hasta {formatMoney(money(listing.maxBudget.amount, listing.maxBudget.currency))}
              </span>
            ) : null}
          </div>

          {isAuction && listing.auction && (
            <div className={styles.auctionRow}>
              <span className={styles.auctionLabel}>Oferta actual</span>
              <span className="numeric">
                {formatMoney(
                  money(listing.auction.currentPrice.amount, listing.auction.currentPrice.currency),
                )}
              </span>
              <Countdown endsAt={listing.auction.endsAt} compact />
            </div>
          )}

          <div className={styles.meta}>
            <span className={styles.seller}>
              {listing.store?.name ?? listing.seller.displayName}
              {listing.seller.verified && (
                <span className={styles.verified} title="Cuenta verificada">
                  {' '}
                  ✓<span className="sr-only">Verificado</span>
                </span>
              )}
            </span>

            {listing.distanceMeters !== undefined && (
              <span className={styles.distance}>{formatDistance(listing.distanceMeters)}</span>
            )}
          </div>

          {listing.price && listing.price.tier !== 'public' && (
            <p className={styles.socialNote}>
              {listing.price.tier === 'friend'
                ? 'Precio de amigo'
                : 'Precio para quienes lo siguen'}
            </p>
          )}
        </div>
      </Link>
    </article>
  );
}
