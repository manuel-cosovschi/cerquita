/**
 * Typed API client shared by web, admin and mobile (spec §86).
 *
 * One definition per endpoint, consumed by every client, so a change to a
 * response shape becomes a compile error in all three apps rather than a runtime
 * surprise in one of them.
 */

import type {
  Cart,
  Conversation,
  Listing,
  ListingSummary,
  MapMarker,
  Message,
  NotificationItem,
  Order,
  Paginated,
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
    if (rest.body && !headers.has('content-type')) {
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
      submit: (body: unknown) => post<{ order: Order; checkoutUrl?: string }>('/checkout', body),
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
      products: (storeId: string) => request<ListingSummary[]>(`/stores/${storeId}/products`),
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

    chat: {
      conversations: () => request<Conversation[]>('/conversations'),
      conversation: (id: string) => request<Conversation>(`/conversations/${id}`),
      /** Opens or reuses the thread for a listing — never creates a duplicate. */
      open: (body: { participantId: string; listingId?: string }) =>
        post<Conversation>('/conversations', body),
      messages: (id: string, cursor?: string) =>
        request<Paginated<Message>>(`/conversations/${id}/messages`, { query: { cursor } }),
      send: (id: string, body: string) => post<Message>(`/conversations/${id}/messages`, { body }),
      markRead: (id: string) => post<unknown>(`/conversations/${id}/read`, {}),
    },

    notifications: {
      list: (cursor?: string) =>
        request<Paginated<NotificationItem>>('/notifications', { query: { cursor } }),
      unreadCount: () => request<{ count: number }>('/notifications/unread-count'),
      markRead: (id: string) => post<unknown>(`/notifications/${id}/read`, {}),
      markAllRead: () => post<unknown>('/notifications/read-all', {}),
    },

    social: {
      follow: (userId: string) => post<unknown>(`/users/${userId}/follow`, {}),
      unfollow: (userId: string) => request(`/users/${userId}/follow`, { method: 'DELETE' }),
      requestFriendship: (userId: string) => post<unknown>(`/users/${userId}/friend-request`, {}),
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
