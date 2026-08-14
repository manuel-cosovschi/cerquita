/**
 * Listing lifecycle and publish-time validation (spec §14, §17).
 */

import type { ItemCondition, ListingKind, ListingStatus, UUID } from '@cerquita/types';
import { isGreaterThan, type Money } from '@cerquita/utils';

const LISTING_TRANSITIONS: Record<ListingStatus, readonly ListingStatus[]> = {
  draft: ['active', 'removed'],
  active: ['reserved', 'sold', 'paused', 'expired', 'removed'],
  reserved: ['active', 'sold', 'removed'],
  paused: ['active', 'removed', 'expired'],
  expired: ['active', 'removed'],
  sold: ['removed'],
  removed: [],
};

export function canTransitionListing(from: ListingStatus, to: ListingStatus): boolean {
  return (LISTING_TRANSITIONS[from] ?? []).includes(to);
}

/** Statuses in which a listing is publicly visible and appears on the map. */
export function isPubliclyVisible(status: ListingStatus): boolean {
  return status === 'active' || status === 'reserved';
}

/** Statuses in which a listing can be bought or bid on. */
export function isPurchasable(status: ListingStatus): boolean {
  return status === 'active';
}

export interface ListingValidationIssue {
  readonly field: string;
  readonly message: string;
}

export const MAX_IMAGES_PER_LISTING = 12;
export const MIN_TITLE_LENGTH = 3;
export const MAX_TITLE_LENGTH = 120;
export const MAX_DESCRIPTION_LENGTH = 5000;
export const MAX_TAGS = 15;

export interface ListingDraft {
  readonly kind: ListingKind;
  readonly title: string;
  readonly description: string;
  readonly categoryId?: UUID;
  readonly condition?: ItemCondition;
  readonly imageCount: number;
  readonly price?: Money;
  readonly maxBudget?: Money;
  readonly quantity?: number;
  readonly tags?: readonly string[];
  readonly wantedRadiusMeters?: number;
  readonly hasLocation: boolean;
}

/**
 * Validates a draft against the rules for its kind.
 *
 * Returns every issue so the publish screen can highlight all of them at once
 * rather than making the user resubmit repeatedly.
 */
export function validateListingForPublish(draft: ListingDraft): ListingValidationIssue[] {
  const issues: ListingValidationIssue[] = [];

  const title = draft.title.trim();
  if (title.length < MIN_TITLE_LENGTH) {
    issues.push({ field: 'title', message: 'El título es demasiado corto' });
  }
  if (title.length > MAX_TITLE_LENGTH) {
    issues.push({ field: 'title', message: `El título supera ${MAX_TITLE_LENGTH} caracteres` });
  }
  if (draft.description.length > MAX_DESCRIPTION_LENGTH) {
    issues.push({ field: 'description', message: 'La descripción es demasiado larga' });
  }
  if (!draft.categoryId) {
    issues.push({ field: 'categoryId', message: 'Elegí una categoría' });
  }
  if (!draft.hasLocation) {
    issues.push({ field: 'location', message: 'Indicá dónde está el producto' });
  }
  if (draft.imageCount > MAX_IMAGES_PER_LISTING) {
    issues.push({ field: 'images', message: `Máximo ${MAX_IMAGES_PER_LISTING} fotos` });
  }
  if ((draft.tags?.length ?? 0) > MAX_TAGS) {
    issues.push({ field: 'tags', message: `Máximo ${MAX_TAGS} etiquetas` });
  }

  if (draft.kind === 'sale') {
    if (!draft.price) {
      issues.push({ field: 'price', message: 'Definí un precio' });
    } else if (draft.price.amount <= 0) {
      issues.push({ field: 'price', message: 'El precio debe ser mayor a cero' });
    }
    if (draft.imageCount < 1) {
      issues.push({ field: 'images', message: 'Subí al menos una foto' });
    }
    if (draft.quantity !== undefined && draft.quantity < 1) {
      issues.push({ field: 'quantity', message: 'La cantidad debe ser al menos 1' });
    }
  }

  if (draft.kind === 'wanted') {
    // A "Busco" post has no photo requirement — the whole point is you don't
    // have the thing yet.
    if (draft.maxBudget && draft.maxBudget.amount <= 0) {
      issues.push({ field: 'maxBudget', message: 'El presupuesto debe ser mayor a cero' });
    }
    const radius = draft.wantedRadiusMeters;
    if (radius !== undefined && (radius < 500 || radius > 100_000)) {
      issues.push({ field: 'wantedRadiusMeters', message: 'El radio debe estar entre 0,5 y 100 km' });
    }
  }

  if (draft.kind === 'auction') {
    if (draft.imageCount < 1) {
      issues.push({ field: 'images', message: 'Subí al menos una foto' });
    }
  }

  return issues;
}

/**
 * Whether a price change should be recorded in the history and trigger
 * price-drop notifications. Increases are recorded but do not notify.
 */
export function isPriceDrop(previous: Money, next: Money): boolean {
  return previous.currency === next.currency && isGreaterThan(previous, next);
}

/**
 * Minimum drop worth notifying about, so a 1-peso nudge does not spam every
 * user who favourited the listing. 3% or nothing.
 */
export function isNotifiablePriceDrop(previous: Money, next: Money): boolean {
  if (!isPriceDrop(previous, next)) return false;
  if (previous.amount <= 0) return false;
  const dropBps = ((previous.amount - next.amount) * 10_000) / previous.amount;
  return dropBps >= 300;
}
