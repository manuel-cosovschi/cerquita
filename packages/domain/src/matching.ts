/**
 * Saved-search and "Busco" matching (spec §17, §32).
 *
 * Both features ask the same question from opposite directions:
 *  - saved search: "does this NEW listing match a query someone saved?"
 *  - wanted match: "does this new listing satisfy someone's Busco post?"
 *
 * Matching runs as a background job on `ListingCreated` / `ListingPriceChanged`
 * rather than on read, so a user with an alert is notified once, promptly.
 */

import type { ItemCondition, ListingKind, UUID } from '@cerquita/types';
import { distanceMeters, isLessThan, type Coordinates, type Money } from '@cerquita/utils';

export interface SavedSearchCriteria {
  readonly id: UUID;
  readonly ownerId: UUID;
  readonly text?: string;
  readonly categoryIds?: readonly UUID[];
  readonly kinds?: readonly ListingKind[];
  readonly conditions?: readonly ItemCondition[];
  readonly maxPrice?: Money;
  readonly minPrice?: Money;
  readonly center?: Coordinates;
  readonly radiusMeters?: number;
}

export interface MatchableListing {
  readonly id: UUID;
  readonly sellerId: UUID;
  readonly kind: ListingKind;
  readonly title: string;
  readonly description: string;
  readonly tags: readonly string[];
  readonly categoryId: UUID;
  readonly condition?: ItemCondition;
  readonly price?: Money;
  /** Exact location — matching runs server-side, where exact coordinates are allowed. */
  readonly location: Coordinates;
}

/**
 * Normalises text for comparison: lowercase, accent-stripped.
 * "PS5" and "ps5" match; "bicicleta" matches "Bicicleta".
 */
export function normalizeForMatch(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

/**
 * Every whitespace-separated term must appear somewhere in the listing's
 * searchable text. AND rather than OR, because "mountain bike" should not match
 * every listing containing the word "bike".
 */
export function textMatches(query: string, listing: MatchableListing): boolean {
  const terms = normalizeForMatch(query).split(/\s+/).filter(Boolean);
  if (terms.length === 0) return true;

  const haystack = normalizeForMatch(
    [listing.title, listing.description, ...listing.tags].join(' '),
  );
  return terms.every((term) => haystack.includes(term));
}

export function matchesSavedSearch(
  criteria: SavedSearchCriteria,
  listing: MatchableListing,
): boolean {
  // Never alert someone about their own listing.
  if (criteria.ownerId === listing.sellerId) return false;

  if (criteria.kinds?.length && !criteria.kinds.includes(listing.kind)) return false;
  if (criteria.categoryIds?.length && !criteria.categoryIds.includes(listing.categoryId)) {
    return false;
  }
  if (criteria.conditions?.length) {
    if (!listing.condition || !criteria.conditions.includes(listing.condition)) return false;
  }

  if (criteria.maxPrice) {
    if (!listing.price) return false;
    if (listing.price.currency !== criteria.maxPrice.currency) return false;
    if (listing.price.amount > criteria.maxPrice.amount) return false;
  }
  if (criteria.minPrice) {
    if (!listing.price) return false;
    if (listing.price.currency !== criteria.minPrice.currency) return false;
    if (listing.price.amount < criteria.minPrice.amount) return false;
  }

  if (criteria.center && criteria.radiusMeters !== undefined) {
    if (distanceMeters(criteria.center, listing.location) > criteria.radiusMeters) return false;
  }

  if (criteria.text && !textMatches(criteria.text, listing)) return false;

  return true;
}

export interface WantedPost {
  readonly id: UUID;
  readonly ownerId: UUID;
  readonly title: string;
  readonly categoryId: UUID;
  readonly maxBudget?: Money;
  readonly acceptedConditions?: readonly ItemCondition[];
  readonly center: Coordinates;
  readonly radiusMeters: number;
}

/**
 * Words that frame a "Busco" post rather than describe the item.
 *
 * A post titled "Busco PlayStation 5" is looking for a PlayStation, not for a
 * listing that contains the word "busco". Since `textMatches` requires every
 * term to appear, leaving these in means a wanted post can never match anything.
 */
const WANTED_FRAMING_WORDS = new Set([
  'busco',
  'buscando',
  'necesito',
  'quiero',
  'compro',
  'wtb',
  'se',
  'me',
  'urgente',
]);

/**
 * The searchable part of a wanted post's title.
 *
 * Exported so callers can show the user what is actually being matched on.
 */
export function wantedSearchText(title: string): string {
  const terms = normalizeForMatch(title)
    .split(/\s+/)
    .filter((term) => term.length > 0 && !WANTED_FRAMING_WORDS.has(term));

  // If the title was nothing but framing, fall back to the original rather than
  // matching everything.
  return terms.length > 0 ? terms.join(' ') : title;
}

/**
 * Whether a new sale listing satisfies a Busco post, so the wanted poster can be
 * told "alguien publicó lo que buscás".
 */
export function matchesWantedPost(wanted: WantedPost, listing: MatchableListing): boolean {
  if (listing.kind !== 'sale' && listing.kind !== 'auction') return false;
  if (wanted.ownerId === listing.sellerId) return false;
  if (wanted.categoryId !== listing.categoryId) return false;

  if (wanted.maxBudget) {
    if (!listing.price) return false;
    if (listing.price.currency !== wanted.maxBudget.currency) return false;
    // The budget is a ceiling: at or under it qualifies.
    if (listing.price.amount > wanted.maxBudget.amount) return false;
  }

  if (wanted.acceptedConditions?.length) {
    if (!listing.condition || !wanted.acceptedConditions.includes(listing.condition)) {
      return false;
    }
  }

  if (distanceMeters(wanted.center, listing.location) > wanted.radiusMeters) return false;

  return textMatches(wantedSearchText(wanted.title), listing);
}

/**
 * Whether a price change should re-notify someone who already saw the listing.
 * Only a drop that newly brings the item under their ceiling is worth a push.
 */
export function priceDropNewlyQualifies(input: {
  previousPrice: Money;
  newPrice: Money;
  ceiling: Money;
}): boolean {
  if (input.previousPrice.currency !== input.ceiling.currency) return false;
  if (input.newPrice.currency !== input.ceiling.currency) return false;
  const wasAbove = input.previousPrice.amount > input.ceiling.amount;
  const nowWithin = input.newPrice.amount <= input.ceiling.amount;
  return wasAbove && nowWithin && isLessThan(input.newPrice, input.previousPrice);
}
