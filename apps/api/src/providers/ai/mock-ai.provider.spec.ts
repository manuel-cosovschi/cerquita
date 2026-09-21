import { describe, expect, it } from 'vitest';
import { MockAiProvider } from './mock-ai.provider';

/**
 * The mock provider is the default in development, so its parsing is real
 * behaviour rather than a placeholder — it deserves real tests.
 */
const ai = new MockAiProvider();

describe('natural-language search parsing', () => {
  it('parses the example from the spec', async () => {
    const result = await ai.parseSearchQuery(
      'Quiero una mountain bike usada por menos de $500.000 a menos de 5 km',
    );

    expect(result.query).toBe('mountain bike');
    expect(result.condition).toBe('good');
    // 500.000 pesos in centavos — the dot is a thousands separator in es-AR.
    expect(result.maxPrice).toBe(50_000_000);
    expect(result.radiusKm).toBe(5);
  });

  it('reads "hasta" as a price ceiling', async () => {
    const result = await ai.parseSearchQuery('busco un taladro nuevo hasta $100.000');
    expect(result.query).toBe('taladro');
    expect(result.condition).toBe('new');
    expect(result.maxPrice).toBe(10_000_000);
    expect(result.kind).toBe('wanted');
  });

  it('strips locality words from the subject', async () => {
    const result = await ai.parseSearchQuery('PS5 cerca');
    expect(result.query).toBe('PS5');
  });

  it('reads a minimum price', async () => {
    const result = await ai.parseSearchQuery('notebook desde $300.000');
    expect(result.minPrice).toBe(30_000_000);
  });

  it('converts a radius given in metres', async () => {
    const result = await ai.parseSearchQuery('heladera a 800 metros');
    expect(result.radiusKm).toBe(0.8);
  });

  it('detects auctions', async () => {
    const result = await ai.parseSearchQuery('subasta de camisetas');
    expect(result.kind).toBe('auction');
  });

  it('returns an undefined subject rather than noise for a bare filter', async () => {
    const result = await ai.parseSearchQuery('menos de $1.000');
    expect(result.query).toBeUndefined();
    expect(result.maxPrice).toBe(100_000);
  });

  it('does not invent listing content when no model is configured', async () => {
    // Suggesting a description the seller never wrote would be fabrication.
    expect(await ai.suggestListing({ imageUrls: ['a.jpg'] })).toEqual({});

    const suggestion = await ai.suggestListing({
      imageUrls: [],
      partialTitle: 'Bicicleta mountain bike',
    });
    expect(suggestion.title).toBe('Bicicleta mountain bike');
    expect(suggestion.description).toBeUndefined();
  });
});
