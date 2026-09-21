import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import type { Server, Socket } from 'socket.io';
import type { MoneyDto } from '@cerquita/types';
import { loadConfig } from '../../config/configuration';

interface BidBroadcast {
  currentPrice: MoneyDto;
  nextMinimumBid: MoneyDto;
  endsAt: string;
  highestBidderId: string;
}

/**
 * Realtime auction updates (spec §27, §28).
 *
 * Read-only by design: bids are placed over HTTP so they go through the same
 * guard, validation and transaction as every other write. The socket only
 * broadcasts what the server already decided — it never accepts a bid, and a
 * client cannot influence the outcome through it.
 */
@WebSocketGateway({
  namespace: '/auctions',
  cors: { origin: loadConfig().corsOrigins, credentials: true },
})
export class AuctionsGateway {
  private readonly logger = new Logger(AuctionsGateway.name);

  @WebSocketServer()
  private server!: Server;

  @SubscribeMessage('watch')
  watch(@MessageBody() auctionId: string, @ConnectedSocket() client: Socket): { watching: string } {
    // Validated so a client cannot join an arbitrary room name.
    if (!isUuid(auctionId)) return { watching: '' };
    void client.join(room(auctionId));
    return { watching: auctionId };
  }

  @SubscribeMessage('unwatch')
  unwatch(@MessageBody() auctionId: string, @ConnectedSocket() client: Socket): void {
    if (isUuid(auctionId)) void client.leave(room(auctionId));
  }

  broadcastBid(auctionId: string, payload: BidBroadcast): void {
    this.server?.to(room(auctionId)).emit('bid', { auctionId, ...payload });
  }

  broadcastEnded(auctionId: string, payload: { winnerId?: string; finalPrice?: MoneyDto }): void {
    this.logger.log(`Auction ${auctionId} ended`);
    this.server?.to(room(auctionId)).emit('ended', { auctionId, ...payload });
  }
}

const room = (auctionId: string): string => `auction:${auctionId}`;

function isUuid(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
  );
}
