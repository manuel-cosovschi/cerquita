import { Injectable } from '@nestjs/common';
import type {
  AudienceTier,
  ImageAsset,
  Listing,
  ListingSummary,
  PublicLocation,
  UserSummary,
} from '@cerquita/types';
import {
  resolvePrice,
  toResolvedPriceDto,
  type ApplicablePromotion,
  type DiscountPolicy,
} from '@cerquita/domain';
import { bucketDistanceMeters, money } from '@cerquita/utils';

/**
 * The boundary between database rows and what a client is allowed to see.
 *
 * Two invariants live here, and they are the reason listings are never returned
 * straight from Prisma anywhere in the codebase:
 *
 *  1. `exactLocation` is never emitted. Only the pre-fuzzed `publicLocation`
 *     reaches a client (spec §100).
 *  2. Prices are RESOLVED per viewer through the domain pricing rules, so the
 *     number on screen is the number the server would charge (spec §23).
 */

/** The row shape the listing queries select. Location arrives already projected. */
export interface ListingRow {
  id: string;
  kind: string;
  status: string;
  title: string;
  description: string;
  tags: string[];
  categoryId: string;
  condition: string | null;
  priceAmount: number | null;
  priceCurrency: string;
  maxBudgetAmount: number | null;
  wantedRadiusMeters: number | null;
  quantity: number;
  reserved: number;
  sold: number;
  deliveryMethods: string[];
  acceptsOffers: boolean;
  followerDiscountBps: number | null;
  friendDiscountBps: number | null;
  publicLat: number;
  publicLng: number;
  neighborhood: string | null;
  city: string | null;
  region: string | null;
  country: string | null;
  viewCount: number;
  favoriteCount: number;
  commentCount: number;
  promotedUntil: Date | null;
  publishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  sellerId: string;
  storeId: string | null;
  /** Metres from the viewer. Present only when the query supplied a centre. */
  distanceMeters?: number | null;
}

export interface SerializeContext {
  readonly tier: AudienceTier;
  readonly sellerPolicy: DiscountPolicy;
  readonly promotions?: readonly ApplicablePromotion[];
  readonly seller: UserSummary;
  readonly store?: ListingSummary['store'];
  readonly images: ImageAsset[];
  readonly isFavorite: boolean;
  /** Raw metres from the viewer; bucketed before it leaves the server. */
  readonly rawDistanceMeters?: number;
  readonly publicLocationPrecisionMeters: number;
  /** "Amigo de Nacho". Null when the viewer has no connection to the seller. */
  readonly socialProof?: string | null;
  readonly now: Date;
}

@Injectable()
export class ListingSerializer {
  toSummary(row: ListingRow, context: SerializeContext): ListingSummary {
    return {
      id: row.id,
      kind: row.kind as ListingSummary['kind'],
      status: row.status as ListingSummary['status'],
      title: row.title,
      coverImage: context.images[0],
      price: this.resolveListingPrice(row, context),
      maxBudget:
        row.maxBudgetAmount === null
          ? undefined
          : { amount: row.maxBudgetAmount, currency: row.priceCurrency as 'ARS' },
      condition: (row.condition as ListingSummary['condition']) ?? undefined,
      categoryId: row.categoryId,
      location: this.toPublicLocation(row, context),
      distanceMeters:
        context.rawDistanceMeters === undefined
          ? undefined
          : bucketDistanceMeters(context.rawDistanceMeters),
      seller: context.seller,
      store: context.store,
      isFavorite: context.isFavorite,
      isPromoted: row.promotedUntil !== null && row.promotedUntil > context.now,
      publishedAt: row.publishedAt?.toISOString(),
    };
  }

  toDetail(
    row: ListingRow,
    context: SerializeContext,
    extras: {
      priceHistory: Listing['priceHistory'];
      auction?: Listing['auction'];
    },
  ): Listing {
    const summary = this.toSummary(row, context);

    return {
      ...summary,
      auction: extras.auction,
      description: row.description,
      images: context.images,
      tags: row.tags,
      quantity: row.quantity,
      availableQuantity: Math.max(0, row.quantity - row.reserved - row.sold),
      deliveryMethods: row.deliveryMethods as Listing['deliveryMethods'],
      acceptsOffers: row.acceptsOffers,
      priceHistory: extras.priceHistory,
      viewCount: row.viewCount,
      favoriteCount: row.favoriteCount,
      commentCount: row.commentCount,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      wantedRadiusMeters: row.wantedRadiusMeters ?? undefined,
      socialProof: context.socialProof ?? null,
    };
  }

  /**
   * Resolves the price for this viewer.
   *
   * Checkout calls the same `resolvePrice` with the same inputs rather than
   * trusting this output, so the two can never disagree about what is owed.
   */
  private resolveListingPrice(row: ListingRow, context: SerializeContext): ListingSummary['price'] {
    if (row.priceAmount === null) return undefined;

    const resolution = resolvePrice({
      listPrice: money(row.priceAmount, row.priceCurrency as 'ARS'),
      tier: context.tier,
      sellerPolicy: context.sellerPolicy,
      listingOverride: {
        followerBasisPoints: row.followerDiscountBps,
        friendBasisPoints: row.friendDiscountBps,
      },
      promotions: context.promotions,
      isStoreListing: row.storeId !== null,
      now: context.now,
    });

    return toResolvedPriceDto(resolution);
  }

  private toPublicLocation(row: ListingRow, context: SerializeContext): PublicLocation {
    return {
      // Already fuzzed at write time — this is not the seller's real position.
      point: { lat: row.publicLat, lng: row.publicLng },
      precisionMeters: context.publicLocationPrecisionMeters,
      neighborhood: row.neighborhood ?? undefined,
      city: row.city ?? undefined,
      region: row.region ?? undefined,
      country: row.country ?? undefined,
    };
  }
}
