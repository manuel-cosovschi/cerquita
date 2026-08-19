import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { AuctionsService } from './auctions.service';
import { OffersService } from '../offers/offers.service';
import { ReservationsService } from '../reservations/reservations.service';

/**
 * Drives every time-based transition in the product.
 *
 * An auction must start and end on schedule whether or not anyone has the page
 * open — the alternative is an auction that only closes when someone visits it,
 * which is exactly the client-side resolution the spec forbids (§28).
 *
 * The tick is idempotent and takes a row lock per auction, so running several
 * API instances is safe: whichever one gets the lock first closes the auction and
 * the others see it already closed.
 */
@Injectable()
export class AuctionScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AuctionScheduler.name);
  private timer?: NodeJS.Timeout;
  private running = false;

  private static readonly TICK_MS = 5_000;

  constructor(
    private readonly auctions: AuctionsService,
    private readonly offers: OffersService,
    private readonly reservations: ReservationsService,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => void this.tick(), AuctionScheduler.TICK_MS);
    // Do not keep the process alive purely for this timer.
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** Guarded against overlap so a slow tick cannot stack on itself. */
  private async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;

    try {
      // Everything time-driven runs on one tick: auctions opening and closing,
      // offers expiring, and reservations returning stock. Three timers would
      // only mean three ways to drift.
      const [started, closed, expiredOffers, releasedHolds] = await Promise.all([
        this.auctions.startDueAuctions(),
        this.auctions.closeDueAuctions(),
        this.offers.expireDueOffers(),
        this.reservations.releaseExpired(),
      ]);

      if (started || closed || expiredOffers || releasedHolds) {
        this.logger.log(
          `Tick: ${started} auctions started, ${closed} closed, ${expiredOffers} offers expired, ${releasedHolds} holds released`,
        );
      }
    } catch (error) {
      this.logger.error('Auction tick failed', error instanceof Error ? error.stack : error);
    } finally {
      this.running = false;
    }
  }
}
