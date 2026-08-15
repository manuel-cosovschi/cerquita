import { describe, expect, it } from 'vitest';
import {
  adminRoleSatisfies,
  canDeleteStore,
  canIssueRefund,
  canManageListing,
  canManageStore,
  canReviewOrder,
  canViewOrder,
  storeRoleSatisfies,
} from './permissions.js';

describe('listing authorization (spec §91)', () => {
  it('lets a seller manage their own listing', () => {
    expect(canManageListing({ userId: 'user-a' }, { sellerId: 'user-a' })).toBe(true);
  });

  it('does NOT let user A edit user B’s listing', () => {
    expect(canManageListing({ userId: 'user-a' }, { sellerId: 'user-b' })).toBe(false);
  });

  it('lets a store seller manage a store listing they do not personally own', () => {
    const actor = { userId: 'user-a', storeRoles: { 'store-1': 'seller' as const } };
    expect(canManageListing(actor, { sellerId: 'user-b', storeId: 'store-1' })).toBe(true);
  });

  it('does not let a member of another store manage the listing', () => {
    const actor = { userId: 'user-a', storeRoles: { 'store-2': 'owner' as const } };
    expect(canManageListing(actor, { sellerId: 'user-b', storeId: 'store-1' })).toBe(false);
  });

  it('does not let store support staff edit listings', () => {
    const actor = { userId: 'user-a', storeRoles: { 'store-1': 'support' as const } };
    expect(canManageListing(actor, { sellerId: 'user-b', storeId: 'store-1' })).toBe(false);
  });
});

describe('store roles', () => {
  it('ranks roles so higher roles inherit lower permissions', () => {
    expect(storeRoleSatisfies('owner', 'seller')).toBe(true);
    expect(storeRoleSatisfies('seller', 'admin')).toBe(false);
  });

  it('requires admin or above to change store settings', () => {
    expect(canManageStore({ userId: 'u', storeRoles: { s: 'manager' } }, 's')).toBe(false);
    expect(canManageStore({ userId: 'u', storeRoles: { s: 'admin' } }, 's')).toBe(true);
  });

  it('only lets the owner delete a store', () => {
    expect(canDeleteStore({ userId: 'u', storeRoles: { s: 'admin' } }, 's')).toBe(false);
    expect(canDeleteStore({ userId: 'u', storeRoles: { s: 'owner' } }, 's')).toBe(true);
  });
});

describe('order visibility', () => {
  const order = { buyerId: 'buyer', sellerId: 'seller', storeId: 'store-1' };

  it('lets the buyer and the seller see it', () => {
    expect(canViewOrder({ userId: 'buyer' }, order)).toBe(true);
    expect(canViewOrder({ userId: 'seller' }, order)).toBe(true);
  });

  it('hides it from an unrelated user', () => {
    expect(canViewOrder({ userId: 'stranger' }, order)).toBe(false);
  });

  it('lets store support see it', () => {
    expect(canViewOrder({ userId: 'agent', storeRoles: { 'store-1': 'support' } }, order)).toBe(
      true,
    );
  });

  it('lets platform support see it', () => {
    expect(canViewOrder({ userId: 'admin', adminRole: 'support' }, order)).toBe(true);
  });
});

describe('reviews', () => {
  const base = {
    buyerId: 'buyer',
    sellerId: 'seller',
    orderIsSettled: true,
    alreadyReviewed: false,
  };

  it('allows a participant to review a settled order', () => {
    expect(canReviewOrder({ ...base, actorId: 'buyer' })).toBe(true);
    expect(canReviewOrder({ ...base, actorId: 'seller' })).toBe(true);
  });

  it('blocks reviews from non-participants', () => {
    expect(canReviewOrder({ ...base, actorId: 'stranger' })).toBe(false);
  });

  it('blocks reviews before the order settles', () => {
    expect(canReviewOrder({ ...base, actorId: 'buyer', orderIsSettled: false })).toBe(false);
  });

  it('blocks a second review', () => {
    expect(canReviewOrder({ ...base, actorId: 'buyer', alreadyReviewed: true })).toBe(false);
  });
});

describe('admin roles', () => {
  it('ranks admin roles', () => {
    expect(adminRoleSatisfies('super_admin', 'moderator')).toBe(true);
    expect(adminRoleSatisfies('support', 'moderator')).toBe(false);
  });

  it('lets finance and admins issue refunds but not moderators', () => {
    expect(canIssueRefund({ userId: 'u', adminRole: 'finance' })).toBe(true);
    expect(canIssueRefund({ userId: 'u', adminRole: 'admin' })).toBe(true);
    expect(canIssueRefund({ userId: 'u', adminRole: 'moderator' })).toBe(false);
    expect(canIssueRefund({ userId: 'u' })).toBe(false);
  });
});
