import { Injectable } from '@nestjs/common';
import type { ItemCondition } from '@cerquita/types';
import type { AiProvider, ListingSuggestion, StructuredSearchQuery } from './ai-provider';

/**
 * Rule-based natural-language parsing for Spanish queries.
 *
 * Not a language model — a deliberately small extractor that handles the phrases
 * this product actually receives ("menos de $500.000", "a 5 km", "usada"). It is
 * good enough that AI search is genuinely usable with no API key, and it doubles
 * as the deterministic fixture the tests run against.
 */
@Injectable()
export class MockAiProvider implements AiProvider {
  readonly name = 'mock';

  async parseSearchQuery(prompt: string): Promise<StructuredSearchQuery> {
    const text = prompt.toLowerCase();

    return {
      query: this.extractSubject(prompt),
      condition: this.extractCondition(text),
      maxPrice: this.extractPrice(text, ['menos de', 'hasta', 'máximo', 'maximo', 'por menos de']),
      minPrice: this.extractPrice(text, ['más de', 'mas de', 'desde', 'mínimo', 'minimo']),
      radiusKm: this.extractRadiusKm(text),
      kind: text.includes('subasta') ? 'auction' : text.includes('busco') ? 'wanted' : undefined,
    };
  }

  async suggestListing(input: {
    imageUrls: string[];
    partialTitle?: string;
  }): Promise<ListingSuggestion> {
    // With no model available, echo back only what can be inferred honestly
    // rather than inventing a description the seller did not write.
    if (!input.partialTitle) return {};

    return {
      title: input.partialTitle.trim(),
      tags: input.partialTitle
        .toLowerCase()
        .split(/\s+/)
        .filter((word) => word.length > 3)
        .slice(0, 5),
    };
  }

  /**
   * Strips filter phrases so what remains is the thing being searched for.
   *
   * Order matters: multi-word phrases like "por menos de $500.000" must go
   * before single stopwords, otherwise removing "por" and "de" first breaks the
   * phrase apart and leaves "menos $500.000" behind in the subject.
   */
  private extractSubject(prompt: string): string | undefined {
    const cleaned = prompt
      // 1. Price phrases, with their optional leading preposition.
      .replace(
        /\b(por\s+)?(menos de|más de|mas de|hasta|desde|máximo|maximo|mínimo|minimo)\s*\$?\s*[\d.,]+/gi,
        ' ',
      )
      // 2. Distance phrases.
      .replace(
        /\b(a\s+)?(menos de\s+)?\d+([.,]\d+)?\s*(km|kilómetros|kilometros|mts?|metros)\b/gi,
        ' ',
      )
      // 3. Condition words.
      .replace(/\b(nuev[oa]s?|usad[oa]s?|seminuev[oa]s?|impecables?|sin uso|a estrenar)\b/gi, ' ')
      // 4. Locality words — they express proximity, not the item.
      .replace(/\b(cerca|cerquita|cercanas?|cercanos?|mío|mio|acá|aca|aquí|aqui|zona|barrio)\b/gi, ' ')
      // 5. Whatever intent words remain.
      .replace(/\b(quiero|busco|necesito|comprar|vender|una|un|el|la|los|las|de|del|por|a)\b/gi, ' ')
      // 6. Orphaned units left behind by the phrase removals above.
      .replace(/\b(km|kilómetros|kilometros|mts?|metros|pesos)\b/gi, ' ')
      .replace(/[$]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    return cleaned.length >= 2 ? cleaned : undefined;
  }

  /**
   * Spanish adjectives agree in gender and number, so every form has to be
   * covered: "nuevo", "nueva", "nuevos", "nuevas". Checked most-specific first —
   * "como nuevo" must not be read as "nuevo".
   */
  private extractCondition(text: string): ItemCondition | undefined {
    if (/\b(seminuev[oa]s?|como nuev[oa]s?|impecables?)\b/.test(text)) return 'like_new';
    if (/\b(para repuestos|para partes|no funciona)\b/.test(text)) return 'for_parts';
    if (/\b(nuev[oa]s?|sin uso|a estrenar)\b/.test(text)) return 'new';
    if (/\b(usad[oa]s?|de segunda mano|second hand)\b/.test(text)) return 'good';
    return undefined;
  }

  /**
   * Parses an Argentine-formatted amount after any of `markers`, returning minor
   * units. "500.000" is five hundred thousand, not five hundred — the dot is a
   * thousands separator here, which is why this cannot use `parseFloat`.
   */
  private extractPrice(text: string, markers: string[]): number | undefined {
    for (const marker of markers) {
      const pattern = new RegExp(`${escapeRegExp(marker)}\\s*\\$?\\s*([\\d.,]+)`, 'i');
      const match = pattern.exec(text);
      const raw = match?.[1];
      if (!raw) continue;

      const normalized = raw.replace(/\./g, '').replace(',', '.');
      const major = Number(normalized);
      if (Number.isFinite(major) && major > 0) return Math.round(major * 100);
    }
    return undefined;
  }

  private extractRadiusKm(text: string): number | undefined {
    const km = /(\d+([.,]\d+)?)\s*(km|kilómetros|kilometros)/i.exec(text);
    if (km?.[1]) return Number(km[1].replace(',', '.'));

    const meters = /(\d+)\s*(m|metros)\b/i.exec(text);
    if (meters?.[1]) return Number(meters[1]) / 1000;

    return undefined;
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
