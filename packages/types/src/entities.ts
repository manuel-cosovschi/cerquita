/**
 * Wire-shape entities: what the API returns and the clients consume.
 *
 * These are deliberately NOT the database rows. The most important difference is
 * location: a `Listing` carries only `publicLocation`. Exact coordinates exist in
 * the database and never appear in this file (spec §100).
 */

import type { Coordinates, Currency } from '@cerquita/utils';
import type {
  AudienceTier,
  AuctionStatus,
  ConversationContext,
  DeliveryMethod,
  DisputeStatus,
  FeedItemType,
  FriendshipStatus,
  ItemCondition,
  ListingKind,
  ListingStatus,
  MessageKind,
  NotificationType,
  OfferStatus,
  OrderStatus,
  PromotionKind,
  StoreRole,
  SubscriptionPlan,
} from './enums.js';

export type UUID = string;
/** ISO-8601 UTC instant, e.g. `2026-08-14T12:00:00.000Z`. */
export type IsoDateTime = string;

/** Money as it travels over the wire: integer minor units plus currency. */
export interface MoneyDto {
  readonly amount: number;
  readonly currency: Currency;
}

/**
 * The only location shape the API is allowed to emit for another user's content.
 * `point` is already fuzzed; `precisionMeters` tells the client how much to trust it.
 */
export interface PublicLocation {
  readonly point: Coordinates;
  readonly precisionMeters: number;
  readonly neighborhood?: string;
  readonly city?: string;
  readonly region?: string;
  readonly country?: string;
}

export interface ImageAsset {
  readonly id: UUID;
  readonly url: string;
  readonly thumbnailUrl: string;
  readonly width: number;
  readonly height: number;
  readonly position: number;
  readonly alt?: string;
}

export interface UserSummary {
  readonly id: UUID;
  readonly username: string;
  readonly displayName: string;
  readonly avatarUrl?: string;
  readonly verified: boolean;
  readonly rating?: number;
  readonly reviewCount: number;
  /** The viewer's relationship to this user. `undefined` when unauthenticated. */
  readonly relationship?: RelationshipState;
}

export interface RelationshipState {
  readonly isFollowing: boolean;
  readonly isFollowedBy: boolean;
  readonly friendship: FriendshipStatus | null;
  /** Resolved tier used for pricing. Computed by the server, never by the client. */
  readonly tier: AudienceTier;
}

export interface UserProfile extends UserSummary {
  /**
   * "Amiga de Nacho" — friends this viewer and this person have in common,
   * already phrased. Null when there is no connection, and always null for an
   * anonymous viewer: the graph is resolved per viewer, never published.
   */
  readonly socialProof: string | null;
  readonly bio?: string;
  readonly area?: string;
  readonly joinedAt: IsoDateTime;
  readonly salesCount: number;
  readonly purchasesCount: number;
  readonly followerCount: number;
  readonly followingCount: number;
  readonly friendCount: number;
  readonly stores: StoreSummary[];
  readonly plan: SubscriptionPlan;
}

export interface StoreSummary {
  readonly id: UUID;
  readonly handle: string;
  readonly name: string;
  readonly logoUrl?: string;
  readonly verified: boolean;
  readonly rating?: number;
  readonly followerCount: number;
  readonly activeListingCount: number;
}

export interface Store extends StoreSummary {
  readonly description?: string;
  readonly coverUrl?: string;
  readonly categories: string[];
  readonly location?: PublicLocation;
  readonly hasPhysicalLocation: boolean;
  /** Present only when the store publishes a storefront address. */
  readonly address?: string;
  readonly openingHours?: OpeningHours[];
  readonly isOpenNow?: boolean;
  readonly deliveryMethods: DeliveryMethod[];
  readonly isFollowedByViewer: boolean;
  readonly viewerRole?: StoreRole;
}

export interface OpeningHours {
  /** 0 = Sunday. */
  readonly weekday: number;
  /** Minutes from midnight, store-local. */
  readonly opensAt: number;
  readonly closesAt: number;
}

/**
 * The price a specific viewer is entitled to.
 *
 * `effective` is what checkout will charge; the server recomputes it there and
 * does not trust anything the client echoes back (spec §23, §41).
 */
export interface ResolvedPrice {
  readonly list: MoneyDto;
  readonly effective: MoneyDto;
  readonly tier: AudienceTier;
  readonly discountBasisPoints: number;
  readonly appliedPromotionId?: UUID;
  readonly reason?: string;
}

export interface ListingSummary {
  readonly id: UUID;
  readonly kind: ListingKind;
  readonly status: ListingStatus;
  readonly title: string;
  readonly coverImage?: ImageAsset;
  readonly price?: ResolvedPrice;
  /** Wanted posts carry a budget ceiling instead of a price. */
  readonly maxBudget?: MoneyDto;
  readonly condition?: ItemCondition;
  readonly categoryId: UUID;
  readonly location: PublicLocation;
  /** Bucketed metres from the viewer. Absent when the viewer has no location. */
  readonly distanceMeters?: number;
  readonly seller: UserSummary;
  readonly store?: StoreSummary;
  readonly auction?: AuctionSummary;
  readonly isFavorite: boolean;
  readonly isPromoted: boolean;
  readonly publishedAt?: IsoDateTime;
}

export interface Listing extends ListingSummary {
  readonly description: string;
  readonly images: ImageAsset[];
  readonly tags: string[];
  readonly quantity: number;
  readonly availableQuantity: number;
  readonly deliveryMethods: DeliveryMethod[];
  readonly acceptsOffers: boolean;
  readonly priceHistory: PricePoint[];
  readonly viewCount: number;
  readonly favoriteCount: number;
  readonly commentCount: number;
  readonly createdAt: IsoDateTime;
  readonly updatedAt: IsoDateTime;
  /** Radius the wanted post covers, in metres. Wanted listings only. */
  readonly wantedRadiusMeters?: number;
  /**
   * Why the viewer should trust this seller, e.g. "Amigo de Nacho" (spec §46,
   * direction 1c). Null when there is no connection. Resolved server-side from
   * the graph — the client never computes it.
   */
  readonly socialProof?: string | null;
}

export interface PricePoint {
  readonly price: MoneyDto;
  readonly recordedAt: IsoDateTime;
  readonly reason?: string;
}

export interface AuctionSummary {
  readonly id: UUID;
  readonly status: AuctionStatus;
  readonly startsAt: IsoDateTime;
  readonly endsAt: IsoDateTime;
  readonly currentPrice: MoneyDto;
  readonly nextMinimumBid: MoneyDto;
  readonly bidCount: number;
  readonly participantCount: number;
  readonly buyNowPrice?: MoneyDto;
  /** Whether a reserve exists and whether it has been met. Never the reserve value. */
  readonly hasReserve: boolean;
  readonly reserveMet: boolean;
  readonly viewerIsHighestBidder?: boolean;
}

export interface Auction extends AuctionSummary {
  readonly listingId: UUID;
  readonly startingPrice: MoneyDto;
  readonly minimumIncrement: MoneyDto;
  readonly bids: BidSummary[];
  readonly winnerId?: UUID;
}

export interface BidSummary {
  readonly id: UUID;
  readonly amount: MoneyDto;
  readonly bidder: UserSummary;
  readonly placedAt: IsoDateTime;
}

export interface Offer {
  readonly id: UUID;
  readonly listingId: UUID;
  readonly status: OfferStatus;
  readonly amount: MoneyDto;
  readonly fromUser: UserSummary;
  readonly toUser: UserSummary;
  readonly message?: string;
  readonly expiresAt?: IsoDateTime;
  readonly counterOfOfferId?: UUID;
  readonly createdAt: IsoDateTime;
}

export interface CartItem {
  readonly id: UUID;
  readonly listingId: UUID;
  readonly variantId?: UUID;
  readonly title: string;
  readonly image?: ImageAsset;
  readonly quantity: number;
  readonly unitPrice: ResolvedPrice;
  readonly lineTotal: MoneyDto;
  readonly availableQuantity: number;
}

/** Carts are always scoped to one seller or store — never mixed (spec §40). */
export interface Cart {
  readonly id: UUID;
  readonly sellerId: UUID;
  readonly store?: StoreSummary;
  readonly seller: UserSummary;
  readonly items: CartItem[];
  readonly subtotal: MoneyDto;
  readonly discountTotal: MoneyDto;
  readonly total: MoneyDto;
  readonly currency: Currency;
}

export interface OrderItem {
  readonly id: UUID;
  /** Snapshot taken at purchase time; never re-read from the live listing. */
  readonly titleSnapshot: string;
  readonly unitPriceSnapshot: MoneyDto;
  readonly imageUrlSnapshot?: string;
  readonly variantLabelSnapshot?: string;
  readonly quantity: number;
  readonly lineTotal: MoneyDto;
  readonly listingId?: UUID;
  readonly variantId?: UUID;
}

export interface Order {
  readonly id: UUID;
  readonly reference: string;
  readonly status: OrderStatus;
  readonly buyer: UserSummary;
  readonly seller: UserSummary;
  readonly store?: StoreSummary;
  readonly items: OrderItem[];
  readonly subtotal: MoneyDto;
  readonly discountTotal: MoneyDto;
  readonly shippingTotal: MoneyDto;
  readonly platformFee: MoneyDto;
  readonly total: MoneyDto;
  readonly deliveryMethod: DeliveryMethod;
  readonly meetingPoint?: MeetingPoint;
  readonly createdAt: IsoDateTime;
  readonly paidAt?: IsoDateTime;
  readonly completedAt?: IsoDateTime;
}

export interface MeetingPoint {
  readonly label: string;
  readonly point: Coordinates;
  readonly address?: string;
  readonly agreedAt: IsoDateTime;
}

export interface Review {
  readonly id: UUID;
  readonly orderId: UUID;
  readonly rating: number;
  readonly body?: string;
  readonly author: UserSummary;
  readonly subjectId: UUID;
  readonly createdAt: IsoDateTime;
}

export interface Conversation {
  readonly id: UUID;
  readonly context?: ConversationContext;
  readonly contextId?: UUID;
  readonly participants: UserSummary[];
  readonly listing?: ListingSummary;
  readonly lastMessage?: Message;
  readonly unreadCount: number;
  readonly updatedAt: IsoDateTime;
}

export interface Message {
  readonly id: UUID;
  readonly conversationId: UUID;
  readonly kind: MessageKind;
  readonly body?: string;
  readonly imageUrl?: string;
  readonly offerId?: UUID;
  readonly senderId: UUID;
  readonly createdAt: IsoDateTime;
  readonly readAt?: IsoDateTime;
}

export interface NotificationItem {
  readonly id: UUID;
  readonly type: NotificationType;
  readonly title: string;
  readonly body?: string;
  readonly imageUrl?: string;
  readonly deepLink?: string;
  readonly readAt?: IsoDateTime;
  readonly createdAt: IsoDateTime;
}

export interface FeedItem {
  readonly id: UUID;
  readonly type: FeedItemType;
  readonly actor?: UserSummary;
  readonly store?: StoreSummary;
  readonly listing?: ListingSummary;
  readonly headline: string;
  readonly createdAt: IsoDateTime;
}

export interface Promotion {
  readonly id: UUID;
  readonly kind: PromotionKind;
  readonly label: string;
  readonly basisPoints?: number;
  readonly fixedPrice?: MoneyDto;
  readonly couponCode?: string;
  readonly startsAt?: IsoDateTime;
  readonly endsAt?: IsoDateTime;
  readonly minimumQuantity?: number;
}

export interface Dispute {
  readonly id: UUID;
  readonly orderId: UUID;
  readonly status: DisputeStatus;
  readonly reason: string;
  readonly openedBy: UUID;
  readonly createdAt: IsoDateTime;
}

export interface Category {
  readonly id: UUID;
  readonly slug: string;
  readonly name: string;
  readonly parentId?: UUID;
  readonly icon?: string;
}

/** One marker on the map — either a cluster, a listing, or a store. */
export type MapMarker = ClusterMarker | ListingMarker | StoreMarker;

export interface ClusterMarker {
  readonly type: 'cluster';
  readonly id: string;
  readonly point: Coordinates;
  readonly count: number;
  /** Bounds the client should zoom to when the cluster is tapped. */
  readonly bounds: {
    readonly minLat: number;
    readonly minLng: number;
    readonly maxLat: number;
    readonly maxLng: number;
  };
}

export interface ListingMarker {
  readonly type: 'listing';
  readonly id: UUID;
  readonly point: Coordinates;
  readonly kind: ListingKind;
  readonly title: string;
  readonly thumbnailUrl?: string;
  readonly price?: MoneyDto;
  readonly maxBudget?: MoneyDto;
  readonly distanceMeters?: number;
  readonly auctionEndsAt?: IsoDateTime;
  readonly discountBasisPoints?: number;
  /** `friend` / `follower` badges shown on the marker. */
  readonly tier?: AudienceTier;
  readonly isPromoted: boolean;
}

export interface StoreMarker {
  readonly type: 'store';
  readonly id: UUID;
  readonly point: Coordinates;
  readonly name: string;
  readonly logoUrl?: string;
  readonly activeListingCount: number;
  readonly distanceMeters?: number;
  readonly hasActivePromotion: boolean;
}

export interface Paginated<T> {
  readonly items: T[];
  readonly nextCursor: string | null;
  readonly total?: number;
}
