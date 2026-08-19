import { describe, expect, it } from 'vitest';
import { money } from '@cerquita/utils';
import {
  matchesSavedSearch,
  matchesWantedPost,
  priceDropNewlyQualifies,
  stripWantedFraming,
  wantedSearchText,
  type MatchableListing,
  type WantedPost,
} from './matching.js';

const OBELISCO = { lat: -34.6037, lng: -58.3816 };
const ARS = (major: number) => money(major * 100, 'ARS');

const listing: MatchableListing = {
  id: 'l1',
  sellerId: 'seller',
  kind: 'sale',
  title: 'PlayStation 5 Slim',
  description: 'PS5 Slim con lectora, impecable',
  tags: ['ps5', 'playstation', 'consola'],
  categoryId: 'cat-consolas',
  condition: 'like_new',
  price: ARS(520_000),
  location: OBELISCO,
};

const wanted: WantedPost = {
  id: 'w1',
  ownerId: 'buyer',
  title: 'Busco PlayStation 5',
  categoryId: 'cat-consolas',
  maxBudget: ARS(550_000),
  center: OBELISCO,
  radiusMeters: 5000,
};

describe('wantedSearchText', () => {
  it('strips the framing words that describe the post, not the item', () => {
    // Without this, "Busco PlayStation 5" can never match anything, because the
    // matcher requires every term to appear in the listing.
    expect(wantedSearchText('Busco PlayStation 5')).toBe('playstation 5');
    expect(wantedSearchText('Necesito una bicicleta')).toBe('una bicicleta');
    expect(wantedSearchText('COMPRO iPhone')).toBe('iphone');
  });

  it('falls back to the original when the title is only framing', () => {
    // Returning an empty string would make it match every listing.
    expect(wantedSearchText('Busco')).toBe('Busco');
  });
});

describe('matchesWantedPost', () => {
  it('matches a listing that satisfies the post', () => {
    expect(matchesWantedPost(wanted, listing)).toBe(true);
  });

  it('rejects a listing over the budget ceiling', () => {
    expect(matchesWantedPost(wanted, { ...listing, price: ARS(1_500_000) })).toBe(false);
  });

  it('accepts a listing exactly at the ceiling', () => {
    expect(matchesWantedPost(wanted, { ...listing, price: ARS(550_000) })).toBe(true);
  });

  it('rejects a different category', () => {
    expect(matchesWantedPost(wanted, { ...listing, categoryId: 'cat-bicis' })).toBe(false);
  });

  it('rejects a listing outside the radius', () => {
    // Roughly 9 km north.
    const faraway = { ...listing, location: { lat: -34.52, lng: -58.3816 } };
    expect(matchesWantedPost(wanted, faraway)).toBe(false);
  });

  it('never matches the wanted poster’s own listing', () => {
    expect(matchesWantedPost({ ...wanted, ownerId: 'seller' }, listing)).toBe(false);
  });

  it('ignores other wanted posts', () => {
    expect(matchesWantedPost(wanted, { ...listing, kind: 'wanted' })).toBe(false);
  });

  it('honours accepted conditions', () => {
    expect(matchesWantedPost({ ...wanted, acceptedConditions: ['new'] }, listing)).toBe(false);
    expect(matchesWantedPost({ ...wanted, acceptedConditions: ['like_new'] }, listing)).toBe(true);
  });
});

describe('matchesSavedSearch', () => {
  const criteria = {
    id: 's1',
    ownerId: 'buyer',
    text: 'PS5',
    categoryIds: ['cat-consolas'],
    maxPrice: ARS(600_000),
    center: OBELISCO,
    radiusMeters: 5000,
  };

  it('matches within every constraint', () => {
    expect(matchesSavedSearch(criteria, listing)).toBe(true);
  });

  it('rejects over the ceiling and outside the radius', () => {
    expect(matchesSavedSearch(criteria, { ...listing, price: ARS(900_000) })).toBe(false);
    expect(
      matchesSavedSearch(criteria, { ...listing, location: { lat: -34.52, lng: -58.3816 } }),
    ).toBe(false);
  });

  it('never alerts someone about their own listing', () => {
    expect(matchesSavedSearch({ ...criteria, ownerId: 'seller' }, listing)).toBe(false);
  });
});

describe('priceDropNewlyQualifies', () => {
  it('fires only when the drop newly brings the item under the ceiling', () => {
    // Was above, now within: worth telling someone about.
    expect(
      priceDropNewlyQualifies({
        previousPrice: ARS(700_000),
        newPrice: ARS(580_000),
        ceiling: ARS(600_000),
      }),
    ).toBe(true);

    // Already within budget before the drop: they knew about it already.
    expect(
      priceDropNewlyQualifies({
        previousPrice: ARS(590_000),
        newPrice: ARS(500_000),
        ceiling: ARS(600_000),
      }),
    ).toBe(false);

    // Still over budget.
    expect(
      priceDropNewlyQualifies({
        previousPrice: ARS(900_000),
        newPrice: ARS(700_000),
        ceiling: ARS(600_000),
      }),
    ).toBe(false);
  });
});

describe('stripWantedFraming', () => {
  it('drops the leading framing so a headline does not stutter', () => {
    // The feed renders "Fran busca …" around this; without it the row reads
    // "Fran busca Busco una bici".
    expect(stripWantedFraming('Busco bicicleta para niño')).toBe('bicicleta para niño');
    expect(stripWantedFraming('Necesito urgente una heladera')).toBe('una heladera');
  });

  it("keeps the author's casing and accents, unlike the search variant", () => {
    expect(stripWantedFraming('Busco MacBook Air M2')).toBe('MacBook Air M2');
    expect(wantedSearchText('Busco MacBook Air M2')).toBe('macbook air m2');
  });

  it('only strips framing at the start', () => {
    // "busco" here is part of what they wrote, not a prefix to remove.
    expect(stripWantedFraming('Mesa como la que busco hace meses')).toBe(
      'Mesa como la que busco hace meses',
    );
  });

  it('falls back to the original when the title is nothing but framing', () => {
    expect(stripWantedFraming('Busco')).toBe('Busco');
  });

  it('leaves an ordinary title alone', () => {
    expect(stripWantedFraming('Bicicleta rodado 29')).toBe('Bicicleta rodado 29');
  });
});
