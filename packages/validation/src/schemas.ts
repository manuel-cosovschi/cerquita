/**
 * Request schemas, grouped by the module that owns them.
 */

import { z } from 'zod';
import {
  basisPointsSchema,
  bboxSchema,
  coordinatesSchema,
  deliveryMethodSchema,
  emailSchema,
  itemConditionSchema,
  listingKindSchema,
  mapLayerSchema,
  moneySchema,
  paginationSchema,
  passwordSchema,
  positiveMoneySchema,
  radiusMetersSchema,
  searchSortSchema,
  storeHandleSchema,
  usernameSchema,
  uuidSchema,
} from './common.js';

/* ── auth ─────────────────────────────────────────────────────────────────── */

export const registerSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  username: usernameSchema,
  displayName: z.string().min(1).max(60),
});

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(200),
  deviceName: z.string().max(120).optional(),
});

export const refreshSchema = z.object({
  refreshToken: z.string().min(20).max(500),
});

export const requestPasswordResetSchema = z.object({ email: emailSchema });

export const resetPasswordSchema = z.object({
  token: z.string().min(20).max(500),
  password: passwordSchema,
});

/* ── profile & social ─────────────────────────────────────────────────────── */

export const updateProfileSchema = z.object({
  displayName: z.string().min(1).max(60).optional(),
  bio: z.string().max(500).optional(),
  area: z.string().max(120).optional(),
  avatarUrl: z.string().url().max(1000).optional(),
});

/**
 * Seller-wide discount defaults (spec §24). New listings inherit these.
 */
export const updateDiscountPolicySchema = z.object({
  followerBasisPoints: basisPointsSchema,
  friendBasisPoints: basisPointsSchema,
});

export const privacyPreferencesSchema = z.object({
  showSoldListings: z.boolean(),
  showFavorites: z.boolean(),
  showActivity: z.boolean(),
  showPurchases: z.boolean(),
});

/* ── listings ─────────────────────────────────────────────────────────────── */

const listingImageSchema = z.object({
  url: z.string().url().max(1000),
  width: z.number().int().positive().max(10_000),
  height: z.number().int().positive().max(10_000),
  position: z.number().int().min(0).max(50),
  alt: z.string().max(300).optional(),
});

const baseListingSchema = z.object({
  title: z.string().min(3).max(120),
  description: z.string().max(5000).default(''),
  categoryId: uuidSchema,
  tags: z.array(z.string().min(1).max(30)).max(15).default([]),
  images: z.array(listingImageSchema).max(12).default([]),
  /** Exact location. Stored privately; only a fuzzed point is ever served back. */
  location: coordinatesSchema,
  storeId: uuidSchema.optional(),
});

export const createSaleListingSchema = baseListingSchema.extend({
  kind: z.literal('sale'),
  price: positiveMoneySchema,
  condition: itemConditionSchema,
  quantity: z.number().int().min(1).max(10_000).default(1),
  deliveryMethods: z.array(deliveryMethodSchema).min(1),
  acceptsOffers: z.boolean().default(true),
  followerBasisPoints: basisPointsSchema.nullable().optional(),
  friendBasisPoints: basisPointsSchema.nullable().optional(),
  reservationMinutes: z.number().int().min(5).max(1440).optional(),
});

export const createWantedListingSchema = baseListingSchema.extend({
  kind: z.literal('wanted'),
  maxBudget: positiveMoneySchema.optional(),
  acceptedConditions: z.array(itemConditionSchema).optional(),
  wantedRadiusMeters: z.number().int().min(500).max(100_000).default(5000),
});

export const createAuctionListingSchema = baseListingSchema.extend({
  kind: z.literal('auction'),
  condition: itemConditionSchema,
  deliveryMethods: z.array(deliveryMethodSchema).min(1),
  startsAt: z.coerce.date().optional(),
  endsAt: z.coerce.date(),
  startingPrice: positiveMoneySchema,
  minimumIncrement: positiveMoneySchema,
  reservePrice: positiveMoneySchema.optional(),
  buyNowPrice: positiveMoneySchema.optional(),
});

export const createListingSchema = z.discriminatedUnion('kind', [
  createSaleListingSchema,
  createWantedListingSchema,
  createAuctionListingSchema,
]);

export const updateListingSchema = z.object({
  title: z.string().min(3).max(120).optional(),
  description: z.string().max(5000).optional(),
  categoryId: uuidSchema.optional(),
  tags: z.array(z.string().min(1).max(30)).max(15).optional(),
  price: positiveMoneySchema.optional(),
  /** Optional note recorded alongside a price change in the history. */
  priceChangeReason: z.string().max(200).optional(),
  condition: itemConditionSchema.optional(),
  quantity: z.number().int().min(0).max(10_000).optional(),
  deliveryMethods: z.array(deliveryMethodSchema).min(1).optional(),
  acceptsOffers: z.boolean().optional(),
  followerBasisPoints: basisPointsSchema.nullable().optional(),
  friendBasisPoints: basisPointsSchema.nullable().optional(),
  location: coordinatesSchema.optional(),
});

export const listingStatusActionSchema = z.object({
  status: z.enum(['active', 'paused', 'removed']),
});

/* ── map & search ─────────────────────────────────────────────────────────── */

/**
 * The viewport query behind the map (spec §129).
 *
 * `bbox` + `zoom` are required together: the server needs the zoom to decide
 * whether to answer with clusters or individual markers.
 */
export const mapQuerySchema = z.object({
  bbox: bboxSchema,
  zoom: z.coerce.number().min(0).max(22),
  layer: mapLayerSchema.default('all'),
  categoryIds: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .transform((value) =>
      value === undefined ? undefined : (Array.isArray(value) ? value : value.split(',')).filter(Boolean),
    ),
  minPrice: z.coerce.number().int().min(0).optional(),
  maxPrice: z.coerce.number().int().min(0).optional(),
  condition: itemConditionSchema.optional(),
  /** Restricts to listings from friends / followed sellers. */
  socialOnly: z.coerce.boolean().optional(),
  q: z.string().max(200).optional(),
});

export const searchQuerySchema = z
  .object({
    q: z.string().max(200).optional(),
    kind: listingKindSchema.optional(),
    categoryIds: z.array(uuidSchema).max(20).optional(),
    condition: z.array(itemConditionSchema).max(5).optional(),
    minPrice: z.number().int().min(0).optional(),
    maxPrice: z.number().int().min(0).optional(),
    center: coordinatesSchema.optional(),
    radiusMeters: radiusMetersSchema.optional(),
    bbox: bboxSchema.optional(),
    sellerId: uuidSchema.optional(),
    storeId: uuidSchema.optional(),
    sort: searchSortSchema.default('relevance'),
    publishedAfter: z.coerce.date().optional(),
  })
  .merge(paginationSchema)
  .refine(
    (value) =>
      value.minPrice === undefined ||
      value.maxPrice === undefined ||
      value.minPrice <= value.maxPrice,
    { message: 'El precio mínimo no puede superar al máximo', path: ['minPrice'] },
  );

/** Natural-language search (spec §19). The provider turns this into the shape above. */
export const aiSearchSchema = z.object({
  prompt: z.string().min(3).max(500),
  center: coordinatesSchema.optional(),
});

/* ── offers ───────────────────────────────────────────────────────────────── */

export const createOfferSchema = z.object({
  listingId: uuidSchema,
  amount: positiveMoneySchema,
  message: z.string().max(500).optional(),
  expiresInMinutes: z.number().int().min(15).max(10_080).optional(),
});

export const respondToOfferSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('accept') }),
  z.object({ action: z.literal('reject'), reason: z.string().max(300).optional() }),
  z.object({
    action: z.literal('counter'),
    amount: positiveMoneySchema,
    message: z.string().max(500).optional(),
    expiresInMinutes: z.number().int().min(15).max(10_080).optional(),
  }),
]);

/* ── auctions ─────────────────────────────────────────────────────────────── */

export const placeBidSchema = z.object({
  amount: positiveMoneySchema,
  /**
   * The minimum the client believed was required. The server rejects the bid if
   * this is stale, so a user never accidentally bids against a moved threshold.
   */
  expectedMinimum: moneySchema.optional(),
});

/* ── reservations, cart & checkout ────────────────────────────────────────── */

export const createReservationSchema = z.object({
  listingId: uuidSchema,
  variantId: uuidSchema.optional(),
  quantity: z.number().int().min(1).max(100).default(1),
});

export const addToCartSchema = z.object({
  listingId: uuidSchema,
  variantId: uuidSchema.optional(),
  quantity: z.number().int().min(1).max(100).default(1),
});

export const updateCartItemSchema = z.object({
  quantity: z.number().int().min(0).max(100),
});

export const checkoutSchema = z.object({
  cartId: uuidSchema,
  deliveryMethod: deliveryMethodSchema,
  couponCode: z.string().max(40).optional(),
  /** Set when the purchase is backed by an accepted offer. */
  offerId: uuidSchema.optional(),
  reservationId: uuidSchema.optional(),
  meetingPoint: z
    .object({ label: z.string().max(120), point: coordinatesSchema })
    .optional(),
  shippingAddressId: uuidSchema.optional(),
  /**
   * What the client displayed. Used ONLY to detect that the price moved between
   * render and submit — never as the amount charged (spec §41).
   */
  quotedTotal: moneySchema.optional(),
});

/* ── stores ───────────────────────────────────────────────────────────────── */

export const createStoreSchema = z.object({
  name: z.string().min(2).max(80),
  handle: storeHandleSchema,
  description: z.string().max(2000).optional(),
  categories: z.array(z.string().max(40)).max(10).default([]),
  hasPhysicalLocation: z.boolean().default(false),
  location: coordinatesSchema.optional(),
  address: z.string().max(300).optional(),
  deliveryMethods: z.array(deliveryMethodSchema).min(1),
});

export const updateStoreSchema = createStoreSchema.partial().omit({ handle: true });

export const addStoreMemberSchema = z.object({
  userId: uuidSchema,
  role: z.enum(['admin', 'manager', 'seller', 'support']),
});

/* ── product catalogue & variants (spec §16) ──────────────────────────────── */

export const createProductSchema = z.object({
  storeId: uuidSchema,
  title: z.string().min(2).max(160),
  description: z.string().max(5000).default(''),
  categoryId: uuidSchema,
  options: z
    .array(
      z.object({
        name: z.string().min(1).max(40),
        values: z.array(z.string().min(1).max(60)).min(1).max(50),
      }),
    )
    .max(3)
    .default([]),
  variants: z
    .array(
      z.object({
        sku: z.string().max(60).optional(),
        optionValues: z.array(z.string().max(60)).max(3),
        price: positiveMoneySchema,
        stock: z.number().int().min(0).max(1_000_000),
        imageUrl: z.string().url().max(1000).optional(),
      }),
    )
    .min(1)
    .max(200),
});

/* ── favorites, alerts, reports ───────────────────────────────────────────── */

export const createFavoriteSchema = z.object({
  listingId: uuidSchema.optional(),
  storeId: uuidSchema.optional(),
  collectionId: uuidSchema.optional(),
});

export const createCollectionSchema = z.object({
  name: z.string().min(1).max(60),
});

export const createSavedSearchSchema = z.object({
  name: z.string().min(1).max(80),
  text: z.string().max(200).optional(),
  categoryIds: z.array(uuidSchema).max(10).optional(),
  kinds: z.array(listingKindSchema).max(3).optional(),
  conditions: z.array(itemConditionSchema).max(5).optional(),
  minPrice: positiveMoneySchema.optional(),
  maxPrice: positiveMoneySchema.optional(),
  center: coordinatesSchema.optional(),
  radiusMeters: radiusMetersSchema.optional(),
  notify: z.boolean().default(true),
});

export const createReportSchema = z.object({
  targetType: z.enum(['listing', 'user', 'store', 'message', 'review']),
  targetId: uuidSchema,
  category: z.string().min(1).max(60),
  detail: z.string().max(1000).optional(),
});

/* ── chat ─────────────────────────────────────────────────────────────────── */

export const sendMessageSchema = z.object({
  body: z.string().max(2000).optional(),
  imageUrl: z.string().url().max(1000).optional(),
  meetingPoint: z
    .object({ label: z.string().max(120), point: coordinatesSchema })
    .optional(),
  /** Idempotency key so a retried send does not duplicate the message. */
  clientId: z.string().max(64).optional(),
}).refine(
  (value) => Boolean(value.body?.trim() || value.imageUrl || value.meetingPoint),
  { message: 'El mensaje no puede estar vacío' },
);

export const startConversationSchema = z.object({
  recipientId: uuidSchema,
  listingId: uuidSchema.optional(),
  firstMessage: z.string().max(2000).optional(),
});

/* ── reviews ──────────────────────────────────────────────────────────────── */

export const createReviewSchema = z.object({
  orderId: uuidSchema,
  rating: z.number().int().min(1).max(5),
  body: z.string().max(1000).optional(),
});

/* ── promotions ───────────────────────────────────────────────────────────── */

export const createPromotionSchema = z
  .object({
    storeId: uuidSchema.optional(),
    listingIds: z.array(uuidSchema).max(200).optional(),
    kind: z.enum([
      'percentage',
      'fixed_price',
      'follower_discount',
      'flash_sale',
      'second_unit',
      'minimum_quantity',
      'coupon',
    ]),
    label: z.string().min(1).max(80),
    basisPoints: basisPointsSchema.optional(),
    fixedPrice: positiveMoneySchema.optional(),
    couponCode: z.string().min(3).max(40).optional(),
    minimumQuantity: z.number().int().min(1).max(100).optional(),
    requiredTier: z.enum(['public', 'follower', 'friend']).default('public'),
    startsAt: z.coerce.date().optional(),
    endsAt: z.coerce.date().optional(),
    stacksWithSocialDiscount: z.boolean().default(false),
  })
  .refine((value) => value.basisPoints !== undefined || value.fixedPrice !== undefined, {
    message: 'Definí un porcentaje o un precio fijo',
  })
  .refine(
    (value) => !value.startsAt || !value.endsAt || value.startsAt < value.endsAt,
    { message: 'La promoción debe terminar después de empezar', path: ['endsAt'] },
  );

/* ── admin ────────────────────────────────────────────────────────────────── */

export const moderationActionSchema = z.object({
  action: z.enum(['remove_listing', 'restore_listing', 'warn_user', 'suspend_user', 'ban_user']),
  targetId: uuidSchema,
  /** Required: every admin action is written to the audit log with its reason. */
  reason: z.string().min(3).max(500),
  suspendUntil: z.coerce.date().optional(),
});

export const resolveDisputeSchema = z.object({
  resolution: z.enum(['resolved_buyer', 'resolved_seller', 'partial', 'closed']),
  refundAmount: moneySchema.optional(),
  reason: z.string().min(3).max(1000),
});

export const updateGlobalConfigSchema = z.object({
  platformFeeBasisPoints: basisPointsSchema.optional(),
  maxSearchRadiusMeters: z.number().int().min(1000).max(500_000).optional(),
  defaultReservationMinutes: z.number().int().min(5).max(1440).optional(),
  maxAuctionDurationDays: z.number().int().min(1).max(90).optional(),
  featureFlags: z.record(z.string(), z.boolean()).optional(),
});

export type CreateListingInput = z.infer<typeof createListingSchema>;
export type MapQueryInput = z.infer<typeof mapQuerySchema>;
export type SearchQueryInput = z.infer<typeof searchQuerySchema>;
export type CheckoutInput = z.infer<typeof checkoutSchema>;
export type PlaceBidInput = z.infer<typeof placeBidSchema>;
export type CreateOfferInput = z.infer<typeof createOfferSchema>;
export type CreatePromotionInput = z.infer<typeof createPromotionSchema>;
