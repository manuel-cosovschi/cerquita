/**
 * Authorization rules (spec §84, §91).
 *
 * Every write path in the API funnels through one of these predicates. They take
 * explicit ownership facts rather than fetching anything, so they are trivially
 * testable and cannot accidentally trust a client-supplied id.
 */

import type { AdminRole, StoreRole, UUID } from '@cerquita/types';

/** Store roles ordered by privilege. */
const STORE_ROLE_RANK: Record<StoreRole, number> = {
  support: 0,
  seller: 1,
  manager: 2,
  admin: 3,
  owner: 4,
};

export function storeRoleSatisfies(actual: StoreRole, required: StoreRole): boolean {
  return STORE_ROLE_RANK[actual] >= STORE_ROLE_RANK[required];
}

const ADMIN_ROLE_RANK: Record<AdminRole, number> = {
  support: 0,
  finance: 1,
  moderator: 2,
  admin: 3,
  super_admin: 4,
};

export function adminRoleSatisfies(actual: AdminRole, required: AdminRole): boolean {
  return ADMIN_ROLE_RANK[actual] >= ADMIN_ROLE_RANK[required];
}

export interface ListingOwnership {
  readonly sellerId: UUID;
  readonly storeId?: UUID;
}

export interface ActorContext {
  readonly userId: UUID;
  /** Roles the actor holds in stores, keyed by store id. */
  readonly storeRoles?: Readonly<Record<UUID, StoreRole>>;
  readonly adminRole?: AdminRole;
}

/**
 * Can the actor edit or delete this listing?
 *
 * Personal listings: only the seller. Store listings: anyone with `seller` or
 * above in that store — which is why a store never needs its own account (§37).
 */
export function canManageListing(actor: ActorContext, listing: ListingOwnership): boolean {
  if (listing.storeId) {
    const role = actor.storeRoles?.[listing.storeId];
    if (role && storeRoleSatisfies(role, 'seller')) return true;
  }
  return actor.userId === listing.sellerId;
}

/** Store settings, payouts and member management need `admin` or above. */
export function canManageStore(actor: ActorContext, storeId: UUID): boolean {
  const role = actor.storeRoles?.[storeId];
  return role !== undefined && storeRoleSatisfies(role, 'admin');
}

/** Only an owner may transfer ownership or delete a store. */
export function canDeleteStore(actor: ActorContext, storeId: UUID): boolean {
  return actor.storeRoles?.[storeId] === 'owner';
}

/** Fulfilment actions (mark prepared, shipped) need `manager` or above. */
export function canFulfilStoreOrders(actor: ActorContext, storeId: UUID): boolean {
  const role = actor.storeRoles?.[storeId];
  return role !== undefined && storeRoleSatisfies(role, 'manager');
}

export function canViewOrder(
  actor: ActorContext,
  order: { buyerId: UUID; sellerId: UUID; storeId?: UUID },
): boolean {
  if (actor.userId === order.buyerId || actor.userId === order.sellerId) return true;
  if (order.storeId) {
    const role = actor.storeRoles?.[order.storeId];
    if (role && storeRoleSatisfies(role, 'support')) return true;
  }
  return actor.adminRole !== undefined && adminRoleSatisfies(actor.adminRole, 'support');
}

/** Only the buyer or seller of a settled order may review the counterparty (§45). */
export function canReviewOrder(input: {
  actorId: UUID;
  buyerId: UUID;
  sellerId: UUID;
  orderIsSettled: boolean;
  alreadyReviewed: boolean;
}): boolean {
  if (!input.orderIsSettled || input.alreadyReviewed) return false;
  return input.actorId === input.buyerId || input.actorId === input.sellerId;
}

export function canModerate(actor: ActorContext): boolean {
  return actor.adminRole !== undefined && adminRoleSatisfies(actor.adminRole, 'moderator');
}

export function canResolveDispute(actor: ActorContext): boolean {
  return actor.adminRole !== undefined && adminRoleSatisfies(actor.adminRole, 'moderator');
}

export function canIssueRefund(actor: ActorContext): boolean {
  if (!actor.adminRole) return false;
  // Finance and admins can move money; moderators cannot.
  return actor.adminRole === 'finance' || adminRoleSatisfies(actor.adminRole, 'admin');
}

export function canChangeGlobalConfiguration(actor: ActorContext): boolean {
  return actor.adminRole !== undefined && adminRoleSatisfies(actor.adminRole, 'admin');
}

export function canManageAdmins(actor: ActorContext): boolean {
  return actor.adminRole === 'super_admin';
}

export function canAccessConversation(actor: ActorContext, participantIds: readonly UUID[]): boolean {
  return participantIds.includes(actor.userId);
}
