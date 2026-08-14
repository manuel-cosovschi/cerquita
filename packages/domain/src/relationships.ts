/**
 * Follows and friendships (spec §8).
 *
 * Two distinct relations:
 *  - Follow is unilateral. A follows B; B need not reciprocate.
 *  - Friendship is bilateral and requires acceptance.
 *
 * Both feed into `resolveAudienceTier`, which is the ONLY way pricing learns what
 * a viewer is entitled to.
 */

import type { AudienceTier, FriendshipStatus, UUID } from '@cerquita/types';

export interface FriendshipState {
  readonly requesterId: UUID;
  readonly addresseeId: UUID;
  readonly status: FriendshipStatus;
}

const FRIENDSHIP_TRANSITIONS: Record<FriendshipStatus, readonly FriendshipStatus[]> = {
  pending: ['accepted', 'rejected', 'blocked'],
  accepted: ['blocked'],
  rejected: ['pending', 'blocked'],
  blocked: [],
};

export function canTransitionFriendship(
  from: FriendshipStatus,
  to: FriendshipStatus,
): boolean {
  return (FRIENDSHIP_TRANSITIONS[from] ?? []).includes(to);
}

/** Only the addressee of a pending request may accept or reject it. */
export function canRespondToRequest(friendship: FriendshipState, userId: UUID): boolean {
  return friendship.status === 'pending' && friendship.addresseeId === userId;
}

/** Either party may cancel a pending request or remove an accepted friendship. */
export function isParticipant(friendship: FriendshipState, userId: UUID): boolean {
  return friendship.requesterId === userId || friendship.addresseeId === userId;
}

/**
 * Canonical ordering for the friendship uniqueness constraint. Without this,
 * (A,B) and (B,A) would be two separate rows and users could hold duplicate
 * friendships with each other.
 */
export function friendshipKey(a: UUID, b: UUID): [UUID, UUID] {
  return a < b ? [a, b] : [b, a];
}

export interface ViewerRelationship {
  readonly isFollowing: boolean;
  readonly isFollowedBy: boolean;
  readonly friendship: FriendshipStatus | null;
  readonly isBlocked: boolean;
}

/**
 * Resolves the viewer's pricing tier.
 *
 * Deliberately conservative: only an ACCEPTED friendship counts as `friend`, and
 * only the viewer following the seller counts as `follower` — being followed BY
 * the seller grants nothing, otherwise anyone could self-promote into a discount
 * by getting followed back.
 */
export function resolveAudienceTier(relationship: ViewerRelationship | null): AudienceTier {
  if (!relationship || relationship.isBlocked) return 'public';
  if (relationship.friendship === 'accepted') return 'friend';
  if (relationship.isFollowing) return 'follower';
  return 'public';
}

/** A blocked relationship hides content in both directions. */
export function canInteract(relationship: ViewerRelationship | null): boolean {
  return !relationship?.isBlocked;
}

export function isSelf(a: UUID, b: UUID): boolean {
  return a === b;
}
