import type { ItemCondition } from '@cerquita/types';

/**
 * AI abstraction (spec §19, §20, §127).
 *
 * Two capabilities, both optional. When `AI_PROVIDER=mock`, the local
 * implementation still returns useful results, so search and publishing work
 * with no API key — the feature degrades, the app does not break.
 */
export interface StructuredSearchQuery {
  readonly query?: string;
  readonly condition?: ItemCondition;
  readonly maxPrice?: number;
  readonly minPrice?: number;
  readonly radiusKm?: number;
  readonly kind?: 'sale' | 'wanted' | 'auction';
}

export interface ListingSuggestion {
  readonly title?: string;
  readonly description?: string;
  readonly categorySlug?: string;
  readonly condition?: ItemCondition;
  readonly suggestedPriceAmount?: number;
  readonly tags?: string[];
}

export interface AiProvider {
  readonly name: string;
  /** Turns "una mountain bike usada por menos de $500.000 a 5 km" into filters. */
  parseSearchQuery(prompt: string): Promise<StructuredSearchQuery>;
  /** Suggests listing fields from photos and any text the seller already typed. */
  suggestListing(input: { imageUrls: string[]; partialTitle?: string }): Promise<ListingSuggestion>;
}

export const AI_PROVIDER = Symbol('AI_PROVIDER');
