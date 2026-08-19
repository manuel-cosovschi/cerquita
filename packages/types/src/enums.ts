/**
 * Domain enumerations.
 *
 * These are the single source of truth for every status string in the product.
 * The Prisma schema mirrors them, the Zod schemas validate against them, and the
 * clients render them. Adding a state means touching this file first.
 */

export const LISTING_KINDS = ['sale', 'wanted', 'auction'] as const;
export type ListingKind = (typeof LISTING_KINDS)[number];

export const LISTING_STATUSES = [
  'draft',
  'active',
  'reserved',
  'sold',
  'paused',
  'expired',
  'removed',
] as const;
export type ListingStatus = (typeof LISTING_STATUSES)[number];

export const ITEM_CONDITIONS = ['new', 'like_new', 'good', 'fair', 'for_parts'] as const;
export type ItemCondition = (typeof ITEM_CONDITIONS)[number];

export const DELIVERY_METHODS = [
  /** Buyer picks up at a location the seller controls. */
  'pickup',
  /** Both parties agree on a public meeting point. */
  'meetup',
  /** Store-operated delivery. */
  'store_delivery',
  /** Third-party shipping. */
  'shipping',
] as const;
export type DeliveryMethod = (typeof DELIVERY_METHODS)[number];

export const OFFER_STATUSES = [
  'pending',
  'accepted',
  'rejected',
  'countered',
  'expired',
  'cancelled',
  'completed',
] as const;
export type OfferStatus = (typeof OFFER_STATUSES)[number];

export const AUCTION_STATUSES = ['scheduled', 'live', 'ended', 'cancelled'] as const;
export type AuctionStatus = (typeof AUCTION_STATUSES)[number];

export const ORDER_STATUSES = [
  'pending_payment',
  'paid',
  'preparing',
  'ready_for_pickup',
  'shipped',
  'delivered',
  'completed',
  'cancelled',
  'refunded',
  'disputed',
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const PAYMENT_STATUSES = [
  'pending',
  'authorized',
  'captured',
  'failed',
  'refunded',
  'partially_refunded',
  'cancelled',
] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const RESERVATION_STATUSES = ['active', 'consumed', 'released', 'expired'] as const;
export type ReservationStatus = (typeof RESERVATION_STATUSES)[number];

export const FRIENDSHIP_STATUSES = ['pending', 'accepted', 'rejected', 'blocked'] as const;
export type FriendshipStatus = (typeof FRIENDSHIP_STATUSES)[number];

/**
 * The viewer's relationship to a seller. Drives which social price applies.
 * Order matters: later entries are strictly more privileged (see domain/pricing).
 */
export const AUDIENCE_TIERS = ['public', 'follower', 'friend'] as const;
export type AudienceTier = (typeof AUDIENCE_TIERS)[number];

export const STORE_ROLES = ['owner', 'admin', 'manager', 'seller', 'support'] as const;
export type StoreRole = (typeof STORE_ROLES)[number];

export const ADMIN_ROLES = ['super_admin', 'admin', 'moderator', 'support', 'finance'] as const;
export type AdminRole = (typeof ADMIN_ROLES)[number];

export const PROMOTION_KINDS = [
  'percentage',
  'fixed_price',
  'follower_discount',
  'flash_sale',
  'second_unit',
  'minimum_quantity',
  'coupon',
] as const;
export type PromotionKind = (typeof PROMOTION_KINDS)[number];

export const DISPUTE_STATUSES = [
  'opened',
  'under_review',
  'resolved_buyer',
  'resolved_seller',
  'partial',
  'closed',
] as const;
export type DisputeStatus = (typeof DISPUTE_STATUSES)[number];

export const REPORT_TARGET_TYPES = ['listing', 'user', 'store', 'message', 'review'] as const;
export type ReportTargetType = (typeof REPORT_TARGET_TYPES)[number];

export const REPORT_STATUSES = ['open', 'reviewing', 'actioned', 'dismissed'] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];

export const NOTIFICATION_TYPES = [
  'message',
  'offer',
  'counteroffer',
  'offer_accepted',
  'sale',
  'purchase',
  'friend_request',
  'friend_accepted',
  'new_follower',
  'price_drop',
  'auction_starting',
  'auction_ending',
  'outbid',
  'auction_won',
  'store_promotion',
  'saved_search_match',
  'wanted_match',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export const FEED_ITEM_TYPES = [
  'new_listing',
  'new_auction',
  'wanted_listing',
  'store_promotion',
  'price_drop',
  'friend_activity',
  'recommended_listing',
] as const;
export type FeedItemType = (typeof FEED_ITEM_TYPES)[number];

/** Quick map filters (spec §12). */
export const MAP_LAYERS = [
  'all',
  'sales',
  'wanted',
  'auctions',
  'stores',
  'friends',
  'following',
  'near_me',
  'now',
] as const;
export type MapLayer = (typeof MAP_LAYERS)[number];

export const SUBSCRIPTION_PLANS = ['free', 'pro', 'business'] as const;
export type SubscriptionPlan = (typeof SUBSCRIPTION_PLANS)[number];

export const CONVERSATION_CONTEXTS = ['listing', 'order', 'auction', 'store'] as const;
export type ConversationContext = (typeof CONVERSATION_CONTEXTS)[number];

export const MESSAGE_KINDS = [
  'text',
  'image',
  'offer',
  'counteroffer',
  'offer_accepted',
  'reservation',
  'meeting_point',
  'system',
] as const;
export type MessageKind = (typeof MESSAGE_KINDS)[number];

export const SEARCH_SORTS = [
  'relevance',
  'distance',
  'price_asc',
  'price_desc',
  'newest',
  'ending_soon',
] as const;
export type SearchSort = (typeof SEARCH_SORTS)[number];
