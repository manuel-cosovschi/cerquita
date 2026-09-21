import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import type { Conversation, Message, Paginated } from '@cerquita/types';
import { sendMessageSchema, startConversationSchema } from '@cerquita/validation';
import { ChatService, type SendMessageInput } from './chat.service';
import { ChatGateway } from './chat.gateway';
import { zodBody } from '../../common/zod-validation.pipe';
import { CurrentUser, type AuthenticatedUser } from '../../common/current-user.decorator';

@Controller('conversations')
export class ChatController {
  constructor(
    private readonly chat: ChatService,
    private readonly gateway: ChatGateway,
  ) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser): Promise<Conversation[]> {
    return this.chat.listConversations(user.userId);
  }

  @Post()
  start(
    @Body(zodBody(startConversationSchema))
    body: { recipientId: string; listingId?: string; firstMessage?: string },
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<Conversation> {
    return this.chat.startConversation({ actorId: user.userId, ...body });
  }

  @Get(':id')
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<Conversation> {
    return this.chat.findOne(id, user.userId);
  }

  @Get(':id/messages')
  messages(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Query('cursor') cursor?: string,
  ): Promise<Paginated<Message>> {
    return this.chat.listMessages(id, user.userId, cursor);
  }

  @Post(':id/messages')
  async send(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(sendMessageSchema)) body: SendMessageInput,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<Message> {
    const message = await this.chat.sendMessage(id, user.userId, body);

    // Delivered over HTTP, broadcast over the socket. Sending through the socket
    // instead would bypass the guard and validation this route already applies.
    const participants = await this.chat.participantIds(id);
    this.gateway.broadcastMessage(id, participants, message);

    return message;
  }

  @Post(':id/read')
  markRead(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<{ ok: true }> {
    return this.chat.markRead(id, user.userId);
  }
}
