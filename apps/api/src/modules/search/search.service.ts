import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { ListingSummary, Paginated } from '@cerquita/types';
import type { SearchQueryInput } from '@cerquita/validation';
import { PrismaService } from '../../prisma/prisma.service';
import { ListingsService } from '../listings/listings.service';
import type { ListingRow } from '../listings/listing.serializer';
import { AI_PROVIDER, type AiProvider } from '../../providers/ai/ai-provider';
import { ConfigService } from '../config/config.service';

/**
 * Search (spec §18, §19).
 *
 * Full-text uses a Postgres `tsvector` maintained by a trigger, with `pg_trgm`
 * as the fallback for short or misspelled terms. Ranking blends text relevance
 * with proximity, because in a hyperlocal marketplace a perfect title match
 * 40 km away is usually worse than a good match six blocks away.
 */
@Injectable()
export class SearchService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly listings: ListingsService,
    private readonly config: ConfigService,
    @Inject(AI_PROVIDER) private readonly ai: AiProvider,
  ) {}

  async search(
    query: SearchQueryInput,
    viewerId?: string,
  ): Promise<Paginated<ListingSummary>> {
    const settings = await this.config.settings();
    const radius = Math.min(
      query.radiusMeters ?? settings.maxSearchRadiusMeters,
      settings.maxSearchRadiusMeters,
    );

    const filters: Prisma.Sql[] = [Prisma.sql`l."status" IN ('active', 'reserved')`];

    if (query.kind) filters.push(Prisma.sql`l."kind" = ${query.kind}::"ListingKind"`);
    if (query.sellerId) filters.push(Prisma.sql`l."sellerId" = ${query.sellerId}::uuid`);
    if (query.storeId) filters.push(Prisma.sql`l."storeId" = ${query.storeId}::uuid`);
    if (query.categoryIds?.length) {
      filters.push(Prisma.sql`l."categoryId" = ANY(${query.categoryIds}::uuid[])`);
    }
    if (query.condition?.length) {
      filters.push(
        Prisma.sql`l."condition"::text = ANY(${query.condition}::text[])`,
      );
    }
    if (query.minPrice !== undefined) {
      filters.push(Prisma.sql`l."priceAmount" >= ${query.minPrice}`);
    }
    if (query.maxPrice !== undefined) {
      filters.push(Prisma.sql`l."priceAmount" <= ${query.maxPrice}`);
    }
    if (query.publishedAfter) {
      filters.push(Prisma.sql`l."publishedAt" >= ${query.publishedAfter}`);
    }

    const center = query.center;
    const centerPoint = center
      ? Prisma.sql`ST_SetSRID(ST_MakePoint(${center.lng}, ${center.lat}), 4326)::geography`
      : undefined;

    if (centerPoint) {
      filters.push(Prisma.sql`ST_DWithin(l."publicLocation", ${centerPoint}, ${radius})`);
    }
    if (query.bbox) {
      const { minLng, minLat, maxLng, maxLat } = query.bbox;
      filters.push(
        Prisma.sql`ST_Intersects(l."publicLocation", ST_MakeEnvelope(${minLng}, ${minLat}, ${maxLng}, ${maxLat}, 4326)::geography)`,
      );
    }

    const text = query.q?.trim();
    if (text) {
      filters.push(Prisma.sql`(
        l."searchVector" @@ plainto_tsquery('spanish', ${text})
        OR l."title" % ${text}
      )`);
    }

    if (viewerId) {
      filters.push(Prisma.sql`NOT EXISTS (
        SELECT 1 FROM "Block" b
        WHERE (b."blockerId" = ${viewerId}::uuid AND b."blockedId" = l."sellerId")
           OR (b."blockedId" = ${viewerId}::uuid AND b."blockerId" = l."sellerId")
      )`);
    }

    const offset = decodeCursor(query.cursor);
    const rows = await this.prisma.$queryRaw<ListingRow[]>(Prisma.sql`
      SELECT
        l."id", l."kind"::text AS "kind", l."status"::text AS "status",
        l."title", l."description", l."tags", l."categoryId",
        l."condition"::text AS "condition",
        l."priceAmount", l."priceCurrency", l."maxBudgetAmount", l."wantedRadiusMeters",
        l."quantity", l."reserved", l."sold",
        ARRAY(SELECT unnest(l."deliveryMethods")::text) AS "deliveryMethods",
        l."acceptsOffers", l."followerDiscountBps", l."friendDiscountBps",
        ST_Y(l."publicLocation"::geometry) AS "publicLat",
        ST_X(l."publicLocation"::geometry) AS "publicLng",
        l."neighborhood", l."city", l."region", l."country",
        l."viewCount", l."favoriteCount", l."promotedUntil",
        l."publishedAt", l."createdAt", l."updatedAt",
        l."sellerId", l."storeId",
        ${
          centerPoint
            ? Prisma.sql`ST_Distance(l."publicLocation", ${centerPoint})`
            : Prisma.sql`NULL::float8`
        } AS "distanceMeters"
      FROM "Listing" l
      WHERE ${Prisma.join(filters, ' AND ')}
      ORDER BY ${this.orderBy(query, text, centerPoint)}
      LIMIT ${query.limit + 1}
      OFFSET ${offset}
    `);

    const hasMore = rows.length > query.limit;
    const page = hasMore ? rows.slice(0, query.limit) : rows;

    return {
      items: await this.listings.toSummaries(page, viewerId),
      nextCursor: hasMore ? encodeCursor(offset + query.limit) : null,
    };
  }

  private orderBy(
    query: SearchQueryInput,
    text: string | undefined,
    centerPoint: Prisma.Sql | undefined,
  ): Prisma.Sql {
    // Promoted listings surface first but are labelled as such in the UI, so
    // paid placement stays visible rather than disguised (spec §54).
    const promoted = Prisma.sql`(l."promotedUntil" IS NOT NULL AND l."promotedUntil" > NOW()) DESC`;

    switch (query.sort) {
      case 'distance':
        return centerPoint
          ? Prisma.sql`${promoted}, ST_Distance(l."publicLocation", ${centerPoint}) ASC`
          : Prisma.sql`${promoted}, l."publishedAt" DESC NULLS LAST`;
      case 'price_asc':
        return Prisma.sql`${promoted}, l."priceAmount" ASC NULLS LAST`;
      case 'price_desc':
        return Prisma.sql`${promoted}, l."priceAmount" DESC NULLS LAST`;
      case 'newest':
        return Prisma.sql`${promoted}, l."publishedAt" DESC NULLS LAST`;
      case 'ending_soon':
        return Prisma.sql`${promoted}, (
          SELECT a."endsAt" FROM "Auction" a
          WHERE a."listingId" = l."id" AND a."status" = 'live'
        ) ASC NULLS LAST`;
      case 'relevance':
      default:
        if (text && centerPoint) {
          // Blend: text rank, then nearest-first within similar relevance.
          return Prisma.sql`${promoted},
            ts_rank(l."searchVector", plainto_tsquery('spanish', ${text})) DESC,
            ST_Distance(l."publicLocation", ${centerPoint}) ASC`;
        }
        if (text) {
          return Prisma.sql`${promoted}, ts_rank(l."searchVector", plainto_tsquery('spanish', ${text})) DESC`;
        }
        if (centerPoint) {
          return Prisma.sql`${promoted}, ST_Distance(l."publicLocation", ${centerPoint}) ASC`;
        }
        return Prisma.sql`${promoted}, l."publishedAt" DESC NULLS LAST`;
    }
  }

  /**
   * Natural-language search (spec §19): the provider turns a sentence into the
   * same structured filters the normal endpoint takes, so both paths share one
   * query implementation.
   */
  async aiSearch(
    prompt: string,
    viewerId: string | undefined,
    center?: { lat: number; lng: number },
  ): Promise<Paginated<ListingSummary> & { interpreted: Record<string, unknown> }> {
    const parsed = await this.ai.parseSearchQuery(prompt);

    const query = {
      q: parsed.query,
      kind: parsed.kind,
      condition: parsed.condition ? [parsed.condition] : undefined,
      minPrice: parsed.minPrice,
      maxPrice: parsed.maxPrice,
      center,
      radiusMeters: parsed.radiusKm ? Math.round(parsed.radiusKm * 1000) : undefined,
      sort: 'relevance' as const,
      limit: 20,
    } as SearchQueryInput;

    const results = await this.search(query, viewerId);
    return { ...results, interpreted: parsed as Record<string, unknown> };
  }
}

/** Opaque offset cursor. Encoded so clients do not build their own. */
function encodeCursor(offset: number): string {
  return Buffer.from(`o:${offset}`).toString('base64url');
}

function decodeCursor(cursor?: string): number {
  if (!cursor) return 0;
  try {
    const decoded = Buffer.from(cursor, 'base64url').toString('utf8');
    const value = Number(decoded.replace(/^o:/, ''));
    return Number.isSafeInteger(value) && value >= 0 ? value : 0;
  } catch {
    return 0;
  }
}
