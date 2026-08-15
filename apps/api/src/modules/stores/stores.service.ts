import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Store, StoreRole } from '@cerquita/types';
import { canDeleteStore, canManageStore, storeRoleSatisfies } from '@cerquita/domain';
import { fuzzCoordinates, type Coordinates } from '@cerquita/utils';
import { PrismaService } from '../../prisma/prisma.service';
import { ConfigService } from '../config/config.service';
import type { AuthenticatedUser } from '../../common/current-user.decorator';

/**
 * Stores (spec §37-§39, §49).
 *
 * A store is NOT an account. Any user can create one, and membership is a role
 * on an existing user — which is why nobody has to register a second identity to
 * sell as a business, and why one person can belong to several stores with a
 * different role in each.
 */
@Injectable()
export class StoresService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async create(
    input: {
      name: string;
      handle: string;
      description?: string;
      categories: string[];
      hasPhysicalLocation: boolean;
      location?: Coordinates;
      address?: string;
      deliveryMethods: string[];
    },
    actor: AuthenticatedUser,
  ): Promise<Store> {
    const taken = await this.prisma.store.findUnique({
      where: { handle: input.handle },
      select: { id: true },
    });
    if (taken) {
      throw new ConflictException({
        message: 'Ese nombre de tienda ya está en uso',
        code: 'handle_taken',
      });
    }
    if (input.hasPhysicalLocation && !input.location) {
      throw new BadRequestException({
        message: 'Indicá dónde queda el local',
        code: 'location_required',
      });
    }

    const store = await this.prisma.store.create({
      data: {
        handle: input.handle,
        name: input.name,
        description: input.description,
        categories: input.categories,
        hasPhysicalLocation: input.hasPhysicalLocation,
        address: input.address,
        deliveryMethods: input.deliveryMethods as never,
        // The creator is the owner; that is the only way an owner is assigned.
        members: { create: { userId: actor.userId, role: 'owner' } },
      },
      select: { id: true },
    });

    if (input.location) {
      await this.writeLocation(store.id, input.location);
    }

    return this.findByHandle(input.handle, actor.userId);
  }

  private async writeLocation(storeId: string, exact: Coordinates): Promise<void> {
    // A storefront is a public address, but the exact point is still stored
    // separately so the same serialization rule holds everywhere.
    const fuzzMeters = await this.config.publicLocationFuzzMeters();
    const publicPoint = fuzzCoordinates(exact, storeId, fuzzMeters);

    await this.prisma.$executeRaw`
      UPDATE "Store"
      SET "exactLocation"  = ST_SetSRID(ST_MakePoint(${exact.lng}, ${exact.lat}), 4326)::geography,
          "publicLocation" = ST_SetSRID(ST_MakePoint(${publicPoint.lng}, ${publicPoint.lat}), 4326)::geography
      WHERE "id" = ${storeId}::uuid
    `;
  }

  async findByHandle(handle: string, viewerId?: string): Promise<Store> {
    const rows = await this.prisma.$queryRaw<
      Array<{
        id: string;
        handle: string;
        name: string;
        description: string | null;
        logoUrl: string | null;
        coverUrl: string | null;
        categories: string[];
        verified: boolean;
        hasPhysicalLocation: boolean;
        address: string | null;
        ratingSum: number;
        reviewCount: number;
        lat: number | null;
        lng: number | null;
      }>
    >`
      SELECT s."id", s."handle", s."name", s."description", s."logoUrl", s."coverUrl",
             s."categories", s."verified", s."hasPhysicalLocation", s."address",
             s."ratingSum", s."reviewCount",
             ST_Y(s."publicLocation"::geometry) AS lat,
             ST_X(s."publicLocation"::geometry) AS lng
      FROM "Store" s
      WHERE s."handle" = ${handle}
      LIMIT 1
    `;

    const store = rows[0];
    if (!store) {
      throw new NotFoundException({ message: 'Tienda no encontrada', code: 'not_found' });
    }

    const [followerCount, activeListingCount, isFollowed, membership, hours, deliveryMethods] =
      await Promise.all([
        this.prisma.storeFollow.count({ where: { storeId: store.id } }),
        this.prisma.listing.count({ where: { storeId: store.id, status: 'active' } }),
        viewerId
          ? this.prisma.storeFollow.findUnique({
              where: { storeId_userId: { storeId: store.id, userId: viewerId } },
              select: { userId: true },
            })
          : Promise.resolve(null),
        viewerId
          ? this.prisma.storeMember.findUnique({
              where: { storeId_userId: { storeId: store.id, userId: viewerId } },
              select: { role: true },
            })
          : Promise.resolve(null),
        this.prisma.storeOpeningHours.findMany({
          where: { storeId: store.id },
          orderBy: { weekday: 'asc' },
        }),
        this.prisma.store.findUniqueOrThrow({
          where: { id: store.id },
          select: { deliveryMethods: true },
        }),
      ]);

    const openingHours = hours.map((entry) => ({
      weekday: entry.weekday,
      opensAt: entry.opensAt,
      closesAt: entry.closesAt,
    }));

    return {
      id: store.id,
      handle: store.handle,
      name: store.name,
      description: store.description ?? undefined,
      logoUrl: store.logoUrl ?? undefined,
      coverUrl: store.coverUrl ?? undefined,
      categories: store.categories,
      verified: store.verified,
      rating: store.reviewCount > 0 ? store.ratingSum / store.reviewCount : undefined,
      followerCount,
      activeListingCount,
      hasPhysicalLocation: store.hasPhysicalLocation,
      address: store.hasPhysicalLocation ? (store.address ?? undefined) : undefined,
      location:
        store.lat !== null && store.lng !== null
          ? {
              point: { lat: store.lat, lng: store.lng },
              precisionMeters: await this.config.publicLocationFuzzMeters(),
            }
          : undefined,
      openingHours,
      isOpenNow: isOpenNow(openingHours, new Date()),
      deliveryMethods: deliveryMethods.deliveryMethods as Store['deliveryMethods'],
      isFollowedByViewer: isFollowed !== null,
      viewerRole: (membership?.role as StoreRole | undefined) ?? undefined,
    };
  }

  async update(
    storeId: string,
    patch: Record<string, unknown>,
    actor: AuthenticatedUser,
  ): Promise<Store> {
    this.assertCanManage(actor, storeId);

    const store = await this.prisma.store.update({
      where: { id: storeId },
      data: {
        name: patch.name as string | undefined,
        description: patch.description as string | undefined,
        categories: patch.categories as string[] | undefined,
        hasPhysicalLocation: patch.hasPhysicalLocation as boolean | undefined,
        address: patch.address as string | undefined,
        deliveryMethods: patch.deliveryMethods as never,
      },
      select: { handle: true },
    });

    if (patch.location) {
      await this.writeLocation(storeId, patch.location as Coordinates);
    }

    return this.findByHandle(store.handle, actor.userId);
  }

  async addMember(
    storeId: string,
    input: { userId: string; role: Exclude<StoreRole, 'owner'> },
    actor: AuthenticatedUser,
  ): Promise<{ ok: true }> {
    this.assertCanManage(actor, storeId);

    // Ownership transfer is a separate, deliberate operation — it cannot happen
    // by accident through the member endpoint.
    await this.prisma.storeMember.upsert({
      where: { storeId_userId: { storeId, userId: input.userId } },
      update: { role: input.role },
      create: { storeId, userId: input.userId, role: input.role },
    });

    return { ok: true };
  }

  async removeMember(
    storeId: string,
    userId: string,
    actor: AuthenticatedUser,
  ): Promise<{ ok: true }> {
    this.assertCanManage(actor, storeId);

    const member = await this.prisma.storeMember.findUnique({
      where: { storeId_userId: { storeId, userId } },
      select: { role: true },
    });

    if (member?.role === 'owner') {
      // Removing the last owner would orphan the store.
      const owners = await this.prisma.storeMember.count({ where: { storeId, role: 'owner' } });
      if (owners <= 1) {
        throw new BadRequestException({
          message: 'La tienda necesita al menos un dueño',
          code: 'last_owner',
        });
      }
    }

    await this.prisma.storeMember.deleteMany({ where: { storeId, userId } });
    return { ok: true };
  }

  async listMembers(storeId: string, actor: AuthenticatedUser) {
    if (!actor.storeRoles[storeId]) {
      throw new ForbiddenException({ message: 'No pertenecés a esta tienda', code: 'forbidden' });
    }

    return this.prisma.storeMember.findMany({
      where: { storeId },
      select: {
        role: true,
        createdAt: true,
        user: { select: { id: true, username: true, displayName: true, avatarUrl: true } },
      },
    });
  }

  async setOpeningHours(
    storeId: string,
    hours: Array<{ weekday: number; opensAt: number; closesAt: number }>,
    actor: AuthenticatedUser,
  ): Promise<{ ok: true }> {
    this.assertCanManage(actor, storeId);

    await this.prisma.$transaction([
      this.prisma.storeOpeningHours.deleteMany({ where: { storeId } }),
      this.prisma.storeOpeningHours.createMany({
        data: hours.map((entry) => ({ storeId, ...entry })),
      }),
    ]);

    return { ok: true };
  }

  async remove(storeId: string, actor: AuthenticatedUser): Promise<{ ok: true }> {
    if (!canDeleteStore({ userId: actor.userId, storeRoles: actor.storeRoles }, storeId)) {
      throw new ForbiddenException({
        message: 'Sólo el dueño puede eliminar la tienda',
        code: 'forbidden',
      });
    }

    await this.prisma.store.delete({ where: { id: storeId } });
    return { ok: true };
  }

  /**
   * Seller dashboard (spec §50).
   *
   * Aggregated in SQL rather than by loading rows into memory — a store with
   * thousands of orders must not need all of them in the process to show a total.
   */
  async dashboard(storeId: string, actor: AuthenticatedUser) {
    const role = actor.storeRoles[storeId];
    if (!role || !storeRoleSatisfies(role, 'manager')) {
      throw new ForbiddenException({
        message: 'No tenés permisos para ver las métricas',
        code: 'forbidden',
      });
    }

    const [totals, listings, followers] = await Promise.all([
      this.prisma.$queryRaw<Array<{ orders: bigint; revenue: bigint | null; buyers: bigint }>>`
        SELECT COUNT(*)                                  AS orders,
               COALESCE(SUM("total"), 0)                 AS revenue,
               COUNT(DISTINCT "buyerId")                 AS buyers
        FROM "Order"
        WHERE "storeId" = ${storeId}::uuid
          AND "status" IN ('paid','preparing','ready_for_pickup','shipped','delivered','completed')
      `,
      this.prisma.$queryRaw<
        Array<{ active: bigint; sold: bigint; views: bigint | null; favorites: bigint | null }>
      >`
        SELECT COUNT(*) FILTER (WHERE "status" = 'active')  AS active,
               COUNT(*) FILTER (WHERE "status" = 'sold')    AS sold,
               COALESCE(SUM("viewCount"), 0)                AS views,
               COALESCE(SUM("favoriteCount"), 0)            AS favorites
        FROM "Listing"
        WHERE "storeId" = ${storeId}::uuid
      `,
      this.prisma.storeFollow.count({ where: { storeId } }),
    ]);

    const orderTotals = totals[0];
    const listingTotals = listings[0];
    const orders = Number(orderTotals?.orders ?? 0);
    const views = Number(listingTotals?.views ?? 0);

    return {
      orders,
      revenue: { amount: Number(orderTotals?.revenue ?? 0), currency: 'ARS' as const },
      buyers: Number(orderTotals?.buyers ?? 0),
      averageTicket: {
        amount: orders > 0 ? Math.round(Number(orderTotals?.revenue ?? 0) / orders) : 0,
        currency: 'ARS' as const,
      },
      activeListings: Number(listingTotals?.active ?? 0),
      soldListings: Number(listingTotals?.sold ?? 0),
      views,
      favorites: Number(listingTotals?.favorites ?? 0),
      followers,
      // Views to orders. Zero views means no rate, not a rate of zero.
      conversionRate: views > 0 ? Math.round((orders / views) * 10_000) / 100 : null,
    };
  }

  private assertCanManage(actor: AuthenticatedUser, storeId: string): void {
    if (!canManageStore({ userId: actor.userId, storeRoles: actor.storeRoles }, storeId)) {
      throw new ForbiddenException({
        message: 'No tenés permisos sobre esta tienda',
        code: 'forbidden',
      });
    }
  }
}

/** Whether the store is open right now, from its weekly schedule. */
export function isOpenNow(
  hours: Array<{ weekday: number; opensAt: number; closesAt: number }>,
  now: Date,
): boolean | undefined {
  if (hours.length === 0) return undefined;

  const weekday = now.getDay();
  const minutes = now.getHours() * 60 + now.getMinutes();

  return hours.some(
    (entry) => entry.weekday === weekday && minutes >= entry.opensAt && minutes < entry.closesAt,
  );
}
