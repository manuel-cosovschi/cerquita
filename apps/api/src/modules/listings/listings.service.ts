import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AudienceTier, Listing, ListingSummary } from '@cerquita/types';
import {
  canManageListing,
  discountPolicyFor,
  isNotifiablePriceDrop,
  resolveAudienceTier,
  validateListingForPublish,
  type DiscountPolicy,
} from '@cerquita/domain';
import type { CreateListingInput } from '@cerquita/validation';
import { fuzzCoordinates, money, type Coordinates } from '@cerquita/utils';
import { PrismaService } from '../../prisma/prisma.service';
import { LISTING_ROW_COLUMNS, ListingSerializer, type ListingRow } from './listing.serializer';
import { EventBus } from '../events/event-bus.service';
import { SocialProofService } from '../social/social-proof.service';
import { ConfigService } from '../config/config.service';
import type { AuthenticatedUser } from '../../common/current-user.decorator';

/**
 * Listing reads and writes.
 *
 * Geography columns are written with raw SQL because Prisma models them as
 * `Unsupported`. Every write computes the public (fuzzed) point from the exact
 * one in the same statement, so a listing can never exist with a real coordinate
 * exposed as its public location.
 */
@Injectable()
export class ListingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly serializer: ListingSerializer,
    private readonly events: EventBus,
    private readonly config: ConfigService,
    private readonly socialProof: SocialProofService,
  ) {}

  async create(input: CreateListingInput, actor: AuthenticatedUser): Promise<Listing> {
    if (input.storeId) {
      const role = actor.storeRoles[input.storeId];
      if (!role) {
        throw new ForbiddenException({
          message: 'No pertenecés a esa tienda',
          code: 'not_store_member',
        });
      }
    }

    const issues = validateListingForPublish({
      kind: input.kind,
      title: input.title,
      description: input.description,
      categoryId: input.categoryId,
      condition: 'condition' in input ? input.condition : undefined,
      imageCount: input.images.length,
      price: 'price' in input ? money(input.price.amount, input.price.currency) : undefined,
      maxBudget:
        'maxBudget' in input && input.maxBudget
          ? money(input.maxBudget.amount, input.maxBudget.currency)
          : undefined,
      quantity: 'quantity' in input ? input.quantity : undefined,
      tags: input.tags,
      wantedRadiusMeters: 'wantedRadiusMeters' in input ? input.wantedRadiusMeters : undefined,
      hasLocation: true,
    });

    if (issues.length > 0) {
      throw new BadRequestException({
        message: 'Falta completar algunos datos',
        code: 'invalid_listing',
        issues,
      });
    }

    const fuzzMeters = await this.config.publicLocationFuzzMeters();

    const listing = await this.prisma.$transaction(async (tx) => {
      // Geography columns are `Unsupported` in Prisma, so the row cannot be
      // created with them. It is inserted as a draft, `writeLocation` fills both
      // points, and only then does it become active — which is also what lets
      // the database CHECK constraint forbid a published listing without a
      // location. All three statements share this transaction.
      const created = await tx.listing.create({
        data: {
          kind: input.kind,
          status: 'draft',
          title: input.title,
          description: input.description,
          tags: input.tags,
          sellerId: actor.userId,
          storeId: input.storeId ?? null,
          categoryId: input.categoryId,
          condition: 'condition' in input ? input.condition : null,
          priceAmount: 'price' in input ? input.price.amount : null,
          priceCurrency: 'price' in input ? input.price.currency : 'ARS',
          maxBudgetAmount: 'maxBudget' in input && input.maxBudget ? input.maxBudget.amount : null,
          wantedRadiusMeters: 'wantedRadiusMeters' in input ? input.wantedRadiusMeters : null,
          acceptedConditions:
            'acceptedConditions' in input && input.acceptedConditions
              ? input.acceptedConditions
              : [],
          quantity: 'quantity' in input ? input.quantity : 1,
          deliveryMethods: 'deliveryMethods' in input ? input.deliveryMethods : [],
          acceptsOffers: 'acceptsOffers' in input ? input.acceptsOffers : true,
          reservationMinutes:
            'reservationMinutes' in input ? (input.reservationMinutes ?? null) : null,
          followerDiscountBps:
            'followerBasisPoints' in input ? (input.followerBasisPoints ?? null) : null,
          friendDiscountBps:
            'friendBasisPoints' in input ? (input.friendBasisPoints ?? null) : null,
          publishedAt: new Date(),
        },
        select: { id: true },
      });

      await this.writeLocation(tx, created.id, input.location, fuzzMeters);
      await tx.listing.update({ where: { id: created.id }, data: { status: 'active' } });

      if (input.images.length > 0) {
        await tx.listingImage.createMany({
          data: input.images.map((image) => ({
            listingId: created.id,
            url: image.url,
            thumbnailUrl: image.url,
            width: image.width,
            height: image.height,
            position: image.position,
            alt: image.alt,
          })),
        });
      }

      if ('price' in input) {
        await tx.listingPriceHistory.create({
          data: {
            listingId: created.id,
            priceAmount: input.price.amount,
            priceCurrency: input.price.currency,
            reason: 'published',
          },
        });
      }

      /*
       * An auction listing is not an auction until this row exists.
       *
       * In the same transaction as the listing on purpose: a listing that says
       * "Subasta" with no auction behind it can never be bid on, and there is
       * no state in which that is a useful thing to have created.
       *
       * `startsAt` defaults to now, which the scheduler reads as "open it on
       * the next pass". It is stored as `scheduled` rather than `live` so that
       * opening an auction goes through one code path, whether it starts in ten
       * seconds or next Tuesday.
       */
      if (input.kind === 'auction') {
        await tx.auction.create({
          data: {
            listingId: created.id,
            status: 'scheduled',
            startsAt: input.startsAt ?? new Date(),
            endsAt: input.endsAt,
            currency: input.startingPrice.currency,
            startingPriceAmount: input.startingPrice.amount,
            minimumIncrementAmount: input.minimumIncrement.amount,
            reservePriceAmount: input.reservePrice?.amount ?? null,
            buyNowPriceAmount: input.buyNowPrice?.amount ?? null,
          },
        });
      }

      return created;
    });

    await this.events.publish({
      type: 'ListingCreated',
      id: listing.id,
      occurredAt: new Date().toISOString(),
      listingId: listing.id,
      sellerId: actor.userId,
      storeId: input.storeId,
      kind: input.kind,
      categoryId: input.categoryId,
    });

    return this.findOne(listing.id, actor.userId);
  }

  /**
   * Writes the exact point and derives the public one.
   *
   * The public point is deterministic in the listing id, so it does not drift
   * between requests — a drifting point could be averaged out to recover the
   * real position.
   */
  private async writeLocation(
    tx: Prisma.TransactionClient,
    listingId: string,
    exact: Coordinates,
    fuzzMeters: number,
  ): Promise<void> {
    const publicPoint = fuzzCoordinates(exact, listingId, fuzzMeters);

    await tx.$executeRaw`
      UPDATE "Listing"
      SET "exactLocation"  = ST_SetSRID(ST_MakePoint(${exact.lng}, ${exact.lat}), 4326)::geography,
          "publicLocation" = ST_SetSRID(ST_MakePoint(${publicPoint.lng}, ${publicPoint.lat}), 4326)::geography
      WHERE "id" = ${listingId}::uuid
    `;
  }

  async findOne(id: string, viewerId?: string): Promise<Listing> {
    const row = await this.selectRow(id);
    if (!row) {
      throw new NotFoundException({ message: 'Publicación no encontrada', code: 'not_found' });
    }

    const context = await this.buildContext(row, viewerId);

    const [priceHistory, auction] = await Promise.all([
      this.prisma.listingPriceHistory.findMany({
        where: { listingId: id },
        orderBy: { recordedAt: 'asc' },
        take: 20,
      }),
      this.prisma.auction.findUnique({ where: { listingId: id } }),
    ]);

    // "Amigo de Nacho" — the reason a stranger should trust this seller. Comes
    // from the graph, resolved per viewer (direction 1c).
    const proof = await this.socialProof.forSeller(row.sellerId, viewerId);

    return this.serializer.toDetail(
      row,
      { ...context, socialProof: proof.label },
      {
        priceHistory: priceHistory.map((point) => ({
          price: { amount: point.priceAmount, currency: point.priceCurrency as 'ARS' },
          recordedAt: point.recordedAt.toISOString(),
          reason: point.reason ?? undefined,
        })),
        auction: auction
          ? {
              id: auction.id,
              status: auction.status,
              startsAt: auction.startsAt.toISOString(),
              endsAt: auction.endsAt.toISOString(),
              currentPrice: {
                amount: auction.highestBidAmount ?? auction.startingPriceAmount,
                currency: auction.currency as 'ARS',
              },
              nextMinimumBid: {
                amount:
                  auction.highestBidAmount === null
                    ? auction.startingPriceAmount
                    : auction.highestBidAmount + auction.minimumIncrementAmount,
                currency: auction.currency as 'ARS',
              },
              bidCount: auction.bidCount,
              participantCount: auction.participantCount,
              buyNowPrice:
                auction.buyNowPriceAmount === null
                  ? undefined
                  : { amount: auction.buyNowPriceAmount, currency: auction.currency as 'ARS' },
              // Whether a reserve exists is public; its value never is.
              hasReserve: auction.reservePriceAmount !== null,
              reserveMet:
                auction.reservePriceAmount === null ||
                (auction.highestBidAmount ?? 0) >= auction.reservePriceAmount,
              viewerIsHighestBidder: viewerId ? auction.highestBidderId === viewerId : undefined,
            }
          : undefined,
      },
    );
  }

  async update(
    id: string,
    patch: Record<string, unknown>,
    actor: AuthenticatedUser,
  ): Promise<Listing> {
    const existing = await this.prisma.listing.findUnique({
      where: { id },
      select: { id: true, sellerId: true, storeId: true, priceAmount: true, priceCurrency: true },
    });
    if (!existing) {
      throw new NotFoundException({ message: 'Publicación no encontrada', code: 'not_found' });
    }

    if (
      !canManageListing(
        { userId: actor.userId, storeRoles: actor.storeRoles, adminRole: actor.adminRole },
        { sellerId: existing.sellerId, storeId: existing.storeId ?? undefined },
      )
    ) {
      throw new ForbiddenException({
        message: 'No podés editar esta publicación',
        code: 'forbidden',
      });
    }

    const newPrice = patch.price as { amount: number; currency: string } | undefined;

    await this.prisma.$transaction(async (tx) => {
      await tx.listing.update({
        where: { id },
        data: {
          title: patch.title as string | undefined,
          description: patch.description as string | undefined,
          categoryId: patch.categoryId as string | undefined,
          tags: patch.tags as string[] | undefined,
          condition: patch.condition as never,
          quantity: patch.quantity as number | undefined,
          acceptsOffers: patch.acceptsOffers as boolean | undefined,
          deliveryMethods: patch.deliveryMethods as never,
          followerDiscountBps: patch.followerBasisPoints as number | null | undefined,
          friendDiscountBps: patch.friendBasisPoints as number | null | undefined,
          priceAmount: newPrice?.amount,
          priceCurrency: newPrice?.currency,
        },
      });

      if (patch.location) {
        await this.writeLocation(
          tx,
          id,
          patch.location as Coordinates,
          await this.config.publicLocationFuzzMeters(),
        );
      }

      // Every price change is recorded, so the history chart has real data
      // rather than being reconstructed after the fact (spec §22).
      if (newPrice && newPrice.amount !== existing.priceAmount) {
        await tx.listingPriceHistory.create({
          data: {
            listingId: id,
            priceAmount: newPrice.amount,
            priceCurrency: newPrice.currency,
            reason: (patch.priceChangeReason as string | undefined) ?? null,
          },
        });
      }
    });

    if (newPrice && existing.priceAmount !== null && newPrice.amount !== existing.priceAmount) {
      const previous = money(existing.priceAmount, existing.priceCurrency as 'ARS');
      const next = money(newPrice.amount, newPrice.currency as 'ARS');

      // Every change is published so the history and analytics stay complete;
      // subscribers use `isNotifiablePriceDrop` to decide whether it is worth a
      // push, so a 1-peso nudge does not spam everyone who favourited it.
      await this.events.publish({
        type: 'ListingPriceChanged',
        id,
        occurredAt: new Date().toISOString(),
        listingId: id,
        sellerId: existing.sellerId,
        previousPrice: { amount: previous.amount, currency: previous.currency },
        newPrice: { amount: next.amount, currency: next.currency },
        reason:
          (patch.priceChangeReason as string | undefined) ??
          (isNotifiablePriceDrop(previous, next) ? 'price_drop' : undefined),
      });
    }

    return this.findOne(id, actor.userId);
  }

  async setStatus(
    id: string,
    status: 'active' | 'paused' | 'removed',
    actor: AuthenticatedUser,
  ): Promise<{ status: string }> {
    const existing = await this.prisma.listing.findUnique({
      where: { id },
      select: { sellerId: true, storeId: true },
    });
    if (!existing) {
      throw new NotFoundException({ message: 'Publicación no encontrada', code: 'not_found' });
    }
    if (
      !canManageListing(
        { userId: actor.userId, storeRoles: actor.storeRoles, adminRole: actor.adminRole },
        { sellerId: existing.sellerId, storeId: existing.storeId ?? undefined },
      )
    ) {
      throw new ForbiddenException({
        message: 'No podés editar esta publicación',
        code: 'forbidden',
      });
    }

    await this.prisma.listing.update({ where: { id }, data: { status } });
    return { status };
  }

  /** Selects a listing with its public location already projected to lat/lng. */
  private async selectRow(id: string): Promise<ListingRow | null> {
    const rows = await this.prisma.$queryRaw<ListingRow[]>(Prisma.sql`
      SELECT ${LISTING_ROW_COLUMNS}
      FROM "Listing" l
      WHERE l."id" = ${id}::uuid
      LIMIT 1
    `);
    return rows[0] ?? null;
  }

  /**
   * Summaries for a set of ids, in one query, resolved for this viewer.
   *
   * Anything that stores a listing reference and later needs to show it —
   * favourites, a conversation's context card, a feed row — goes through here
   * rather than writing the column list again.
   *
   * Returns a Map because callers have their own ordering (a favourite list is
   * ordered by when it was saved, not by listing id) and because ids that no
   * longer resolve simply come back missing rather than as holes in an array.
   */
  async summariesByIds(
    ids: readonly string[],
    viewerId?: string,
  ): Promise<Map<string, ListingSummary>> {
    if (ids.length === 0) return new Map();

    const rows = await this.prisma.$queryRaw<ListingRow[]>(Prisma.sql`
      SELECT ${LISTING_ROW_COLUMNS}
      FROM "Listing" l
      WHERE l."id" = ANY(${[...ids]}::uuid[])
    `);

    const summaries = await this.toSummaries(rows, viewerId);
    return new Map(summaries.map((summary) => [summary.id, summary]));
  }

  /**
   * Assembles everything the serializer needs, most importantly the viewer's
   * audience tier — which is derived from the database, never from the request.
   */
  private async buildContext(row: ListingRow, viewerId?: string) {
    const seller = await this.prisma.user.findUniqueOrThrow({
      where: { id: row.sellerId },
      select: {
        id: true,
        username: true,
        displayName: true,
        avatarUrl: true,
        verified: true,
        ratingSum: true,
        reviewCount: true,
        followerDiscountBps: true,
        friendDiscountBps: true,
      },
    });

    const tier = await this.resolveTier(row.sellerId, viewerId, row.storeId);

    const [images, favorite, store, promotions] = await Promise.all([
      this.prisma.listingImage.findMany({
        where: { listingId: row.id },
        orderBy: { position: 'asc' },
      }),
      viewerId
        ? this.prisma.favorite.findFirst({
            where: { userId: viewerId, listingId: row.id },
            select: { id: true },
          })
        : Promise.resolve(null),
      row.storeId
        ? this.prisma.store.findUnique({
            where: { id: row.storeId },
            select: {
              id: true,
              handle: true,
              name: true,
              logoUrl: true,
              verified: true,
              ratingSum: true,
              reviewCount: true,
              followerDiscountBps: true,
            },
          })
        : Promise.resolve(null),
      this.loadPromotions(row.id),
    ]);

    // A shop's listing is priced by the shop, not by whoever owns it.
    const sellerPolicy: DiscountPolicy = discountPolicyFor({
      seller: {
        followerBasisPoints: seller.followerDiscountBps,
        friendBasisPoints: seller.friendDiscountBps,
      },
      store: store ? { followerBasisPoints: store.followerDiscountBps } : null,
    });

    return {
      tier,
      sellerPolicy,
      promotions,
      seller: {
        id: seller.id,
        username: seller.username,
        displayName: seller.displayName,
        avatarUrl: seller.avatarUrl ?? undefined,
        verified: seller.verified,
        rating: seller.reviewCount > 0 ? seller.ratingSum / seller.reviewCount : undefined,
        reviewCount: seller.reviewCount,
      },
      store: store
        ? {
            id: store.id,
            handle: store.handle,
            name: store.name,
            logoUrl: store.logoUrl ?? undefined,
            verified: store.verified,
            rating: store.reviewCount > 0 ? store.ratingSum / store.reviewCount : undefined,
            followerCount: 0,
            activeListingCount: 0,
          }
        : undefined,
      images: images.map((image) => ({
        id: image.id,
        url: image.url,
        thumbnailUrl: image.thumbnailUrl,
        width: image.width,
        height: image.height,
        position: image.position,
        alt: image.alt ?? undefined,
      })),
      isFavorite: favorite !== null,
      publicLocationPrecisionMeters: await this.config.publicLocationFuzzMeters(),
      now: new Date(),
    };
  }

  /**
   * Looks up the viewer's real relationship to the seller.
   *
   * Sellers viewing their own listing resolve to `public`, so the price they see
   * is the one strangers see rather than a discount they cannot claim.
   */
  /**
   * What this viewer counts as for this seller.
   *
   * `storeId` matters because following a shop is its own relationship: it used
   * to be ignored entirely, so a shop could set a followers' rate that nobody
   * could ever earn — the only way to get a discount on a shop's listing was to
   * follow the person who owned it, which is a different thing to have done.
   */
  async resolveTier(
    sellerId: string,
    viewerId?: string,
    storeId?: string | null,
  ): Promise<AudienceTier> {
    if (!viewerId || viewerId === sellerId) return 'public';

    const [friendship, follow, storeFollow, block] = await Promise.all([
      this.prisma.friendship.findFirst({
        where: {
          OR: [
            { userAId: viewerId, userBId: sellerId },
            { userAId: sellerId, userBId: viewerId },
          ],
        },
        select: { status: true },
      }),
      this.prisma.follow.findUnique({
        where: { followerId_followeeId: { followerId: viewerId, followeeId: sellerId } },
        select: { followerId: true },
      }),
      storeId
        ? this.prisma.storeFollow.findUnique({
            where: { storeId_userId: { storeId, userId: viewerId } },
            select: { userId: true },
          })
        : Promise.resolve(null),
      this.prisma.block.findFirst({
        where: {
          OR: [
            { blockerId: viewerId, blockedId: sellerId },
            { blockerId: sellerId, blockedId: viewerId },
          ],
        },
        select: { blockerId: true },
      }),
    ]);

    return resolveAudienceTier({
      // Following the shop counts on the shop's listings, following the person
      // counts on theirs, and either is enough on a listing that has both.
      isFollowing: follow !== null || storeFollow !== null,
      isFollowedBy: false,
      friendship: friendship?.status ?? null,
      isBlocked: block !== null,
    });
  }

  private async loadPromotions(listingId: string) {
    const rows = await this.prisma.promotion.findMany({
      where: {
        active: true,
        listings: { some: { listingId } },
      },
    });

    return rows.map((promotion) => ({
      id: promotion.id,
      label: promotion.label,
      requiredTier: promotion.requiredTier as AudienceTier,
      basisPoints: promotion.basisPoints ?? undefined,
      fixedPrice:
        promotion.fixedPriceAmount === null
          ? undefined
          : money(promotion.fixedPriceAmount, promotion.currency as 'ARS'),
      startsAt: promotion.startsAt ?? undefined,
      endsAt: promotion.endsAt ?? undefined,
      stacksWithSocialDiscount: promotion.stacksWithSocialDiscount,
    }));
  }

  /** Fire-and-forget view counter; a failure here must never fail the read. */
  async incrementViewCount(id: string): Promise<void> {
    await this.prisma.listing
      .update({ where: { id }, data: { viewCount: { increment: 1 } } })
      .catch(() => undefined);
  }

  /** Serializes a batch of rows, used by search and profile listings. */
  async toSummaries(rows: ListingRow[], viewerId?: string): Promise<ListingSummary[]> {
    return Promise.all(
      rows.map(async (row) => {
        const context = await this.buildContext(row, viewerId);
        return this.serializer.toSummary(row, {
          ...context,
          rawDistanceMeters: row.distanceMeters ?? undefined,
        });
      }),
    );
  }
}
