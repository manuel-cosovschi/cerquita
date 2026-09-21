import { Injectable } from '@nestjs/common';
import type { UserSummary } from '@cerquita/types';

/** The subset of columns every user serialization needs. */
export interface UserRow {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  verified: boolean;
  ratingSum: number;
  reviewCount: number;
}

export const USER_SUMMARY_SELECT = {
  id: true,
  username: true,
  displayName: true,
  avatarUrl: true,
  verified: true,
  ratingSum: true,
  reviewCount: true,
} as const;

/**
 * Turns a user row into the public summary shape.
 *
 * Rating is derived from `ratingSum / reviewCount` rather than stored, so it can
 * never drift out of sync with the reviews behind it. With no reviews it is
 * `undefined` instead of 0 — a new seller has no rating, which is different from
 * having a rating of zero.
 */
@Injectable()
export class UserSerializer {
  toSummary(row: UserRow): UserSummary {
    return {
      id: row.id,
      username: row.username,
      displayName: row.displayName,
      avatarUrl: row.avatarUrl ?? undefined,
      verified: row.verified,
      rating: row.reviewCount > 0 ? round1(row.ratingSum / row.reviewCount) : undefined,
      reviewCount: row.reviewCount,
    };
  }
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}
