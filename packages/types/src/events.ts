/**
 * Internal domain events (spec §81).
 *
 * Modules publish these instead of calling each other. Notifications, the feed,
 * analytics, saved-search matching and cache invalidation all subscribe. Keeping
 * the payloads flat and id-based means a subscriber can be moved to a separate
 * service later without changing the contract.
 */

import type { MoneyDto, UUID, IsoDateTime } from './entities.js';
import type { ListingKind, OrderStatus } from './enums.js';

export interface DomainEventBase {
  readonly id: UUID;
  readonly occurredAt: IsoDateTime;
}

export interface ListingCreated extends DomainEventBase {
  readonly type: 'ListingCreated';
  readonly listingId: UUID;
  readonly sellerId: UUID;
  readonly storeId?: UUID;
  readonly kind: ListingKind;
  readonly categoryId: UUID;
}

export interface ListingPriceChanged extends DomainEventBase {
  readonly type: 'ListingPriceChanged';
  readonly listingId: UUID;
  readonly sellerId: UUID;
  readonly previousPrice: MoneyDto;
  readonly newPrice: MoneyDto;
  readonly reason?: string;
}

export interface ListingSold extends DomainEventBase {
  readonly type: 'ListingSold';
  readonly listingId: UUID;
  readonly sellerId: UUID;
  readonly buyerId: UUID;
  readonly orderId: UUID;
}

export interface OfferCreated extends DomainEventBase {
  readonly type: 'OfferCreated';
  readonly offerId: UUID;
  readonly listingId: UUID;
  readonly fromUserId: UUID;
  readonly toUserId: UUID;
  readonly amount: MoneyDto;
}

export interface OfferAccepted extends DomainEventBase {
  readonly type: 'OfferAccepted';
  readonly offerId: UUID;
  readonly listingId: UUID;
  readonly buyerId: UUID;
  readonly sellerId: UUID;
  readonly amount: MoneyDto;
}

export interface OrderPaid extends DomainEventBase {
  readonly type: 'OrderPaid';
  readonly orderId: UUID;
  readonly buyerId: UUID;
  readonly sellerId: UUID;
  /** What the buyer paid. */
  readonly total: MoneyDto;
  /**
   * What the seller actually receives: the total minus the platform's cut.
   *
   * Carried as its own figure rather than left for each subscriber to subtract,
   * because the one place it was needed got it wrong and told a seller they
   * would collect the buyer's total. Money is the worst thing to be optimistic
   * about.
   */
  readonly sellerNet: MoneyDto;
  /**
   * What was bought, from the order's own snapshots.
   *
   * Carried on the event so a subscriber can name it without going back to the
   * database — and taken from the snapshot rather than the live listing, so the
   * notification still says what was sold after the listing is renamed or gone.
   */
  readonly itemTitles: readonly string[];
}

export interface OrderStatusChanged extends DomainEventBase {
  readonly type: 'OrderStatusChanged';
  readonly orderId: UUID;
  readonly previousStatus: OrderStatus;
  readonly newStatus: OrderStatus;
}

export interface AuctionStarted extends DomainEventBase {
  readonly type: 'AuctionStarted';
  readonly auctionId: UUID;
  readonly listingId: UUID;
  readonly sellerId: UUID;
}

export interface BidPlaced extends DomainEventBase {
  readonly type: 'BidPlaced';
  readonly auctionId: UUID;
  readonly bidId: UUID;
  readonly bidderId: UUID;
  readonly amount: MoneyDto;
  /** Set when this bid displaced someone, so `outbid` notifications can fire. */
  readonly previousHighestBidderId?: UUID;
}

export interface AuctionEnded extends DomainEventBase {
  readonly type: 'AuctionEnded';
  readonly auctionId: UUID;
  readonly listingId: UUID;
  readonly sellerId: UUID;
  readonly winnerId?: UUID;
  readonly finalPrice?: MoneyDto;
  readonly reserveMet: boolean;
}

export interface UserFollowed extends DomainEventBase {
  readonly type: 'UserFollowed';
  readonly followerId: UUID;
  readonly followeeId: UUID;
}

export interface FriendshipAccepted extends DomainEventBase {
  readonly type: 'FriendshipAccepted';
  readonly requesterId: UUID;
  readonly addresseeId: UUID;
}

export interface StoreFollowed extends DomainEventBase {
  readonly type: 'StoreFollowed';
  readonly storeId: UUID;
  readonly userId: UUID;
}

export type DomainEvent =
  | ListingCreated
  | ListingPriceChanged
  | ListingSold
  | OfferCreated
  | OfferAccepted
  | OrderPaid
  | OrderStatusChanged
  | AuctionStarted
  | BidPlaced
  | AuctionEnded
  | UserFollowed
  | FriendshipAccepted
  | StoreFollowed;

export type DomainEventType = DomainEvent['type'];

/** Narrows the union by its `type` tag, for typed subscribers. */
export type DomainEventOf<T extends DomainEventType> = Extract<DomainEvent, { type: T }>;
