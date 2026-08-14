import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { ClusterMarker, ListingMarker, MapMarker, StoreMarker } from '@cerquita/types';
import type { MapQueryInput } from '@cerquita/validation';
import {
  bucketDistanceMeters,
  gridSizeDegrees,
  MAX_MARKERS_PER_VIEWPORT,
  shouldCluster,
  type Coordinates,
} from '@cerquita/utils';
import { PrismaService } from '../../prisma/prisma.service';

export interface MapQueryContext {
  readonly viewerId?: string;
  readonly viewerLocation?: Coordinates;
}

export interface MapResponse {
  readonly markers: MapMarker[];
  readonly clustered: boolean;
  readonly truncated: boolean;
}

/**
 * Viewport queries for the map (spec §9, §11, §129).
 *
 * Written as raw PostGIS SQL on purpose. Two things make this endpoint viable at
 * scale, and neither survives being expressed through the ORM:
 *
 *  1. Clustering happens IN THE DATABASE via `ST_SnapToGrid`, so a viewport over
 *     a dense city returns ~50 cluster rows instead of 50.000 listings.
 *  2. Distance and containment use the `geography` type against a GiST index, so
 *     the bbox filter is an index scan rather than a sequential comparison.
 *
 * The endpoint never returns `exactLocation` — only `publicLocation`, which was
 * fuzzed at write time.
 */
@Injectable()
export class MapService {
  constructor(private readonly prisma: PrismaService) {}

  async query(input: MapQueryInput, context: MapQueryContext): Promise<MapResponse> {
    const clustered = shouldCluster(input.zoom);

    if (clustered) {
      const markers = await this.queryClusters(input, context);
      return { markers, clustered: true, truncated: false };
    }

    const [listings, stores] = await Promise.all([
      this.queryListings(input, context),
      this.shouldIncludeStores(input) ? this.queryStores(input, context) : Promise.resolve([]),
    ]);

    const markers: MapMarker[] = [...stores, ...listings];
    return {
      markers: markers.slice(0, MAX_MARKERS_PER_VIEWPORT),
      clustered: false,
      truncated: markers.length > MAX_MARKERS_PER_VIEWPORT,
    };
  }

  /**
   * Groups listings into grid cells and returns one row per cell.
   *
   * `ST_SnapToGrid` on the geometry cast is far cheaper than a true clustering
   * algorithm and is stable across requests at the same zoom, so markers do not
   * jump around as the user pans.
   */
  private async queryClusters(
    input: MapQueryInput,
    context: MapQueryContext,
  ): Promise<MapMarker[]> {
    const gridSize = gridSizeDegrees(input.zoom);
    const envelope = this.envelope(input);
    const filters = this.listingFilters(input, context);

    const rows = await this.prisma.$queryRaw<
      Array<{
        cell_count: bigint;
        center_lng: number;
        center_lat: number;
        min_lng: number;
        min_lat: number;
        max_lng: number;
        max_lat: number;
      }>
    >(Prisma.sql`
      WITH visible AS (
        SELECT
          l."publicLocation"::geometry AS geom
        FROM "Listing" l
        WHERE l."status" IN ('active', 'reserved')
          AND ST_Intersects(l."publicLocation", ${envelope})
          ${filters}
      )
      SELECT
        COUNT(*)                                   AS cell_count,
        ST_X(ST_Centroid(ST_Collect(geom)))        AS center_lng,
        ST_Y(ST_Centroid(ST_Collect(geom)))        AS center_lat,
        ST_XMin(ST_Extent(geom))                   AS min_lng,
        ST_YMin(ST_Extent(geom))                   AS min_lat,
        ST_XMax(ST_Extent(geom))                   AS max_lng,
        ST_YMax(ST_Extent(geom))                   AS max_lat
      FROM visible
      GROUP BY ST_SnapToGrid(geom, ${gridSize}, ${gridSize})
      ORDER BY cell_count DESC
      LIMIT ${MAX_MARKERS_PER_VIEWPORT}
    `);

    return rows.map<ClusterMarker>((row, index) => ({
      type: 'cluster',
      id: `c${index}-${row.center_lng.toFixed(4)},${row.center_lat.toFixed(4)}`,
      point: { lat: row.center_lat, lng: row.center_lng },
      count: Number(row.cell_count),
      bounds: {
        minLat: row.min_lat,
        minLng: row.min_lng,
        maxLat: row.max_lat,
        maxLng: row.max_lng,
      },
    }));
  }

  private async queryListings(
    input: MapQueryInput,
    context: MapQueryContext,
  ): Promise<ListingMarker[]> {
    const envelope = this.envelope(input);
    const filters = this.listingFilters(input, context);
    const viewerPoint = this.viewerPoint(context);

    const rows = await this.prisma.$queryRaw<
      Array<{
        id: string;
        kind: string;
        title: string;
        lng: number;
        lat: number;
        price_amount: number | null;
        price_currency: string;
        max_budget_amount: number | null;
        thumbnail_url: string | null;
        auction_ends_at: Date | null;
        distance_meters: number | null;
        promoted: boolean;
        is_friend: boolean;
        is_following: boolean;
      }>
    >(Prisma.sql`
      SELECT
        l."id",
        l."kind"::text                       AS kind,
        l."title",
        ST_X(l."publicLocation"::geometry)   AS lng,
        ST_Y(l."publicLocation"::geometry)   AS lat,
        l."priceAmount"                      AS price_amount,
        l."priceCurrency"                    AS price_currency,
        l."maxBudgetAmount"                  AS max_budget_amount,
        (
          SELECT i."thumbnailUrl" FROM "ListingImage" i
          WHERE i."listingId" = l."id"
          ORDER BY i."position" ASC LIMIT 1
        )                                    AS thumbnail_url,
        a."endsAt"                           AS auction_ends_at,
        ${
          viewerPoint
            ? Prisma.sql`ST_Distance(l."publicLocation", ${viewerPoint})`
            : Prisma.sql`NULL::float8`
        }                                    AS distance_meters,
        (l."promotedUntil" IS NOT NULL AND l."promotedUntil" > NOW()) AS promoted,
        ${this.friendshipExpression(context)}  AS is_friend,
        ${this.followExpression(context)}      AS is_following
      FROM "Listing" l
      LEFT JOIN "Auction" a ON a."listingId" = l."id" AND a."status" = 'live'
      WHERE l."status" IN ('active', 'reserved')
        AND ST_Intersects(l."publicLocation", ${envelope})
        ${filters}
      ORDER BY promoted DESC, l."publishedAt" DESC NULLS LAST
      LIMIT ${MAX_MARKERS_PER_VIEWPORT}
    `);

    return rows.map((row) => ({
      type: 'listing',
      id: row.id,
      point: { lat: row.lat, lng: row.lng },
      kind: row.kind as ListingMarker['kind'],
      title: row.title,
      thumbnailUrl: row.thumbnail_url ?? undefined,
      price:
        row.price_amount === null
          ? undefined
          : { amount: row.price_amount, currency: row.price_currency as 'ARS' },
      maxBudget:
        row.max_budget_amount === null
          ? undefined
          : { amount: row.max_budget_amount, currency: row.price_currency as 'ARS' },
      // Bucketed so a precise distance cannot be used to trilaterate the seller.
      distanceMeters:
        row.distance_meters === null ? undefined : bucketDistanceMeters(row.distance_meters),
      auctionEndsAt: row.auction_ends_at?.toISOString(),
      tier: row.is_friend ? 'friend' : row.is_following ? 'follower' : undefined,
      isPromoted: row.promoted,
    }));
  }

  /**
   * Stores appear as a single marker carrying a product count, so a shop with 500
   * items does not blanket the map with 500 pins (spec §49).
   */
  private async queryStores(
    input: MapQueryInput,
    context: MapQueryContext,
  ): Promise<StoreMarker[]> {
    const envelope = this.envelope(input);
    const viewerPoint = this.viewerPoint(context);

    const rows = await this.prisma.$queryRaw<
      Array<{
        id: string;
        name: string;
        logo_url: string | null;
        lng: number;
        lat: number;
        listing_count: bigint;
        distance_meters: number | null;
        has_promotion: boolean;
      }>
    >(Prisma.sql`
      SELECT
        s."id",
        s."name",
        s."logoUrl"                        AS logo_url,
        ST_X(s."publicLocation"::geometry) AS lng,
        ST_Y(s."publicLocation"::geometry) AS lat,
        (
          SELECT COUNT(*) FROM "Listing" l
          WHERE l."storeId" = s."id" AND l."status" = 'active'
        )                                  AS listing_count,
        ${
          viewerPoint
            ? Prisma.sql`ST_Distance(s."publicLocation", ${viewerPoint})`
            : Prisma.sql`NULL::float8`
        }                                  AS distance_meters,
        EXISTS (
          SELECT 1 FROM "Promotion" p
          WHERE p."storeId" = s."id"
            AND p."active"
            AND (p."startsAt" IS NULL OR p."startsAt" <= NOW())
            AND (p."endsAt" IS NULL OR p."endsAt" > NOW())
        )                                  AS has_promotion
      FROM "Store" s
      WHERE s."publicLocation" IS NOT NULL
        AND ST_Intersects(s."publicLocation", ${envelope})
      ORDER BY listing_count DESC
      LIMIT 50
    `);

    return rows.map((row) => ({
      type: 'store',
      id: row.id,
      point: { lat: row.lat, lng: row.lng },
      name: row.name,
      logoUrl: row.logo_url ?? undefined,
      activeListingCount: Number(row.listing_count),
      distanceMeters:
        row.distance_meters === null ? undefined : bucketDistanceMeters(row.distance_meters),
      hasActivePromotion: row.has_promotion,
    }));
  }

  /** Builds the SQL fragment implementing the active layer and filter chips. */
  private listingFilters(input: MapQueryInput, context: MapQueryContext): Prisma.Sql {
    const clauses: Prisma.Sql[] = [];

    switch (input.layer) {
      case 'sales':
        clauses.push(Prisma.sql`AND l."kind" = 'sale'`);
        break;
      case 'wanted':
        clauses.push(Prisma.sql`AND l."kind" = 'wanted'`);
        break;
      case 'auctions':
        clauses.push(Prisma.sql`AND l."kind" = 'auction'`);
        break;
      case 'stores':
        clauses.push(Prisma.sql`AND l."storeId" IS NOT NULL`);
        break;
      case 'friends':
        clauses.push(this.friendOnlyClause(context));
        break;
      case 'following':
        clauses.push(this.followingOnlyClause(context));
        break;
      case 'now':
        // "Ahora" is a temporal query over existing rows, never a duplicate feed
        // of them (spec §13): auctions closing soon, fresh posts, live promos.
        clauses.push(Prisma.sql`
          AND (
            EXISTS (
              SELECT 1 FROM "Auction" a2
              WHERE a2."listingId" = l."id"
                AND a2."status" = 'live'
                AND a2."endsAt" < NOW() + INTERVAL '6 hours'
            )
            OR l."publishedAt" > NOW() - INTERVAL '24 hours'
            OR l."promotedUntil" > NOW()
            OR EXISTS (
              SELECT 1 FROM "PromotionListing" pl
              JOIN "Promotion" p ON p."id" = pl."promotionId"
              WHERE pl."listingId" = l."id"
                AND p."active"
                AND (p."endsAt" IS NULL OR p."endsAt" > NOW())
            )
          )
        `);
        break;
      case 'all':
      case 'near_me':
      default:
        break;
    }

    if (input.categoryIds?.length) {
      clauses.push(
        Prisma.sql`AND l."categoryId" = ANY(${input.categoryIds}::uuid[])`,
      );
    }
    if (input.condition) {
      clauses.push(Prisma.sql`AND l."condition" = ${input.condition}::"ItemCondition"`);
    }
    if (typeof input.minPrice === 'number') {
      clauses.push(Prisma.sql`AND l."priceAmount" >= ${input.minPrice}`);
    }
    if (typeof input.maxPrice === 'number') {
      clauses.push(Prisma.sql`AND l."priceAmount" <= ${input.maxPrice}`);
    }
    if (input.socialOnly) {
      clauses.push(
        Prisma.sql`AND (${this.friendshipExpression(context)} OR ${this.followExpression(context)})`,
      );
    }
    if (input.q?.trim()) {
      clauses.push(
        Prisma.sql`AND l."searchVector" @@ plainto_tsquery('spanish', ${input.q.trim()})`,
      );
    }

    // Hide content from users the viewer blocked, and vice versa.
    if (context.viewerId) {
      clauses.push(Prisma.sql`
        AND NOT EXISTS (
          SELECT 1 FROM "Block" b
          WHERE (b."blockerId" = ${context.viewerId}::uuid AND b."blockedId" = l."sellerId")
             OR (b."blockedId" = ${context.viewerId}::uuid AND b."blockerId" = l."sellerId")
        )
      `);
    }

    return clauses.length > 0 ? Prisma.join(clauses, ' ') : Prisma.empty;
  }

  private friendshipExpression(context: MapQueryContext): Prisma.Sql {
    if (!context.viewerId) return Prisma.sql`FALSE`;
    return Prisma.sql`EXISTS (
      SELECT 1 FROM "Friendship" f
      WHERE f."status" = 'accepted'
        AND (
          (f."userAId" = ${context.viewerId}::uuid AND f."userBId" = l."sellerId")
          OR (f."userBId" = ${context.viewerId}::uuid AND f."userAId" = l."sellerId")
        )
    )`;
  }

  private followExpression(context: MapQueryContext): Prisma.Sql {
    if (!context.viewerId) return Prisma.sql`FALSE`;
    return Prisma.sql`EXISTS (
      SELECT 1 FROM "Follow" fo
      WHERE fo."followerId" = ${context.viewerId}::uuid
        AND fo."followeeId" = l."sellerId"
    )`;
  }

  private friendOnlyClause(context: MapQueryContext): Prisma.Sql {
    if (!context.viewerId) return Prisma.sql`AND FALSE`;
    return Prisma.sql`AND ${this.friendshipExpression(context)}`;
  }

  private followingOnlyClause(context: MapQueryContext): Prisma.Sql {
    if (!context.viewerId) return Prisma.sql`AND FALSE`;
    return Prisma.sql`AND ${this.followExpression(context)}`;
  }

  private shouldIncludeStores(input: MapQueryInput): boolean {
    return input.layer === 'all' || input.layer === 'stores';
  }

  private envelope(input: MapQueryInput): Prisma.Sql {
    const { minLng, minLat, maxLng, maxLat } = input.bbox;
    return Prisma.sql`ST_MakeEnvelope(${minLng}, ${minLat}, ${maxLng}, ${maxLat}, 4326)::geography`;
  }

  private viewerPoint(context: MapQueryContext): Prisma.Sql | undefined {
    if (!context.viewerLocation) return undefined;
    const { lat, lng } = context.viewerLocation;
    return Prisma.sql`ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography`;
  }
}
