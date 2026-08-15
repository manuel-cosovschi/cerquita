import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  canConsumeReservation,
  reservationExpiry,
  selectExpiredReservations,
} from '@cerquita/domain';
import { PrismaService } from '../../prisma/prisma.service';
import { ConfigService } from '../config/config.service';

/**
 * Reservations (spec §26).
 *
 * A reservation holds stock for a buyer for a bounded time. It uses the same
 * conditional-UPDATE guard as checkout, so holding and buying can never
 * collectively exceed what exists.
 *
 * Expiry is swept by a job rather than evaluated on read: stock that nobody
 * released must come back on its own, whether or not anyone looks at the
 * listing.
 */
@Injectable()
export class ReservationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async create(input: {
    listingId: string;
    variantId?: string;
    quantity: number;
    buyerId: string;
  }) {
    const listing = await this.prisma.listing.findUnique({
      where: { id: input.listingId },
      select: { id: true, sellerId: true, status: true, reservationMinutes: true, title: true },
    });

    if (!listing) {
      throw new NotFoundException({ message: 'Publicación no encontrada', code: 'not_found' });
    }
    if (listing.sellerId === input.buyerId) {
      throw new BadRequestException({
        message: 'No podés reservar tu propia publicación',
        code: 'own_listing',
      });
    }
    if (listing.status !== 'active') {
      throw new BadRequestException({
        message: 'La publicación no está disponible',
        code: 'unavailable',
      });
    }

    const existing = await this.prisma.reservation.findFirst({
      where: {
        listingId: listing.id,
        buyerId: input.buyerId,
        status: 'active',
        expiresAt: { gt: new Date() },
      },
      select: { id: true, expiresAt: true },
    });
    if (existing) return existing;

    const minutes = listing.reservationMinutes ?? (await this.config.defaultReservationMinutes());
    const expiresAt = reservationExpiry(new Date(), minutes);

    return this.prisma.$transaction(async (tx) => {
      // Same conditional UPDATE checkout uses: the hold only succeeds if the
      // stock is genuinely free at this instant.
      const affected = await tx.$executeRaw`
        UPDATE "Listing"
        SET "reserved" = "reserved" + ${input.quantity}
        WHERE "id" = ${listing.id}::uuid
          AND "quantity" - "reserved" - "sold" >= ${input.quantity}
      `;

      if (affected === 0) {
        throw new ConflictException({
          message: `No queda stock disponible de "${listing.title}"`,
          code: 'insufficient_stock',
        });
      }

      return tx.reservation.create({
        data: {
          listingId: listing.id,
          variantId: input.variantId,
          buyerId: input.buyerId,
          quantity: input.quantity,
          expiresAt,
        },
        select: { id: true, expiresAt: true },
      });
    });
  }

  async release(reservationId: string, actorId: string): Promise<{ ok: true }> {
    const reservation = await this.prisma.reservation.findUnique({
      where: { id: reservationId },
      select: { id: true, buyerId: true, listingId: true, quantity: true, status: true },
    });

    if (!reservation) {
      throw new NotFoundException({ message: 'Reserva no encontrada', code: 'not_found' });
    }
    if (reservation.buyerId !== actorId) {
      throw new ForbiddenException({ message: 'Esa reserva no es tuya', code: 'forbidden' });
    }
    if (reservation.status !== 'active') return { ok: true };

    await this.returnToStock([reservation], 'released');
    return { ok: true };
  }

  async listForBuyer(buyerId: string) {
    const rows = await this.prisma.reservation.findMany({
      where: { buyerId, status: 'active', expiresAt: { gt: new Date() } },
      orderBy: { expiresAt: 'asc' },
      include: {
        listing: { select: { id: true, title: true, priceAmount: true, priceCurrency: true } },
      },
    });

    return rows.map((row) => ({
      id: row.id,
      quantity: row.quantity,
      expiresAt: row.expiresAt.toISOString(),
      listing: {
        id: row.listing.id,
        title: row.listing.title,
        price:
          row.listing.priceAmount === null
            ? undefined
            : { amount: row.listing.priceAmount, currency: row.listing.priceCurrency },
      },
    }));
  }

  /** Whether the buyer may still check out against this hold. */
  async canConsume(reservationId: string, buyerId: string): Promise<boolean> {
    const reservation = await this.prisma.reservation.findUnique({ where: { id: reservationId } });
    if (!reservation) return false;

    return canConsumeReservation(
      {
        id: reservation.id,
        listingId: reservation.listingId,
        buyerId: reservation.buyerId,
        quantity: reservation.quantity,
        status: reservation.status,
        expiresAt: reservation.expiresAt,
      },
      buyerId,
      new Date(),
    );
  }

  /** Sweeper: returns expired holds to stock. Driven by the scheduler. */
  async releaseExpired(now = new Date()): Promise<number> {
    const candidates = await this.prisma.reservation.findMany({
      where: { status: 'active', expiresAt: { lte: now } },
      select: {
        id: true,
        listingId: true,
        quantity: true,
        status: true,
        expiresAt: true,
        buyerId: true,
      },
      take: 200,
    });

    const expired = selectExpiredReservations(
      candidates.map((row) => ({ ...row, status: row.status })),
      now,
    );
    if (expired.length === 0) return 0;

    await this.returnToStock(expired, 'expired');
    return expired.length;
  }

  private async returnToStock(
    reservations: ReadonlyArray<{ id: string; listingId: string; quantity: number }>,
    status: 'released' | 'expired',
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      for (const reservation of reservations) {
        // GREATEST keeps the counter sane even if something already released it.
        await tx.$executeRaw`
          UPDATE "Listing"
          SET "reserved" = GREATEST(0, "reserved" - ${reservation.quantity})
          WHERE "id" = ${reservation.listingId}::uuid
        `;
        await tx.reservation.updateMany({
          where: { id: reservation.id, status: 'active' },
          data: { status },
        });
      }
    });
  }
}
