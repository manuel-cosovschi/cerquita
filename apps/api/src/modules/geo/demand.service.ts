import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { stripWantedFraming } from '@cerquita/domain';
import { PrismaService } from '../../prisma/prisma.service';

/** Nothing older than this says anything about what people want now. */
const WINDOW_DAYS = 30;

/** Default reach of "cerca tuyo" for demand, in metres. */
const DEFAULT_RADIUS_METRES = 5_000;

/**
 * How many wanted posts a category needs before it is reported.
 *
 * Below this it is one person, not demand — and naming a category on the
 * strength of a single post would quietly point at whoever wrote it.
 */
const MIN_SIGNAL = 2;

export interface DemandCategory {
  readonly categoryId: string;
  readonly name: string;
  readonly wantedCount: number;
  readonly supplyCount: number;
  /**
   * Wanted posts per active listing. Above 1 means more people are asking than
   * offering. Null when there is no supply to divide by — an unmet category is
   * not the same as an infinitely profitable one.
   */
  readonly ratio: number | null;
}

export interface LocalDemand {
  readonly radiusMeters: number;
  readonly categories: DemandCategory[];
  /** The most repeated words across nearby wanted posts. */
  readonly terms: Array<{ term: string; count: number }>;
  readonly wantedTotal: number;
}

/**
 * Aggregate local demand (spec §51).
 *
 * What are people around here asking for that nobody is selling? The answer
 * already exists in the data — wanted posts carry a category and a location —
 * it just needed to be counted.
 *
 * Deliberately aggregate-only. It reports counts per category and repeated
 * words, never who asked or where they are: an individual wanted post is
 * already public on the map, but a ranked list of "people near this corner want
 * X" is a different object, and one worth not building.
 */
@Injectable()
export class DemandService {
  constructor(private readonly prisma: PrismaService) {}

  async near(center: { lat: number; lng: number }, radiusMeters?: number): Promise<LocalDemand> {
    const radius = Math.min(Math.max(radiusMeters ?? DEFAULT_RADIUS_METRES, 500), 50_000);
    const since = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000);
    const point = Prisma.sql`ST_SetSRID(ST_MakePoint(${center.lng}, ${center.lat}), 4326)::geography`;

    /*
     * Demand and supply in one pass, per category.
     *
     * The two counts have different date rules on purpose: a wanted post from
     * five weeks ago says nothing about today, but a listing published months
     * ago and still active is very much current supply.
     */
    const rows = await this.prisma.$queryRaw<
      Array<{ categoryId: string; name: string; wantedCount: bigint; supplyCount: bigint }>
    >(Prisma.sql`
      WITH nearby AS (
        SELECT l."categoryId", l."kind", l."publishedAt"
        FROM "Listing" l
        WHERE l."status" = 'active'
          AND ST_DWithin(l."publicLocation", ${point}, ${radius})
      )
      SELECT
        c."id"   AS "categoryId",
        c."name" AS "name",
        COUNT(*) FILTER (
          WHERE n."kind" = 'wanted' AND n."publishedAt" >= ${since}
        ) AS "wantedCount",
        COUNT(*) FILTER (WHERE n."kind" IN ('sale', 'auction')) AS "supplyCount"
      FROM nearby n
      JOIN "Category" c ON c."id" = n."categoryId"
      GROUP BY c."id", c."name"
      HAVING COUNT(*) FILTER (
        WHERE n."kind" = 'wanted' AND n."publishedAt" >= ${since}
      ) >= ${MIN_SIGNAL}
      ORDER BY "wantedCount" DESC
      LIMIT 10
    `);

    const categories = rows.map((row) => {
      const wantedCount = Number(row.wantedCount);
      const supplyCount = Number(row.supplyCount);

      return {
        categoryId: row.categoryId,
        name: row.name,
        wantedCount,
        supplyCount,
        ratio: supplyCount > 0 ? Math.round((wantedCount / supplyCount) * 100) / 100 : null,
      };
    });

    const titles = await this.prisma.$queryRaw<Array<{ title: string }>>(Prisma.sql`
      SELECT l."title"
      FROM "Listing" l
      WHERE l."status" = 'active'
        AND l."kind" = 'wanted'
        AND l."publishedAt" >= ${since}
        AND ST_DWithin(l."publicLocation", ${point}, ${radius})
      LIMIT 200
    `);

    return {
      radiusMeters: radius,
      categories,
      terms: countTerms(titles.map((row) => row.title)),
      wantedTotal: titles.length,
    };
  }
}

/**
 * Function words, which repeat across any two sentences in Spanish and so would
 * otherwise top a list of "what people are asking for" without naming anything.
 *
 * Only words that can never be the subject of a search — no nouns, no
 * adjectives — so nothing anybody actually wants gets filtered out.
 */
const STOP_WORDS = new Set([
  'para',
  'con',
  'sin',
  'por',
  'que',
  'los',
  'las',
  'una',
  'uno',
  'unos',
  'unas',
  'del',
  'des',
  'este',
  'esta',
  'esto',
  'mas',
  'muy',
  'pero',
  'como',
  'cual',
  'donde',
  'algo',
  'alguna',
  'alguno',
  'todo',
  'toda',
  'tipo',
  'cualquier',
  'preferentemente',
]);

/**
 * The words people actually repeat.
 *
 * Framing ("busco", "necesito") is stripped with the same helper the matching
 * engine uses, so the list is things rather than phrasing. Words are counted
 * once per post: a title that says "bici bici bici" is one person wanting one
 * bike, not three.
 */
export function countTerms(titles: readonly string[]): Array<{ term: string; count: number }> {
  const counts = new Map<string, number>();

  for (const title of titles) {
    const seen = new Set(
      stripWantedFraming(title)
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .split(/[^a-z0-9]+/)
        // Two letters and under are prepositions and units, not subjects.
        .filter((term) => term.length > 2 && !STOP_WORDS.has(term)),
    );

    for (const term of seen) counts.set(term, (counts.get(term) ?? 0) + 1);
  }

  return [...counts.entries()]
    .filter(([, count]) => count >= MIN_SIGNAL)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([term, count]) => ({ term, count }));
}
