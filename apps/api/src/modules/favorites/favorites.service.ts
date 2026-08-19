import { BadRequestException, Injectable } from '@nestjs/common';
import type { ListingSummary, Paginated } from '@cerquita/types';
import { PrismaService } from '../../prisma/prisma.service';
import { ListingsService } from '../listings/listings.service';

/**
 * Favourites, collections and saved searches (spec §31, §32).
 *
 * The favourite counter on a listing is maintained transactionally alongside the
 * favourite row, so the number shown never drifts from the rows behind it.
 */
@Injectable()
export class FavoritesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly listings: ListingsService,
  ) {}

  async add(
    userId: string,
    input: { listingId?: string; storeId?: string; collectionId?: string },
  ): Promise<{ favorited: true }> {
    if (!input.listingId && !input.storeId) {
      throw new BadRequestException({
        message: 'Indicá una publicación o una tienda',
        code: 'nothing_to_favorite',
      });
    }

    const existing = await this.prisma.favorite.findFirst({
      where: { userId, listingId: input.listingId ?? null, storeId: input.storeId ?? null },
      select: { id: true },
    });

    if (existing) {
      // Idempotent: re-favouriting only moves it into the chosen collection.
      if (input.collectionId) {
        await this.prisma.favorite.update({
          where: { id: existing.id },
          data: { collectionId: input.collectionId },
        });
      }
      return { favorited: true };
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.favorite.create({
        data: {
          userId,
          listingId: input.listingId,
          storeId: input.storeId,
          collectionId: input.collectionId,
        },
      });

      if (input.listingId) {
        await tx.listing.update({
          where: { id: input.listingId },
          data: { favoriteCount: { increment: 1 } },
        });
      }
    });

    return { favorited: true };
  }

  async remove(
    userId: string,
    input: { listingId?: string; storeId?: string },
  ): Promise<{ favorited: false }> {
    const existing = await this.prisma.favorite.findFirst({
      where: { userId, listingId: input.listingId ?? null, storeId: input.storeId ?? null },
      select: { id: true, listingId: true },
    });

    if (!existing) return { favorited: false };

    await this.prisma.$transaction(async (tx) => {
      await tx.favorite.delete({ where: { id: existing.id } });

      if (existing.listingId) {
        // GREATEST guards the counter against ever going negative.
        await tx.$executeRaw`
          UPDATE "Listing"
          SET "favoriteCount" = GREATEST(0, "favoriteCount" - 1)
          WHERE "id" = ${existing.listingId}::uuid
        `;
      }
    });

    return { favorited: false };
  }

  async list(userId: string, collectionId?: string): Promise<Paginated<ListingSummary>> {
    const favorites = await this.prisma.favorite.findMany({
      where: { userId, listingId: { not: null }, ...(collectionId ? { collectionId } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: { listingId: true },
    });

    const ids = favorites.map((favorite) => favorite.listingId).filter((id): id is string => !!id);
    if (ids.length === 0) return { items: [], nextCursor: null };

    // Ordered by when it was saved, not by whatever order the rows come back
    // in — the list is a history, so the most recently saved comes first.
    const summaries = await this.listings.summariesByIds(ids, userId);
    const items = ids
      .map((id) => summaries.get(id))
      .filter((summary): summary is ListingSummary => summary !== undefined);

    return { items, nextCursor: null };
  }

  async createCollection(userId: string, name: string): Promise<{ id: string; name: string }> {
    const collection = await this.prisma.favoriteCollection.upsert({
      where: { userId_name: { userId, name } },
      update: {},
      create: { userId, name },
      select: { id: true, name: true },
    });
    return collection;
  }

  async listCollections(userId: string) {
    return this.prisma.favoriteCollection.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
      select: { id: true, name: true, _count: { select: { favorites: true } } },
    });
  }

  /** Saved searches double as alerts when `notify` is set (spec §32). */
  async createSavedSearch(
    userId: string,
    input: {
      name: string;
      text?: string;
      categoryIds?: string[];
      kinds?: string[];
      conditions?: string[];
      minPrice?: { amount: number };
      maxPrice?: { amount: number };
      center?: { lat: number; lng: number };
      radiusMeters?: number;
      notify: boolean;
    },
  ): Promise<{ id: string }> {
    const saved = await this.prisma.savedSearch.create({
      data: {
        userId,
        name: input.name,
        text: input.text,
        categoryIds: input.categoryIds ?? [],
        kinds: (input.kinds ?? []) as never,
        conditions: (input.conditions ?? []) as never,
        minPrice: input.minPrice?.amount,
        maxPrice: input.maxPrice?.amount,
        radiusMeters: input.radiusMeters,
        notify: input.notify,
      },
      select: { id: true },
    });

    if (input.center) {
      await this.prisma.$executeRaw`
        UPDATE "SavedSearch"
        SET "center" = ST_SetSRID(ST_MakePoint(${input.center.lng}, ${input.center.lat}), 4326)::geography
        WHERE "id" = ${saved.id}::uuid
      `;
    }

    return saved;
  }

  async listSavedSearches(userId: string) {
    return this.prisma.savedSearch.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        text: true,
        minPrice: true,
        maxPrice: true,
        radiusMeters: true,
        notify: true,
        createdAt: true,
      },
    });
  }

  async deleteSavedSearch(userId: string, id: string): Promise<{ ok: true }> {
    // Scoped by userId so one user cannot delete another's alert.
    await this.prisma.savedSearch.deleteMany({ where: { id, userId } });
    return { ok: true };
  }
}
