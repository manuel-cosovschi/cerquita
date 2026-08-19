import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Conversation, ListingSummary, Message, Paginated } from '@cerquita/types';
import { PrismaService } from '../../prisma/prisma.service';
import { UserSerializer, USER_SUMMARY_SELECT } from '../users/user.serializer';
import { NotificationsService } from '../notifications/notifications.service';
import { ListingsService } from '../listings/listings.service';

/** Everything a conversation needs to be serialized, in one round trip. */
const CONVERSATION_INCLUDE = {
  members: { include: { user: { select: USER_SUMMARY_SELECT } } },
  messages: { orderBy: { createdAt: 'desc' }, take: 1 },
} as const;

interface MessageRow {
  id: string;
  conversationId: string;
  kind: string;
  body: string | null;
  imageUrl: string | null;
  offerId: string | null;
  senderId: string;
  createdAt: Date;
}

interface ConversationRow {
  id: string;
  context: Conversation['context'] | null;
  contextId: string | null;
  listingId: string | null;
  updatedAt: Date;
  members: Array<{
    userId: string;
    lastReadAt: Date | null;
    user: Parameters<UserSerializer['toSummary']>[0];
  }>;
  messages: MessageRow[];
}

function listingIdsOf(rows: ReadonlyArray<{ listingId: string | null }>): string[] {
  return [...new Set(rows.map((row) => row.listingId).filter((id): id is string => id !== null))];
}

export interface SendMessageInput {
  body?: string;
  imageUrl?: string;
  meetingPoint?: { label: string; point: { lat: number; lng: number } };
  clientId?: string;
}

/**
 * Messaging (spec §35).
 *
 * Conversations are keyed by participants plus an optional listing, so asking
 * about two different items from the same seller gives two threads rather than
 * one confusing one.
 *
 * Access control is checked on every read and write against the participant
 * list — never against an id the client supplied.
 */
@Injectable()
export class ChatService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UserSerializer,
    private readonly notifications: NotificationsService,
    private readonly listings: ListingsService,
  ) {}

  /**
   * Opens (or reuses) the thread between two people about a listing.
   *
   * Reuse is deliberate: a buyer who asks, leaves and comes back should land in
   * the same conversation, not start a new one the seller has to reconcile.
   */
  async startConversation(input: {
    actorId: string;
    recipientId: string;
    listingId?: string;
    firstMessage?: string;
  }): Promise<Conversation> {
    if (input.actorId === input.recipientId) {
      throw new BadRequestException({
        message: 'No podés iniciar una conversación con vos mismo',
        code: 'self_conversation',
      });
    }

    await this.assertNotBlocked(input.actorId, input.recipientId);

    const existing = await this.prisma.conversation.findFirst({
      where: {
        listingId: input.listingId ?? null,
        AND: [
          { members: { some: { userId: input.actorId } } },
          { members: { some: { userId: input.recipientId } } },
        ],
      },
      select: { id: true },
    });

    const conversationId =
      existing?.id ??
      (
        await this.prisma.conversation.create({
          data: {
            listingId: input.listingId ?? null,
            context: input.listingId ? 'listing' : undefined,
            contextId: input.listingId ?? undefined,
            members: {
              create: [{ userId: input.actorId }, { userId: input.recipientId }],
            },
          },
          select: { id: true },
        })
      ).id;

    if (input.firstMessage?.trim()) {
      await this.sendMessage(conversationId, input.actorId, { body: input.firstMessage });
    }

    return this.findOne(conversationId, input.actorId);
  }

  async sendMessage(
    conversationId: string,
    senderId: string,
    input: SendMessageInput,
  ): Promise<Message> {
    const participants = await this.participantIds(conversationId);
    if (!participants.includes(senderId)) {
      throw new ForbiddenException({
        message: 'No participás de esta conversación',
        code: 'forbidden',
      });
    }

    const recipients = participants.filter((id) => id !== senderId);
    for (const recipient of recipients) {
      await this.assertNotBlocked(senderId, recipient);
    }

    // `clientId` makes sending idempotent: a retry after a flaky connection
    // resolves to the message already stored instead of duplicating it.
    if (input.clientId) {
      const duplicate = await this.prisma.message.findFirst({
        where: { conversationId, clientId: input.clientId },
      });
      if (duplicate) return this.toMessage(duplicate);
    }

    const created = await this.prisma.$transaction(async (tx) => {
      const message = await tx.message.create({
        data: {
          conversationId,
          senderId,
          kind: input.imageUrl ? 'image' : input.meetingPoint ? 'meeting_point' : 'text',
          body: input.body,
          imageUrl: input.imageUrl,
          meetingLabel: input.meetingPoint?.label,
          clientId: input.clientId,
        },
      });

      if (input.meetingPoint) {
        // Geography column: Prisma cannot write it, so it goes in a raw follow-up
        // inside the same transaction.
        await tx.$executeRaw`
          UPDATE "Message"
          SET "meetingPoint" = ST_SetSRID(ST_MakePoint(${input.meetingPoint.point.lng}, ${input.meetingPoint.point.lat}), 4326)::geography
          WHERE "id" = ${message.id}::uuid
        `;
      }

      // Bumps the thread so conversation lists sort by real activity.
      await tx.conversation.update({
        where: { id: conversationId },
        data: { updatedAt: new Date() },
      });

      return message;
    });

    const sender = await this.prisma.user.findUniqueOrThrow({
      where: { id: senderId },
      select: { displayName: true },
    });

    for (const recipient of recipients) {
      await this.notifications.create({
        userId: recipient,
        type: 'message',
        title: sender.displayName,
        body: input.body?.slice(0, 140) ?? (input.imageUrl ? 'Te envió una foto' : undefined),
        deepLink: `cerquita://chat/${conversationId}`,
      });
    }

    return this.toMessage(created);
  }

  async listConversations(userId: string): Promise<Conversation[]> {
    const rows = await this.prisma.conversation.findMany({
      where: { members: { some: { userId } } },
      orderBy: { updatedAt: 'desc' },
      take: 50,
      include: CONVERSATION_INCLUDE,
    });

    // One query for every listing referenced across the whole list. Resolving
    // them per conversation would be a query per row, and a chat list is the
    // one screen where that cost is guaranteed to be paid every time.
    const listings = await this.listings.summariesByIds(listingIdsOf(rows), userId);

    return Promise.all(rows.map((row) => this.serializeConversation(row, userId, listings)));
  }

  async findOne(conversationId: string, viewerId: string): Promise<Conversation> {
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      include: CONVERSATION_INCLUDE,
    });

    if (!conversation) {
      throw new NotFoundException({ message: 'Conversación no encontrada', code: 'not_found' });
    }

    const listings = await this.listings.summariesByIds(listingIdsOf([conversation]), viewerId);
    return this.serializeConversation(conversation, viewerId, listings);
  }

  /**
   * Turns a conversation row into what the viewer is allowed to see.
   *
   * The listing summary is passed in rather than looked up here: it is resolved
   * for this viewer (so a friend's context card shows the friend price) and
   * batched across the list.
   */
  private async serializeConversation(
    conversation: ConversationRow,
    viewerId: string,
    listings: Map<string, ListingSummary>,
  ): Promise<Conversation> {
    const member = conversation.members.find((entry) => entry.userId === viewerId);
    if (!member) {
      throw new ForbiddenException({
        message: 'No participás de esta conversación',
        code: 'forbidden',
      });
    }

    const unreadCount = await this.prisma.message.count({
      where: {
        conversationId: conversation.id,
        senderId: { not: viewerId },
        ...(member.lastReadAt ? { createdAt: { gt: member.lastReadAt } } : {}),
      },
    });

    const lastMessage = conversation.messages[0];

    return {
      id: conversation.id,
      context: conversation.context ?? undefined,
      contextId: conversation.contextId ?? undefined,
      // The viewer is not shown to themselves in the participant list.
      participants: conversation.members
        .filter((entry) => entry.userId !== viewerId)
        .map((entry) => this.users.toSummary(entry.user)),
      listing: conversation.listingId ? listings.get(conversation.listingId) : undefined,
      lastMessage: lastMessage ? this.toMessage(lastMessage) : undefined,
      unreadCount,
      updatedAt: conversation.updatedAt.toISOString(),
    };
  }

  async listMessages(
    conversationId: string,
    viewerId: string,
    cursor?: string,
    limit = 30,
  ): Promise<Paginated<Message>> {
    const participants = await this.participantIds(conversationId);
    if (!participants.includes(viewerId)) {
      throw new ForbiddenException({
        message: 'No participás de esta conversación',
        code: 'forbidden',
      });
    }

    const rows = await this.prisma.message.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });

    const hasMore = rows.length > limit;
    // Newest-first from the query so the cursor walks backwards through
    // history; reversed for the client, which renders oldest at the top.
    const newestFirst = hasMore ? rows.slice(0, limit) : rows;
    const oldestFirst = [...newestFirst].reverse();

    return {
      items: oldestFirst.map((row) => this.toMessage(row)),
      // The oldest message on this page is where the next page starts.
      nextCursor: hasMore ? (newestFirst[newestFirst.length - 1]?.id ?? null) : null,
    };
  }

  async markRead(conversationId: string, viewerId: string): Promise<{ ok: true }> {
    const updated = await this.prisma.conversationMember.updateMany({
      where: { conversationId, userId: viewerId },
      data: { lastReadAt: new Date() },
    });

    if (updated.count === 0) {
      throw new ForbiddenException({
        message: 'No participás de esta conversación',
        code: 'forbidden',
      });
    }
    return { ok: true };
  }

  async participantIds(conversationId: string): Promise<string[]> {
    const members = await this.prisma.conversationMember.findMany({
      where: { conversationId },
      select: { userId: true },
    });
    return members.map((member) => member.userId);
  }

  /** Blocking severs messaging in both directions. */
  private async assertNotBlocked(a: string, b: string): Promise<void> {
    const block = await this.prisma.block.findFirst({
      where: {
        OR: [
          { blockerId: a, blockedId: b },
          { blockerId: b, blockedId: a },
        ],
      },
      select: { blockerId: true },
    });

    if (block) {
      throw new ForbiddenException({
        message: 'No podés enviar mensajes a esta persona',
        code: 'blocked',
      });
    }
  }

  private toMessage(row: MessageRow): Message {
    return {
      id: row.id,
      conversationId: row.conversationId,
      kind: row.kind as Message['kind'],
      body: row.body ?? undefined,
      imageUrl: row.imageUrl ?? undefined,
      offerId: row.offerId ?? undefined,
      senderId: row.senderId,
      createdAt: row.createdAt.toISOString(),
    };
  }
}
