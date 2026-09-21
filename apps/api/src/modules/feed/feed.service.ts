import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { FeedItem, FeedItemType, ListingSummary } from '@cerquita/types';
import { stripWantedFraming } from '@cerquita/domain';
import { formatMoney, money } from '@cerquita/utils';
import { PrismaService } from '../../prisma/prisma.service';
import { ListingsService } from '../listings/listings.service';
import { LISTING_ROW_COLUMNS, type ListingRow } from '../listings/listing.serializer';

/** Nothing older than this is news. */
const WINDOW_DAYS = 30;

/** How far "cerca tuyo" reaches when the viewer shares a position. */
const NEARBY_RADIUS_METRES = 8_000;

/**
 * Keeps the first row about each listing or store and drops the rest.
 *
 * Order matters: callers pass the sources already sorted by how strong the
 * reason is, so "bajó de precio algo que guardaste" survives and the same item's
 * weaker "publicó algo nuevo" does not.
 */
function dedupeBySubject(items: readonly FeedItem[]): FeedItem[] {
  const seen = new Set<string>();
  const kept: FeedItem[] = [];

  for (const item of items) {
    const subject = item.listing?.id ?? item.store?.id;
    // A row with neither is not something we can deduplicate on; keep it.
    if (subject && seen.has(subject)) continue;
    if (subject) seen.add(subject);
    kept.push(item);
  }

  return kept;
}

export interface FeedQuery {
  readonly lat?: number;
  readonly lng?: number;
  readonly limit?: number;
  readonly cursor?: string;
}

/**
 * The feed (spec §17, direction 1c).
 *
 * Assembled at read time from the tables that already exist rather than written
 * into a per-user timeline. At this scale a fan-out-on-write table would be a
 * second source of truth for facts the listings table already holds — and the
 * first time a price changed or a listing was retired, the timeline would be
 * wrong until something rewrote it.
 *
 * The order of the sources is the product argument. What someone you know just
 * posted beats what a store is promoting, which beats a stranger's listing that
 * happens to be nearby. Proximity is the tie-breaker, not the ranking.
 *
 * Every branch is scoped to the viewer, so the feed of a signed-out visitor is
 * simply the nearby one — no graph, no guesses.
 */
@Injectable()
export class FeedService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly listings: ListingsService,
  ) {}

  async forViewer(viewerId: string | undefined, query: FeedQuery = {}): Promise<FeedItem[]> {
    const limit = Math.min(Math.max(query.limit ?? 30, 1), 50);
    const since = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000);
    const center =
      query.lat !== undefined && query.lng !== undefined
        ? { lat: query.lat, lng: query.lng }
        : undefined;

    const [social, wanted, drops, promotions] = await Promise.all([
      viewerId ? this.fromPeopleYouKnow(viewerId, since, limit) : [],
      this.nearbyWanted(viewerId, since, center, limit),
      viewerId ? this.priceDropsOnSavedItems(viewerId, since) : [],
      viewerId ? this.promotionsFromStoresYouFollow(viewerId, since) : [],
    ]);

    // Concatenated in priority order, then deduplicated by subject. The same
    // listing legitimately qualifies for several sources at once — a friend's
    // item you saved that just dropped in price is all three — and the reader
    // should be told the strongest reason once, not every reason in turn.
    const items = dedupeBySubject([...drops, ...social, ...promotions, ...wanted]);

    // Filler, and the reason a brand-new account does not open an empty screen.
    // Fetched only when the social sources did not fill the page.
    if (items.length < limit) {
      items.push(
        ...(await this.nearbyRecommendations(viewerId, since, center, limit - items.length, items)),
      );
    }

    return items.slice(0, limit);
  }

  /**
   * What friends and people you follow have posted.
   *
   * One query over the union of both edges rather than two: the same person can
   * be both, and merging in memory would show their listing twice.
   */
  private async fromPeopleYouKnow(
    viewerId: string,
    since: Date,
    limit: number,
  ): Promise<FeedItem[]> {
    const rows = await this.prisma.$queryRaw<Array<ListingRow & { isFriend: boolean }>>(Prisma.sql`
      WITH known AS (
        SELECT f."followeeId" AS "userId", false AS "isFriend"
        FROM "Follow" f
        WHERE f."followerId" = ${viewerId}::uuid
        UNION
        SELECT CASE WHEN fr."userAId" = ${viewerId}::uuid THEN fr."userBId" ELSE fr."userAId" END,
               true
        FROM "Friendship" fr
        WHERE fr."status" = 'accepted'
          AND ${viewerId}::uuid IN (fr."userAId", fr."userBId")
      ),
      -- A friend outranks a follow when both edges exist, so the row is
      -- collapsed before it reaches the join.
      strongest AS (
        SELECT "userId", bool_or("isFriend") AS "isFriend" FROM known GROUP BY "userId"
      )
      SELECT ${LISTING_ROW_COLUMNS}, s."isFriend"
      FROM "Listing" l
      JOIN strongest s ON s."userId" = l."sellerId"
      WHERE l."status" = 'active'
        AND l."kind" IN ('sale', 'auction')
        AND l."publishedAt" >= ${since}
      ORDER BY s."isFriend" DESC, l."publishedAt" DESC
      LIMIT ${limit}
    `);

    const summaries = await this.listings.toSummaries(rows, viewerId);

    return summaries.map((listing, index) => {
      const row = rows[index];
      const isAuction = listing.kind === 'auction';

      return this.item({
        type: isAuction ? 'new_auction' : row?.isFriend ? 'friend_activity' : 'new_listing',
        listing,
        headline: isAuction
          ? `${listing.seller.displayName} abrió una subasta`
          : row?.isFriend
            ? `${listing.seller.displayName} publicó algo`
            : `${listing.seller.displayName} publicó algo nuevo`,
        createdAt: listing.publishedAt ?? new Date().toISOString(),
      });
    });
  }

  /**
   * "Busco" posts near the viewer.
   *
   * These are the ones a reader can actually act on — you either have the thing
   * or you do not — which is why they are in the feed at all rather than only on
   * the map.
   */
  private async nearbyWanted(
    viewerId: string | undefined,
    since: Date,
    center: { lat: number; lng: number } | undefined,
    limit: number,
  ): Promise<FeedItem[]> {
    const rows = await this.prisma.$queryRaw<ListingRow[]>(Prisma.sql`
      SELECT ${LISTING_ROW_COLUMNS}
      FROM "Listing" l
      WHERE l."status" = 'active'
        AND l."kind" = 'wanted'
        AND l."publishedAt" >= ${since}
        ${viewerId ? Prisma.sql`AND l."sellerId" <> ${viewerId}::uuid` : Prisma.empty}
        ${this.nearFilter(center)}
      ORDER BY l."publishedAt" DESC
      LIMIT ${Math.ceil(limit / 3)}
    `);

    const summaries = await this.listings.toSummaries(rows, viewerId);

    return summaries.map((listing) =>
      this.item({
        type: 'wanted_listing',
        listing,
        // People title these posts "Busco una bici", so the headline strips the
        // framing rather than producing "Fran busca Busco una bici".
        headline: `${listing.seller.displayName} busca ${stripWantedFraming(listing.title)}`,
        createdAt: listing.publishedAt ?? new Date().toISOString(),
      }),
    );
  }

  /**
   * Price drops on things the viewer saved.
   *
   * The highest-signal row in the feed: they already told us they wanted it, so
   * this goes first regardless of when it happened.
   *
   * A drop is the latest history entry being lower than the one before it, both
   * in the same currency — comparing across currencies would be meaningless.
   */
  private async priceDropsOnSavedItems(viewerId: string, since: Date): Promise<FeedItem[]> {
    const rows = await this.prisma.$queryRaw<
      Array<ListingRow & { droppedAt: Date; previousAmount: number }>
    >(Prisma.sql`
      WITH history AS (
        SELECT
          h."listingId",
          h."priceAmount",
          h."priceCurrency",
          h."recordedAt",
          LAG(h."priceAmount") OVER w AS "previousAmount",
          LAG(h."priceCurrency") OVER w AS "previousCurrency",
          ROW_NUMBER() OVER (PARTITION BY h."listingId" ORDER BY h."recordedAt" DESC) AS "recency"
        FROM "ListingPriceHistory" h
        JOIN "Favorite" fav
          ON fav."listingId" = h."listingId" AND fav."userId" = ${viewerId}::uuid
        WINDOW w AS (PARTITION BY h."listingId" ORDER BY h."recordedAt")
      )
      SELECT ${LISTING_ROW_COLUMNS},
             history."recordedAt" AS "droppedAt",
             history."previousAmount"
      FROM history
      JOIN "Listing" l ON l."id" = history."listingId"
      WHERE history."recency" = 1
        AND history."previousAmount" IS NOT NULL
        AND history."priceCurrency" = history."previousCurrency"
        AND history."priceAmount" < history."previousAmount"
        AND history."recordedAt" >= ${since}
        AND l."status" = 'active'
      ORDER BY history."recordedAt" DESC
      LIMIT 10
    `);

    const summaries = await this.listings.toSummaries(rows, viewerId);

    return summaries.map((listing, index) => {
      const row = rows[index];

      return this.item({
        type: 'price_drop',
        listing,
        // The numbers are the LIST price before and after. The card underneath
        // shows what this viewer pays, which is a different figure once their
        // social discount applies — saying "bajó de precio" and then showing a
        // −5% friend badge next to it reads as one claim about one discount.
        headline:
          row && listing.price
            ? `Bajó de ${formatMoney(money(row.previousAmount, listing.price.list.currency))} a ${formatMoney(money(listing.price.list.amount, listing.price.list.currency))}`
            : 'Bajó de precio algo que guardaste',
        createdAt: (row?.droppedAt ?? new Date()).toISOString(),
      });
    });
  }

  /** Promotions from stores the viewer follows. */
  private async promotionsFromStoresYouFollow(viewerId: string, since: Date): Promise<FeedItem[]> {
    const promotions = await this.prisma.promotion.findMany({
      where: {
        active: true,
        createdAt: { gte: since },
        store: { followers: { some: { userId: viewerId } } },
        // A promotion that already ended is not news.
        OR: [{ endsAt: null }, { endsAt: { gt: new Date() } }],
      },
      orderBy: { createdAt: 'desc' },
      take: 5,
      select: {
        id: true,
        label: true,
        createdAt: true,
        store: {
          select: {
            id: true,
            handle: true,
            name: true,
            logoUrl: true,
            verified: true,
            ratingSum: true,
            reviewCount: true,
          },
        },
      },
    });

    return promotions
      .filter((promotion) => promotion.store !== null)
      .map((promotion) =>
        this.item({
          id: promotion.id,
          type: 'store_promotion',
          store: {
            id: promotion.store!.id,
            handle: promotion.store!.handle,
            name: promotion.store!.name,
            logoUrl: promotion.store!.logoUrl ?? undefined,
            verified: promotion.store!.verified,
            rating:
              promotion.store!.reviewCount > 0
                ? promotion.store!.ratingSum / promotion.store!.reviewCount
                : undefined,
            followerCount: 0,
            activeListingCount: 0,
          },
          headline: `${promotion.store!.name}: ${promotion.label}`,
          createdAt: promotion.createdAt.toISOString(),
        }),
      );
  }

  /**
   * Nearby listings from people the viewer does not know.
   *
   * Only ever used to fill the page. `exclude` carries what the social sources
   * already produced, so the same listing does not appear twice under two
   * different headlines.
   */
  private async nearbyRecommendations(
    viewerId: string | undefined,
    since: Date,
    center: { lat: number; lng: number } | undefined,
    limit: number,
    exclude: readonly FeedItem[],
  ): Promise<FeedItem[]> {
    const seen = exclude
      .map((item) => item.listing?.id)
      .filter((id): id is string => id !== undefined);

    const rows = await this.prisma.$queryRaw<ListingRow[]>(Prisma.sql`
      SELECT ${LISTING_ROW_COLUMNS}
      FROM "Listing" l
      WHERE l."status" = 'active'
        AND l."kind" IN ('sale', 'auction')
        AND l."publishedAt" >= ${since}
        ${viewerId ? Prisma.sql`AND l."sellerId" <> ${viewerId}::uuid` : Prisma.empty}
        ${seen.length > 0 ? Prisma.sql`AND l."id" <> ALL(${seen}::uuid[])` : Prisma.empty}
        ${
          viewerId
            ? Prisma.sql`AND NOT EXISTS (
                SELECT 1 FROM "Block" b
                WHERE (b."blockerId" = ${viewerId}::uuid AND b."blockedId" = l."sellerId")
                   OR (b."blockedId" = ${viewerId}::uuid AND b."blockerId" = l."sellerId")
              )`
            : Prisma.empty
        }
        ${this.nearFilter(center)}
      ORDER BY ${
        center
          ? Prisma.sql`ST_Distance(l."publicLocation", ${this.point(center)}) ASC`
          : Prisma.sql`l."publishedAt" DESC`
      }
      LIMIT ${limit}
    `);

    const summaries = await this.listings.toSummaries(rows, viewerId);

    return summaries.map((listing) =>
      this.item({
        type: 'recommended_listing',
        listing,
        headline: listing.kind === 'auction' ? 'Subasta cerca tuyo' : 'Cerca tuyo',
        createdAt: listing.publishedAt ?? new Date().toISOString(),
      }),
    );
  }

  private nearFilter(center: { lat: number; lng: number } | undefined): Prisma.Sql {
    if (!center) return Prisma.empty;
    return Prisma.sql`AND ST_DWithin(l."publicLocation", ${this.point(center)}, ${NEARBY_RADIUS_METRES})`;
  }

  private point(center: { lat: number; lng: number }): Prisma.Sql {
    return Prisma.sql`ST_SetSRID(ST_MakePoint(${center.lng}, ${center.lat}), 4326)::geography`;
  }

  /**
   * Feed rows are derived, so they have no id of their own. Composing one from
   * the type and the subject keeps React keys stable across refetches without
   * inventing a row in the database to hold it.
   */
  private item(input: {
    id?: string;
    type: FeedItemType;
    listing?: ListingSummary;
    store?: FeedItem['store'];
    headline: string;
    createdAt: string;
  }): FeedItem {
    return {
      id: input.id ?? `${input.type}:${input.listing?.id ?? input.store?.id ?? 'unknown'}`,
      type: input.type,
      actor: input.listing?.seller,
      store: input.store ?? input.listing?.store,
      listing: input.listing,
      headline: input.headline,
      createdAt: input.createdAt,
    };
  }
}
