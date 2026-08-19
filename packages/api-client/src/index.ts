/**
 * Typed API client shared by web, admin and mobile (spec §86).
 *
 * One definition per endpoint, consumed by every client, so a change to a
 * response shape becomes a compile error in all three apps rather than a runtime
 * surprise in one of them.
 */

import type {
  Cart,
  Category,
  Conversation,
  FeedItem,
  Listing,
  ListingSummary,
  MapMarker,
  Message,
  MoneyDto,
  NotificationItem,
  Offer,
  Order,
  Paginated,
  Promotion,
  Store,
  UserProfile,
} from '@cerquita/types';

export interface ApiErrorBody {
  message: string;
  code?: string;
  issues?: Array<{ field: string; message: string }>;
  requestId?: string;
  [key: string]: unknown;
}

/**
 * Carries the server's structured error through to the UI, so a screen can show
 * the actionable message the API wrote instead of inventing its own (spec §104).
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: ApiErrorBody,
  ) {
    super(body.message || `Request failed with ${status}`);
    this.name = 'ApiError';
  }

  get code(): string | undefined {
    return this.body.code;
  }

  /** True when retrying could plausibly succeed (conflict, rate limit, 5xx). */
  get isRetryable(): boolean {
    return this.status === 409 || this.status === 429 || this.status >= 500;
  }
}

export interface ClientOptions {
  baseUrl: string;
  /** Resolved per request so a refreshed token is picked up without re-creating the client. */
  getAccessToken?: () => string | undefined | Promise<string | undefined>;
  fetchImpl?: typeof fetch;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface MapQuery {
  bbox: string;
  zoom: number;
  layer?: string;
  q?: string;
  categoryIds?: string[];
  minPrice?: number;
  maxPrice?: number;
  socialOnly?: boolean;
  viewerLat?: number;
  viewerLng?: number;
}

export interface MapResponse {
  markers: MapMarker[];
  clustered: boolean;
  truncated: boolean;
}

export interface PersonResult {
  id: string;
  username: string;
  displayName: string;
  avatarUrl?: string;
  verified: boolean;
  rating?: number;
  reviewCount: number;
  area?: string;
  salesCount: number;
  /** "Amigo de Nacho" — resolved per viewer, null when there is no connection. */
  socialProof: string | null;
}

export interface StoreResult {
  id: string;
  handle: string;
  name: string;
  logoUrl?: string;
  verified: boolean;
  rating?: number;
  followerCount: number;
  activeListingCount: number;
  address?: string;
  isFollowedByViewer: boolean;
}

export interface SocialHint {
  count: number;
  people: Array<{ id: string; displayName: string }>;
  label: string;
}

export interface ListingComment {
  id: string;
  body: string;
  author: {
    id: string;
    username: string;
    displayName: string;
    avatarUrl?: string;
    verified: boolean;
  };
  socialProof: string | null;
  createdAt: string;
  replies?: ListingComment[];
}

/**
 * What the owner of an account can see and change about it.
 *
 * Discounts stay in basis points on the wire. A percentage rounded for display
 * and posted back would drift the seller's own pricing policy a little every
 * time the screen is opened.
 */
export interface UserSettings {
  discounts: { followerBasisPoints: number; friendBasisPoints: number };
  privacy: {
    showSoldListings: boolean;
    showFavorites: boolean;
    showActivity: boolean;
    showPurchases: boolean;
  };
}

/** The tabs a profile splits its listings into (spec §21). */
export type ProfileTab = 'selling' | 'wanted' | 'auctions' | 'sold';

export interface ProfileReview {
  id: string;
  rating: number;
  body?: string;
  author: { id: string; username: string; displayName: string; avatarUrl?: string };
  createdAt: string;
}

/** A friend request the viewer can accept or reject. */
export interface FriendRequest {
  id: string;
  from: {
    id: string;
    username: string;
    displayName: string;
    avatarUrl?: string;
    verified: boolean;
  };
  createdAt: string;
}

/* ── admin ────────────────────────────────────────────────────────────────── */

export interface AdminDashboard {
  users: { total: number; newLast30Days: number; suspended: number };
  listings: { active: number; sold: number; removed: number };
  commerce: {
    orders: number;
    gmv: MoneyDto;
    fees: MoneyDto;
    averageTicket: MoneyDto;
  };
  queue: { openReports: number; openDisputes: number; liveAuctions: number };
}

export interface AdminReport {
  id: string;
  targetType: 'listing' | 'user' | 'store' | 'message' | 'review';
  targetId: string;
  category: string;
  detail?: string | null;
  status: string;
  createdAt: string;
  reporter: { id: string; username: string };
}

export interface AdminDispute {
  id: string;
  orderId: string;
  status: string;
  reason: string;
  openedBy: string;
  createdAt: string;
  order?: { reference: string; total: number; currency: MoneyDto['currency'] };
  evidence?: Array<{ id: string; url: string; note?: string | null }>;
}

export interface AuditEntry {
  id: string;
  action: string;
  targetType: string;
  targetId: string;
  reason: string;
  createdAt: string;
  admin: { username: string };
}

/** The moderation actions an admin can take. `reason` goes into the audit log. */
export type ModerationAction =
  'remove_listing' | 'restore_listing' | 'warn_user' | 'suspend_user' | 'ban_user';

/** A saved search, optionally notifying when something new matches. */
export interface SavedSearch {
  id: string;
  name: string;
  text?: string | null;
  minPrice?: number | null;
  maxPrice?: number | null;
  radiusMeters?: number | null;
  notify: boolean;
  createdAt: string;
}

/** What a store's own dashboard reports (spec §50). */
export interface StoreDashboard {
  orders: number;
  revenue: MoneyDto;
  buyers: number;
  averageTicket: MoneyDto;
  activeListings: number;
  soldListings: number;
  views: number;
  favorites: number;
  followers: number;
  /** Views to orders, as a percentage. Null when there are no views to divide by. */
  conversionRate: number | null;
}

/** Aggregate demand around a point (spec §51). */
export interface LocalDemand {
  radiusMeters: number;
  categories: Array<{
    categoryId: string;
    name: string;
    wantedCount: number;
    supplyCount: number;
    /** Wanted per active listing. Null when there is no supply to divide by. */
    ratio: number | null;
  }>;
  terms: Array<{ term: string; count: number }>;
  wantedTotal: number;
}

export interface SearchQuery {
  q?: string;
  kind?: 'sale' | 'wanted' | 'auction';
  categoryIds?: string[];
  condition?: string[];
  minPrice?: number;
  maxPrice?: number;
  center?: { lat: number; lng: number };
  radiusMeters?: number;
  bbox?: string;
  sellerId?: string;
  storeId?: string;
  sort?: 'relevance' | 'distance' | 'price_asc' | 'price_desc' | 'newest' | 'ending_soon';
  cursor?: string;
  limit?: number;
}

export function createClient(options: ClientOptions) {
  const doFetch = options.fetchImpl ?? globalThis.fetch;
  const baseUrl = options.baseUrl.replace(/\/$/, '');

  async function request<T>(
    path: string,
    init: RequestInit & { query?: Record<string, unknown> } = {},
  ): Promise<T> {
    const { query, ...rest } = init;
    const url = new URL(`${baseUrl}${path}`);

    for (const [key, value] of Object.entries(query ?? {})) {
      if (value === undefined || value === null) continue;
      url.searchParams.set(key, Array.isArray(value) ? value.join(',') : String(value));
    }

    const headers = new Headers(rest.headers);
    // FormData must set its own content type: the multipart boundary is
    // generated by the browser, and a hand-written header omits it, which makes
    // the body unparseable on the server.
    if (rest.body && !headers.has('content-type') && !(rest.body instanceof FormData)) {
      headers.set('content-type', 'application/json');
    }

    const token = await options.getAccessToken?.();
    if (token) headers.set('authorization', `Bearer ${token}`);

    const response = await doFetch(url.toString(), { ...rest, headers });

    if (response.status === 204) return undefined as T;

    const text = await response.text();
    const parsed: unknown = text ? safeJsonParse(text) : undefined;

    if (!response.ok) {
      throw new ApiError(
        response.status,
        (parsed as ApiErrorBody | undefined) ?? { message: text || 'Error de red' },
      );
    }

    return parsed as T;
  }

  const post = <T>(path: string, body: unknown) =>
    request<T>(path, { method: 'POST', body: JSON.stringify(body) });

  return {
    request,

    auth: {
      register: (body: {
        email: string;
        password: string;
        username: string;
        displayName: string;
      }) => post<AuthTokens>('/auth/register', body),

      login: (body: { email: string; password: string; deviceName?: string }) =>
        post<AuthTokens>('/auth/login', body),

      refresh: (refreshToken: string) => post<AuthTokens>('/auth/refresh', { refreshToken }),

      logout: (refreshToken: string) =>
        request<void>('/auth/logout', {
          method: 'POST',
          body: JSON.stringify({ refreshToken }),
        }),

      me: () => request<{ userId: string; username: string }>('/auth/me'),
    },

    map: {
      /** One request per viewport, never one per marker (spec §129). */
      query: (query: MapQuery) => request<MapResponse>('/map/listings', { query: { ...query } }),
    },

    categories: {
      /** The whole tree in one call — it is a few dozen rows. */
      list: () => request<Category[]>('/categories'),
    },

    demand: {
      /**
       * What people nearby are asking for (spec §51). Aggregate only: counts
       * per category and repeated words, never who asked.
       */
      near: (query: { lat: number; lng: number; radius?: number }) =>
        request<LocalDemand>('/demand', { query: { ...query } }),
    },

    feed: {
      /**
       * Position is optional: without it the feed is the social one only, with
       * no "cerca tuyo" rows. Sending a coordinate is the viewer's choice.
       */
      list: (query: { lat?: number; lng?: number; limit?: number } = {}) =>
        request<FeedItem[]>('/feed', { query: { ...query } }),
    },

    uploads: {
      /**
       * Multipart, so `Content-Type` is left unset: the browser has to add the
       * multipart boundary itself, and setting the header by hand omits it.
       * Dimensions come back from the server, which reads them out of the file.
       */
      image: (file: Blob) => {
        const form = new FormData();
        form.append('file', file);
        return request<{ url: string; width: number; height: number }>('/uploads/images', {
          method: 'POST',
          body: form,
        });
      },
    },

    listings: {
      get: (id: string) => request<Listing>(`/listings/${id}`),
      create: (body: unknown) => post<Listing>('/listings', body),
      update: (id: string, body: unknown) =>
        request<Listing>(`/listings/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
      setStatus: (id: string, status: 'active' | 'paused' | 'removed') =>
        request<{ status: string }>(`/listings/${id}/status`, {
          method: 'PATCH',
          body: JSON.stringify({ status }),
        }),
    },

    search: {
      query: (body: SearchQuery) => post<Paginated<ListingSummary>>('/search', body),

      /** The People tab (spec §18, direction 1c). */
      people: (q: string) => post<PersonResult[]>('/search/people', { q }),

      /** The Stores tab. */
      stores: (q: string) => post<StoreResult[]>('/search/stores', { q }),

      /** "2 personas que seguís tienen algo publicado". Null when there is none. */
      socialHint: (q: string) => post<SocialHint | null>('/search/social-hint', { q }),
      ai: (prompt: string, center?: { lat: number; lng: number }) =>
        post<Paginated<ListingSummary> & { interpreted: Record<string, unknown> }>('/search/ai', {
          prompt,
          center,
        }),
    },

    comments: {
      list: (listingId: string) => request<ListingComment[]>(`/listings/${listingId}/comments`),
      create: (listingId: string, body: string, parentId?: string) =>
        post<ListingComment>(`/listings/${listingId}/comments`, { body, parentId }),
      hide: (commentId: string) => request(`/comments/${commentId}`, { method: 'DELETE' }),
    },

    offers: {
      /** Everything the viewer is a party to, both directions. */
      list: () => request<Offer[]>('/offers'),
      create: (body: {
        listingId: string;
        amount: { amount: number; currency: string };
        message?: string;
        expiresInMinutes?: number;
      }) => post<unknown>('/offers', body),
      respond: (id: string, body: unknown) => post<unknown>(`/offers/${id}/respond`, body),
      cancel: (id: string) => request<unknown>(`/offers/${id}`, { method: 'DELETE' }),
    },

    auctions: {
      bid: (
        auctionId: string,
        amount: { amount: number; currency: string },
        expectedMinimum?: { amount: number; currency: string },
      ) => post<unknown>(`/auctions/${auctionId}/bids`, { amount, expectedMinimum }),
      buyNow: (auctionId: string) => post<unknown>(`/auctions/${auctionId}/buy-now`, {}),
    },

    cart: {
      list: () => request<Cart[]>('/cart'),
      add: (body: { listingId: string; variantId?: string; quantity?: number }) =>
        post<Cart>('/cart/items', body),
      setQuantity: (itemId: string, quantity: number) =>
        request<{ ok: true }>(`/cart/items/${itemId}`, {
          method: 'PATCH',
          body: JSON.stringify({ quantity }),
        }),
      remove: (itemId: string) =>
        request<{ ok: true }>(`/cart/items/${itemId}`, { method: 'DELETE' }),
    },

    checkout: {
      /**
       * `quotedTotal` is what the buyer was shown. The server compares it and
       * refuses if the price moved in between — it is a tripwire, never the
       * amount charged (spec §41).
       */
      submit: (body: {
        cartId: string;
        deliveryMethod: string;
        couponCode?: string;
        offerId?: string;
        reservationId?: string;
        quotedTotal?: { amount: number; currency: string };
      }) => post<{ order: Order; checkoutUrl?: string }>('/checkout', body),
      order: (id: string) => request<Order>(`/orders/${id}`),
    },

    users: {
      profile: (username: string) => request<UserProfile>(`/users/${username}`),
      settings: () => request<UserSettings>('/users/me/settings'),
      listings: (username: string, tab: ProfileTab = 'selling') =>
        request<ListingSummary[]>(`/users/${username}/listings`, { query: { tab } }),
      reviews: (username: string, cursor?: string) =>
        request<Paginated<ProfileReview>>(`/users/${username}/reviews`, { query: { cursor } }),
      updateProfile: (body: { displayName?: string; bio?: string; avatarUrl?: string }) =>
        request<UserProfile>('/users/me/profile', { method: 'PATCH', body: JSON.stringify(body) }),
      /** The seller's own social pricing policy (spec §30). */
      updateDiscounts: (body: { followerBasisPoints: number; friendBasisPoints: number }) =>
        request<unknown>('/users/me/discounts', { method: 'PATCH', body: JSON.stringify(body) }),
      updatePrivacy: (body: UserSettings['privacy']) =>
        request<unknown>('/users/me/privacy', { method: 'PATCH', body: JSON.stringify(body) }),
    },

    stores: {
      get: (handle: string) => request<Store>(`/stores/${handle}`),
      create: (body: {
        name: string;
        handle: string;
        description?: string;
        categories?: string[];
        hasPhysicalLocation: boolean;
        location?: { lat: number; lng: number };
        address?: string;
        deliveryMethods: string[];
      }) => post<Store>('/stores', body),
      update: (storeId: string, body: Record<string, unknown>) =>
        request<Store>(`/stores/${storeId}`, { method: 'PATCH', body: JSON.stringify(body) }),
      dashboard: (storeId: string) => request<StoreDashboard>(`/stores/${storeId}/dashboard`),
      setHours: (
        storeId: string,
        hours: Array<{ weekday: number; opensAt: number; closesAt: number }>,
      ) => post<unknown>(`/stores/${storeId}/hours`, { hours }),

      promotions: (storeId: string) => request<Promotion[]>(`/stores/${storeId}/promotions`),
      createPromotion: (storeId: string, body: Record<string, unknown>) =>
        post<Promotion>(`/stores/${storeId}/promotions`, body),
      /** Ends it rather than deleting: orders reference what they were charged. */
      endPromotion: (storeId: string, promotionId: string) =>
        request<unknown>(`/stores/${storeId}/promotions/${promotionId}`, { method: 'DELETE' }),
      /**
       * A storefront's listings come from search rather than /products: search
       * resolves prices for the viewer, and `/stores/:id/products` returns
       * catalogue entries, which are a different thing (spec §15).
       */
      listings: (storeId: string, cursor?: string) =>
        post<Paginated<ListingSummary>>('/search', { storeId, sort: 'newest', cursor, limit: 24 }),
      follow: (storeId: string) => post<unknown>(`/stores/${storeId}/follow`, {}),
      unfollow: (storeId: string) =>
        request<unknown>(`/stores/${storeId}/follow`, { method: 'DELETE' }),
    },

    favorites: {
      list: (cursor?: string) =>
        request<Paginated<ListingSummary>>('/favorites', { query: { cursor } }),
      add: (listingId: string, collectionId?: string) =>
        post<unknown>('/favorites', { listingId, collectionId }),
      remove: (listingId: string) =>
        request<unknown>(`/favorites/listing/${listingId}`, { method: 'DELETE' }),
      collections: () => request<Array<{ id: string; name: string }>>('/collections'),
      createCollection: (name: string) =>
        post<{ id: string; name: string }>('/collections', { name }),
    },

    alerts: {
      /**
       * Saved searches double as alerts when `notify` is set (spec §32): the
       * matching engine re-runs them when something new is published nearby.
       */
      list: () => request<SavedSearch[]>('/saved-searches'),
      create: (body: {
        name: string;
        text?: string;
        kinds?: Array<'sale' | 'wanted' | 'auction'>;
        minPrice?: { amount: number; currency: string };
        maxPrice?: { amount: number; currency: string };
        center?: { lat: number; lng: number };
        radiusMeters?: number;
        notify: boolean;
      }) => post<{ id: string }>('/saved-searches', body),
      remove: (id: string) => request<unknown>(`/saved-searches/${id}`, { method: 'DELETE' }),
    },

    reviews: {
      /** Orders the viewer can still review — drives the "calificá" prompt. */
      pending: () => request<Array<{ orderId: string; reference: string }>>('/reviews/pending'),
      create: (body: { orderId: string; rating: number; body?: string }) =>
        post<unknown>('/reviews', body),
    },

    chat: {
      conversations: () => request<Conversation[]>('/conversations'),
      conversation: (id: string) => request<Conversation>(`/conversations/${id}`),
      /** Opens or reuses the thread for a listing — never creates a duplicate. */
      open: (body: { recipientId: string; listingId?: string; firstMessage?: string }) =>
        post<Conversation>('/conversations', body),
      messages: (id: string, cursor?: string) =>
        request<Paginated<Message>>(`/conversations/${id}/messages`, { query: { cursor } }),
      /**
       * `clientId` is an idempotency key: a retried send after a flaky
       * connection resolves to the same message instead of posting it twice.
       */
      send: (id: string, body: string, clientId?: string) =>
        post<Message>(`/conversations/${id}/messages`, { body, clientId }),
      markRead: (id: string) => post<unknown>(`/conversations/${id}/read`, {}),
    },

    notifications: {
      list: (cursor?: string) =>
        request<Paginated<NotificationItem>>('/notifications', { query: { cursor } }),
      unreadCount: () => request<{ count: number }>('/notifications/unread-count'),
      markRead: (id: string) => post<unknown>(`/notifications/${id}/read`, {}),
      markAllRead: () => post<unknown>('/notifications/read-all', {}),
    },

    admin: {
      dashboard: () => request<AdminDashboard>('/admin/dashboard'),
      reports: (status = 'open') => request<AdminReport[]>('/admin/reports', { query: { status } }),
      resolveReport: (id: string, resolution: 'actioned' | 'dismissed') =>
        post<unknown>(`/admin/reports/${id}/resolve`, { resolution }),
      /**
       * `reason` is required by the API, not optional politeness: the action and
       * its audit entry are written in one transaction, so there is no path that
       * suspends somebody without recording why.
       */
      moderate: (body: {
        action: ModerationAction;
        targetId: string;
        reason: string;
        durationHours?: number;
      }) => post<unknown>('/admin/moderate', body),
      disputes: () => request<AdminDispute[]>('/admin/disputes'),
      resolveDispute: (id: string, body: Record<string, unknown>) =>
        post<unknown>(`/admin/disputes/${id}/resolve`, body),
      auditLog: (targetId?: string) =>
        request<AuditEntry[]>('/admin/audit-log', { query: { targetId } }),
      flags: () => request<Record<string, boolean>>('/admin/config/flags'),
      updateConfig: (body: Record<string, unknown>) =>
        request<unknown>('/admin/config', { method: 'PATCH', body: JSON.stringify(body) }),
    },

    social: {
      follow: (userId: string) => post<unknown>(`/users/${userId}/follow`, {}),
      unfollow: (userId: string) => request(`/users/${userId}/follow`, { method: 'DELETE' }),
      requestFriendship: (userId: string) => post<unknown>(`/users/${userId}/friend-request`, {}),
      /** Requests waiting on the viewer — never their own outgoing ones. */
      pendingFriendRequests: () => request<FriendRequest[]>('/friendships/pending'),
      respondToFriendship: (id: string, decision: 'accepted' | 'rejected') =>
        post<unknown>(`/friendships/${id}/respond`, { decision }),
      block: (userId: string) => post<unknown>(`/users/${userId}/block`, {}),
      followStore: (storeId: string) => post<unknown>(`/stores/${storeId}/follow`, {}),
    },
  };
}

export type CerquitaClient = ReturnType<typeof createClient>;

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return { message: text };
  }
}
