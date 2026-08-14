import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import {
  matchesSavedSearch,
  matchesWantedPost,
  priceDropNewlyQualifies,
  type MatchableListing,
} from '@cerquita/domain';
import { formatMoney, money } from '@cerquita/utils';
import { EventBus } from '../events/event-bus.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Saved-search and "Busco" matching (spec §17, §32).
 *
 * The rules live in `@cerquita/domain` and are unit-tested; this is what
 * actually runs them. It reacts to `ListingCreated` and `ListingPriceChanged`
 * rather than evaluating on read, so someone with an alert hears about a match
 * once, promptly, instead of only when they happen to open the app.
 *
 * Two things keep this from becoming a notification firehose:
 *  - candidates are pre-filtered in SQL by category and radius, so the domain
 *    predicate only runs on rows that could plausibly match;
 *  - a price change only notifies people for whom the drop *newly* brings the
 *    item under their ceiling.
 */
@Injectable()
export class MatchingService implements OnModuleInit {
  private readonly logger = new Logger(MatchingService.name);

  constructor(
    private readonly events: EventBus,
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  onModuleInit(): void {
    this.events.on('ListingCreated', async (event) => {
      await this.matchNewListing(event.listingId);
    });

    this.events.on('ListingPriceChanged', async (event) => {
      await this.matchPriceDrop(event.listingId, event.previousPrice, event.newPrice);
    });
  }

  /** A new listing may satisfy someone's alert or their "Busco" post. */
  async matchNewListing(listingId: string): Promise<{ savedSearches: number; wanted: number }> {
    const listing = await this.loadMatchable(listingId);
    if (!listing) return { savedSearches: 0, wanted: 0 };

    const [savedSearches, wanted] = await Promise.all([
      this.matchSavedSearches(listing),
      this.matchWantedPosts(listing),
    ]);

    if (savedSearches > 0 || wanted > 0) {
      this.logger.log(
        `Listing ${listingId}: ${savedSearches} alert match(es), ${wanted} wanted match(es)`,
      );
    }
    return { savedSearches, wanted };
  }

  private async matchSavedSearches(listing: MatchableListing): Promise<number> {
    // Pre-filter in SQL: only alerts that opted into notifications, are not the
    // seller's own, and whose radius actually reaches this listing.
    const candidates = await this.prisma.$queryRaw<
      Array<{
        id: string;
        userId: string;
        name: string;
        text: string | null;
        categoryIds: string[];
        kinds: string[];
        conditions: string[];
        minPrice: number | null;
        maxPrice: number | null;
        currency: string;
        radiusMeters: number | null;
        centerLat: number | null;
        centerLng: number | null;
      }>
    >`
      SELECT s."id", s."userId", s."name", s."text", s."categoryIds",
             ARRAY(SELECT unnest(s."kinds")::text)      AS "kinds",
             ARRAY(SELECT unnest(s."conditions")::text) AS "conditions",
             s."minPrice", s."maxPrice", s."currency", s."radiusMeters",
             ST_Y(s."center"::geometry) AS "centerLat",
             ST_X(s."center"::geometry) AS "centerLng"
      FROM "SavedSearch" s
      WHERE s."notify" = true
        AND s."userId" <> ${listing.sellerId}::uuid
        AND (
          s."center" IS NULL
          OR s."radiusMeters" IS NULL
          OR ST_DWithin(
               s."center",
               ST_SetSRID(ST_MakePoint(${listing.location.lng}, ${listing.location.lat}), 4326)::geography,
               s."radiusMeters"
             )
        )
      LIMIT 500
    `;

    let matched = 0;

    for (const candidate of candidates) {
      const criteria = {
        id: candidate.id,
        ownerId: candidate.userId,
        text: candidate.text ?? undefined,
        categoryIds: candidate.categoryIds.length ? candidate.categoryIds : undefined,
        kinds: candidate.kinds.length ? (candidate.kinds as never) : undefined,
        conditions: candidate.conditions.length ? (candidate.conditions as never) : undefined,
        minPrice:
          candidate.minPrice === null
            ? undefined
            : money(candidate.minPrice, candidate.currency as 'ARS'),
        maxPrice:
          candidate.maxPrice === null
            ? undefined
            : money(candidate.maxPrice, candidate.currency as 'ARS'),
        center:
          candidate.centerLat === null || candidate.centerLng === null
            ? undefined
            : { lat: candidate.centerLat, lng: candidate.centerLng },
        radiusMeters: candidate.radiusMeters ?? undefined,
      };

      if (!matchesSavedSearch(criteria, listing)) continue;

      await this.notifications.create({
        userId: candidate.userId,
        type: 'saved_search_match',
        title: `Apareció algo para "${candidate.name}"`,
        body: listing.price
          ? `${listing.title} — ${formatMoney(listing.price)}`
          : listing.title,
        deepLink: `cerquita://listing/${listing.id}`,
      });

      matched += 1;
    }

    if (matched > 0) {
      await this.prisma.savedSearch.updateMany({
        where: { id: { in: candidates.map((candidate) => candidate.id) } },
        data: { lastMatchedAt: new Date() },
      });
    }

    return matched;
  }

  private async matchWantedPosts(listing: MatchableListing): Promise<number> {
    if (listing.kind !== 'sale' && listing.kind !== 'auction') return 0;

    // Only active "Busco" posts in the same category whose radius reaches here.
    const candidates = await this.prisma.$queryRaw<
      Array<{
        id: string;
        sellerId: string;
        title: string;
        categoryId: string;
        maxBudgetAmount: number | null;
        priceCurrency: string;
        acceptedConditions: string[];
        radiusMeters: number | null;
        lat: number;
        lng: number;
      }>
    >`
      SELECT w."id", w."sellerId", w."title", w."categoryId", w."maxBudgetAmount",
             w."priceCurrency",
             ARRAY(SELECT unnest(w."acceptedConditions")::text) AS "acceptedConditions",
             w."wantedRadiusMeters" AS "radiusMeters",
             ST_Y(w."exactLocation"::geometry) AS lat,
             ST_X(w."exactLocation"::geometry) AS lng
      FROM "Listing" w
      WHERE w."kind" = 'wanted'
        AND w."status" = 'active'
        AND w."categoryId" = ${listing.categoryId}::uuid
        AND w."sellerId" <> ${listing.sellerId}::uuid
        AND ST_DWithin(
              w."exactLocation",
              ST_SetSRID(ST_MakePoint(${listing.location.lng}, ${listing.location.lat}), 4326)::geography,
              COALESCE(w."wantedRadiusMeters", 5000)
            )
      LIMIT 200
    `;

    let matched = 0;

    for (const candidate of candidates) {
      const wanted = {
        id: candidate.id,
        ownerId: candidate.sellerId,
        title: candidate.title,
        categoryId: candidate.categoryId,
        maxBudget:
          candidate.maxBudgetAmount === null
            ? undefined
            : money(candidate.maxBudgetAmount, candidate.priceCurrency as 'ARS'),
        acceptedConditions: candidate.acceptedConditions.length
          ? (candidate.acceptedConditions as never)
          : undefined,
        center: { lat: candidate.lat, lng: candidate.lng },
        radiusMeters: candidate.radiusMeters ?? 5000,
      };

      if (!matchesWantedPost(wanted, listing)) continue;

      await this.notifications.create({
        userId: candidate.sellerId,
        type: 'wanted_match',
        title: 'Alguien publicó lo que buscás',
        body: listing.price
          ? `${listing.title} — ${formatMoney(listing.price)}`
          : listing.title,
        deepLink: `cerquita://listing/${listing.id}`,
      });

      matched += 1;
    }

    return matched;
  }

  /**
   * A price drop re-notifies only the people it newly brings into budget.
   * Someone whose ceiling was already above the old price learns nothing new.
   */
  private async matchPriceDrop(
    listingId: string,
    previous: { amount: number; currency: string },
    next: { amount: number; currency: string },
  ): Promise<void> {
    const listing = await this.loadMatchable(listingId);
    if (!listing) return;

    const alerts = await this.prisma.savedSearch.findMany({
      where: { notify: true, maxPrice: { not: null }, userId: { not: listing.sellerId } },
      select: { id: true, userId: true, name: true, maxPrice: true, currency: true },
      take: 500,
    });

    for (const alert of alerts) {
      if (alert.maxPrice === null) continue;

      const qualifies = priceDropNewlyQualifies({
        previousPrice: money(previous.amount, previous.currency as 'ARS'),
        newPrice: money(next.amount, next.currency as 'ARS'),
        ceiling: money(alert.maxPrice, alert.currency as 'ARS'),
      });
      if (!qualifies) continue;

      await this.notifications.create({
        userId: alert.userId,
        type: 'saved_search_match',
        title: `Bajó de precio y ahora entra en "${alert.name}"`,
        body: `${listing.title} — ${formatMoney(money(next.amount, next.currency as 'ARS'))}`,
        deepLink: `cerquita://listing/${listingId}`,
      });
    }
  }

  /** Loads the listing in the shape the domain matcher expects. */
  private async loadMatchable(listingId: string): Promise<MatchableListing | null> {
    const rows = await this.prisma.$queryRaw<
      Array<{
        id: string;
        sellerId: string;
        kind: string;
        title: string;
        description: string;
        tags: string[];
        categoryId: string;
        condition: string | null;
        priceAmount: number | null;
        priceCurrency: string;
        lat: number | null;
        lng: number | null;
      }>
    >`
      SELECT l."id", l."sellerId", l."kind"::text AS kind, l."title", l."description",
             l."tags", l."categoryId", l."condition"::text AS condition,
             l."priceAmount", l."priceCurrency",
             ST_Y(l."exactLocation"::geometry) AS lat,
             ST_X(l."exactLocation"::geometry) AS lng
      FROM "Listing" l
      WHERE l."id" = ${listingId}::uuid
      LIMIT 1
    `;

    const row = rows[0];
    if (!row || row.lat === null || row.lng === null) return null;

    return {
      id: row.id,
      sellerId: row.sellerId,
      kind: row.kind as MatchableListing['kind'],
      title: row.title,
      description: row.description,
      tags: row.tags,
      categoryId: row.categoryId,
      condition: (row.condition as MatchableListing['condition']) ?? undefined,
      price:
        row.priceAmount === null
          ? undefined
          : money(row.priceAmount, row.priceCurrency as 'ARS'),
      // Matching runs server-side, so it uses the exact location, not the fuzzed
      // one — a 350 m offset would make radius matching wrong at close range.
      location: { lat: row.lat, lng: row.lng },
    };
  }
}
