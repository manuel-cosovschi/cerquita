import { Injectable, OnModuleInit } from '@nestjs/common';
import { formatMoney, money } from '@cerquita/utils';
import { isNotifiablePriceDrop } from '@cerquita/domain';
import { EventBus } from '../events/event-bus.service';
import { NotificationsService } from './notifications.service';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Turns domain events into notifications and feed entries (spec §56, §81).
 *
 * This is what makes the event bus worth having: the auctions module does not
 * know notifications exist, and the listings module does not know about the
 * feed. Both just publish what happened.
 *
 * Every handler is defensive — the bus already isolates failures, but a
 * notification that cannot be built must never look like the underlying action
 * failed.
 */
@Injectable()
export class NotificationSubscribers implements OnModuleInit {
  constructor(
    private readonly events: EventBus,
    private readonly notifications: NotificationsService,
    private readonly prisma: PrismaService,
  ) {}

  onModuleInit(): void {
    this.events.on('OfferCreated', async (event) => {
      const listing = await this.listingTitle(event.listingId);
      const from = await this.displayName(event.fromUserId);

      await this.notifications.create({
        userId: event.toUserId,
        type: 'offer',
        title: `${from} te ofertó por ${listing}`,
        body: formatMoney(money(event.amount.amount, event.amount.currency)),
        deepLink: `cerquita://listing/${event.listingId}`,
      });
    });

    this.events.on('OfferAccepted', async (event) => {
      const listing = await this.listingTitle(event.listingId);

      await this.notifications.create({
        userId: event.buyerId,
        type: 'offer_accepted',
        title: '¡Aceptaron tu oferta!',
        body: `${listing} por ${formatMoney(money(event.amount.amount, event.amount.currency))}`,
        deepLink: `cerquita://listing/${event.listingId}`,
      });
    });

    this.events.on('BidPlaced', async (event) => {
      // Only the person who just lost the lead needs to hear about this.
      if (!event.previousHighestBidderId) return;
      if (event.previousHighestBidderId === event.bidderId) return;

      await this.notifications.create({
        userId: event.previousHighestBidderId,
        type: 'outbid',
        title: 'Te superaron en la subasta',
        body: `La oferta actual es ${formatMoney(money(event.amount.amount, event.amount.currency))}`,
        deepLink: `cerquita://auction/${event.auctionId}`,
      });
    });

    this.events.on('AuctionEnded', async (event) => {
      const listing = await this.listingTitle(event.listingId);

      if (event.winnerId && event.finalPrice) {
        await this.notifications.create({
          userId: event.winnerId,
          type: 'auction_won',
          title: `Ganaste la subasta de ${listing}`,
          body: formatMoney(money(event.finalPrice.amount, event.finalPrice.currency)),
          deepLink: `cerquita://auction/${event.auctionId}`,
        });
      }

      await this.notifications.create({
        userId: event.sellerId,
        type: 'sale',
        title: event.winnerId
          ? `Se vendió ${listing}`
          : `Terminó la subasta de ${listing} sin ventas`,
        body: event.reserveMet ? undefined : 'No se alcanzó el precio de reserva',
        deepLink: `cerquita://auction/${event.auctionId}`,
      });
    });

    this.events.on('OrderPaid', async (event) => {
      const total = formatMoney(money(event.total.amount, event.total.currency));

      await this.notifications.create({
        userId: event.sellerId,
        type: 'sale',
        title: 'Vendiste un producto',
        body: `Cobrás ${total}`,
        deepLink: `cerquita://order/${event.orderId}`,
      });

      await this.notifications.create({
        userId: event.buyerId,
        type: 'purchase',
        title: 'Compra confirmada',
        body: total,
        deepLink: `cerquita://order/${event.orderId}`,
      });
    });

    this.events.on('UserFollowed', async (event) => {
      const follower = await this.displayName(event.followerId);

      await this.notifications.create({
        userId: event.followeeId,
        type: 'new_follower',
        title: `${follower} te empezó a seguir`,
        deepLink: `cerquita://user/${event.followerId}`,
      });
    });

    this.events.on('FriendshipAccepted', async (event) => {
      const addressee = await this.displayName(event.addresseeId);

      await this.notifications.create({
        userId: event.requesterId,
        type: 'friend_accepted',
        title: `${addressee} aceptó tu solicitud`,
        body: 'Ahora ven los precios de amigo entre ustedes',
        deepLink: `cerquita://user/${event.addresseeId}`,
      });
    });

    this.events.on('ListingPriceChanged', async (event) => {
      const previous = money(event.previousPrice.amount, event.previousPrice.currency);
      const next = money(event.newPrice.amount, event.newPrice.currency);

      // Only a meaningful drop is worth interrupting someone for.
      if (!isNotifiablePriceDrop(previous, next)) return;

      const listing = await this.listingTitle(event.listingId);
      const watchers = await this.prisma.favorite.findMany({
        where: { listingId: event.listingId },
        select: { userId: true },
      });

      await this.notifications.createMany(
        watchers.map((watcher) => watcher.userId).filter((id) => id !== event.sellerId),
        (userId) => ({
          userId,
          type: 'price_drop',
          title: `Bajó de precio: ${listing}`,
          body: `Ahora ${formatMoney(next)}`,
          deepLink: `cerquita://listing/${event.listingId}`,
        }),
      );
    });

    // Feed fan-out: followers and friends learn about new listings (spec §33).
    this.events.on('ListingCreated', async (event) => {
      const listing = await this.listingTitle(event.listingId);
      const actor = await this.displayName(event.sellerId);
      const audience = await this.audienceOf(event.sellerId);

      if (audience.length === 0) return;

      const headline =
        event.kind === 'wanted'
          ? `${actor} busca ${listing}`
          : event.kind === 'auction'
            ? `${actor} inició una subasta: ${listing}`
            : `${actor} publicó ${listing}`;

      await this.prisma.feedItem.createMany({
        data: audience.map((userId) => ({
          userId,
          type:
            event.kind === 'wanted'
              ? ('wanted_listing' as const)
              : event.kind === 'auction'
                ? ('new_auction' as const)
                : ('new_listing' as const),
          actorId: event.sellerId,
          storeId: event.storeId,
          listingId: event.listingId,
          headline,
        })),
      });
    });

    this.events.on('StoreFollowed', async (event) => {
      const store = await this.prisma.store.findUnique({
        where: { id: event.storeId },
        select: { name: true, members: { where: { role: 'owner' }, select: { userId: true } } },
      });
      if (!store) return;

      const follower = await this.displayName(event.userId);

      await this.notifications.createMany(
        store.members.map((member) => member.userId),
        (userId) => ({
          userId,
          type: 'new_follower',
          title: `${follower} empezó a seguir ${store.name}`,
          deepLink: `cerquita://store/${event.storeId}`,
        }),
      );
    });
  }

  /** Everyone who follows or is friends with a seller — the feed audience. */
  private async audienceOf(sellerId: string): Promise<string[]> {
    const [followers, friendships] = await Promise.all([
      this.prisma.follow.findMany({
        where: { followeeId: sellerId },
        select: { followerId: true },
      }),
      this.prisma.friendship.findMany({
        where: {
          status: 'accepted',
          OR: [{ userAId: sellerId }, { userBId: sellerId }],
        },
        select: { userAId: true, userBId: true },
      }),
    ]);

    const audience = new Set(followers.map((follow) => follow.followerId));
    for (const friendship of friendships) {
      audience.add(friendship.userAId === sellerId ? friendship.userBId : friendship.userAId);
    }
    audience.delete(sellerId);

    return [...audience];
  }

  private async listingTitle(listingId: string): Promise<string> {
    const listing = await this.prisma.listing.findUnique({
      where: { id: listingId },
      select: { title: true },
    });
    return listing?.title ?? 'una publicación';
  }

  private async displayName(userId: string): Promise<string> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { displayName: true },
    });
    return user?.displayName ?? 'Alguien';
  }
}
