import { describe, expect, it } from 'vitest';
import { UserSerializer } from './user.serializer';

const serializer = new UserSerializer();

const base = {
  id: 'u1',
  username: 'manuel',
  displayName: 'Manuel',
  avatarUrl: null,
  verified: true,
  ratingSum: 0,
  reviewCount: 0,
};

describe('user rating', () => {
  it('has no rating before any review, rather than a rating of zero', () => {
    // These are different things: "unrated" must not look like "rated 0 stars".
    expect(serializer.toSummary(base).rating).toBeUndefined();
    expect(serializer.toSummary(base).reviewCount).toBe(0);
  });

  it('derives the average from the stored sum and count', () => {
    const summary = serializer.toSummary({ ...base, ratingSum: 14, reviewCount: 3 });
    expect(summary.rating).toBe(4.7);
  });

  it('rounds to one decimal', () => {
    expect(serializer.toSummary({ ...base, ratingSum: 5, reviewCount: 3 }).rating).toBe(1.7);
    expect(serializer.toSummary({ ...base, ratingSum: 10, reviewCount: 2 }).rating).toBe(5);
  });

  it('omits an absent avatar instead of emitting null', () => {
    expect(serializer.toSummary(base).avatarUrl).toBeUndefined();
    expect(serializer.toSummary({ ...base, avatarUrl: 'a.png' }).avatarUrl).toBe('a.png');
  });
});
