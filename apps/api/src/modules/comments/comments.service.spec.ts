import { describe, expect, it, vi } from 'vitest';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { CommentsService } from './comments.service';

/**
 * The comment counter is a denormalised number, which means it can lie. These
 * tests pin the three ways it was able to: hiding without subtracting, hiding a
 * thread and subtracting only the parent, and subtracting twice for one delete.
 *
 * The Prisma client is stubbed rather than mocked wholesale — only the calls
 * these paths make are defined, so a path that starts touching something new
 * fails loudly instead of silently passing.
 */

interface StubComment {
  id: string;
  authorId: string;
  listingId: string;
  parentId: string | null;
  hiddenAt: Date | null;
}

function buildService(options: {
  comments: StubComment[];
  listing?: { id: string; sellerId: string; title: string; status: string } | null;
  blocked?: boolean;
}) {
  const comments = [...options.comments];
  const listing =
    options.listing === undefined
      ? { id: 'l1', sellerId: 'seller', title: 'Bici', status: 'active' }
      : options.listing;

  let commentCount = comments.filter((c) => !c.hiddenAt).length;

  const listingComment = {
    findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
      const found = comments.find((c) => c.id === where.id);
      if (!found) return null;
      return { ...found, listing: listing ? { sellerId: listing.sellerId } : null };
    }),
    updateMany: vi.fn(
      async ({
        where,
        data,
      }: {
        where: { id?: string; parentId?: string; hiddenAt: null };
        data: { hiddenAt: Date };
      }) => {
        const targets = comments.filter(
          (c) =>
            c.hiddenAt === null && (where.id ? c.id === where.id : c.parentId === where.parentId),
        );
        for (const target of targets) target.hiddenAt = data.hiddenAt;
        return { count: targets.length };
      },
    ),
    create: vi.fn(async ({ data }: { data: Record<string, string | undefined> }) => {
      const created: StubComment = {
        id: `c${comments.length + 1}`,
        authorId: String(data.authorId),
        listingId: String(data.listingId),
        parentId: data.parentId ?? null,
        hiddenAt: null,
      };
      comments.push(created);
      return {
        ...created,
        body: data.body,
        createdAt: new Date(),
        author: { id: created.authorId, username: 'x', displayName: 'X', verified: false },
      };
    }),
  };

  const prisma = {
    listing: {
      findUnique: vi.fn(async () => listing),
      update: vi.fn(
        async ({
          data,
        }: {
          data: { commentCount: { decrement?: number; increment?: number } };
        }) => {
          commentCount += (data.commentCount.increment ?? 0) - (data.commentCount.decrement ?? 0);
          return {};
        },
      ),
    },
    listingComment,
    block: { findFirst: vi.fn(async () => (options.blocked ? { blockerId: 'seller' } : null)) },
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma)),
  };

  const service = new CommentsService(
    prisma as never,
    { toSummary: (user: unknown) => user } as never,
    { create: vi.fn(async () => undefined) } as never,
    { forSeller: vi.fn(async () => ({ label: null })) } as never,
  );

  return { service, prisma, count: () => commentCount, comments };
}

const parent: StubComment = {
  id: 'c1',
  authorId: 'author',
  listingId: 'l1',
  parentId: null,
  hiddenAt: null,
};
const reply: StubComment = {
  id: 'c2',
  authorId: 'other',
  listingId: 'l1',
  parentId: 'c1',
  hiddenAt: null,
};

describe('hiding a comment', () => {
  it('subtracts the thread it removes, not just the comment itself', async () => {
    // The reply disappears from the API along with its parent, so a count that
    // only dropped by one would promise a comment nobody can read.
    const { service, count } = buildService({ comments: [{ ...parent }, { ...reply }] });
    expect(count()).toBe(2);

    await service.hide('c1', 'author');

    expect(count()).toBe(0);
  });

  it('is idempotent — a repeated delete cannot walk the counter below zero', async () => {
    const { service, count } = buildService({ comments: [{ ...parent }] });

    await service.hide('c1', 'author');
    await service.hide('c1', 'author');

    expect(count()).toBe(0);
  });

  it('lets the seller hide any comment on their own listing', async () => {
    const { service, count } = buildService({ comments: [{ ...parent }] });
    await service.hide('c1', 'seller');
    expect(count()).toBe(0);
  });

  it('refuses anyone who is neither the author nor the seller', async () => {
    const { service, count } = buildService({ comments: [{ ...parent }] });
    await expect(service.hide('c1', 'stranger')).rejects.toBeInstanceOf(ForbiddenException);
    expect(count()).toBe(1);
  });
});

describe('posting a comment', () => {
  const input = { listingId: 'l1', authorId: 'author', body: '¿Sigue disponible?' };

  it('counts the comment in the same transaction that creates it', async () => {
    const { service, count } = buildService({ comments: [] });
    await service.create(input);
    expect(count()).toBe(1);
  });

  it('refuses to nest a reply under another reply', async () => {
    // `list()` only reads replies one level under a visible parent, so a deeper
    // one would be stored and then never rendered anywhere.
    const { service } = buildService({ comments: [{ ...parent }, { ...reply }] });
    await expect(service.create({ ...input, parentId: 'c2' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('refuses a parent that belongs to a different listing', async () => {
    const { service } = buildService({
      comments: [{ ...parent, listingId: 'other-listing' }],
    });
    await expect(service.create({ ...input, parentId: 'c1' })).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('refuses a parent that has been hidden', async () => {
    const { service } = buildService({ comments: [{ ...parent, hiddenAt: new Date() }] });
    await expect(service.create({ ...input, parentId: 'c1' })).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('refuses when either side has blocked the other', async () => {
    const { service } = buildService({ comments: [], blocked: true });
    await expect(service.create(input)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('refuses on a removed listing', async () => {
    const { service } = buildService({
      comments: [],
      listing: { id: 'l1', sellerId: 'seller', title: 'Bici', status: 'removed' },
    });
    await expect(service.create(input)).rejects.toBeInstanceOf(BadRequestException);
  });
});
