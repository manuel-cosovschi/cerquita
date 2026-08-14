import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import type { Server, Socket } from 'socket.io';
import type { Message } from '@cerquita/types';
import { AuthService } from '../auth/auth.service';
import { loadConfig } from '../../config/configuration';

/**
 * Realtime message delivery (spec §35).
 *
 * Read-only, like the auction gateway: messages are POSTed over HTTP so they go
 * through the same guard, validation and idempotency handling, and the socket
 * only carries what the server already accepted.
 *
 * Sockets authenticate on connect and are placed in a room keyed by the user id.
 * Broadcasting to participants therefore never requires trusting a room name the
 * client asked to join — a client cannot subscribe to someone else's messages.
 */
@WebSocketGateway({
  namespace: '/chat',
  cors: { origin: loadConfig().corsOrigins, credentials: true },
})
export class ChatGateway implements OnGatewayConnection {
  private readonly logger = new Logger(ChatGateway.name);

  @WebSocketServer()
  private server!: Server;

  constructor(private readonly auth: AuthService) {}

  async handleConnection(client: Socket): Promise<void> {
    const token =
      (client.handshake.auth as { token?: string } | undefined)?.token ??
      extractBearer(client.handshake.headers.authorization);

    if (!token) {
      client.disconnect(true);
      return;
    }

    try {
      const claims = this.auth.verifyAccessToken(token);
      const identity = await this.auth.resolveIdentity(claims.sub);
      if (!identity) {
        client.disconnect(true);
        return;
      }

      client.data.userId = identity.userId;
      await client.join(userRoom(identity.userId));
    } catch {
      client.disconnect(true);
    }
  }

  /** Lets a client signal it is looking at a thread, for typing indicators. */
  @SubscribeMessage('typing')
  typing(
    @MessageBody() conversationId: string,
    @ConnectedSocket() client: Socket,
  ): void {
    const userId = client.data.userId as string | undefined;
    if (!userId || typeof conversationId !== 'string') return;

    client.broadcast.emit('typing', { conversationId, userId });
  }

  broadcastMessage(conversationId: string, participantIds: string[], message: Message): void {
    for (const participantId of participantIds) {
      this.server?.to(userRoom(participantId)).emit('message', { conversationId, message });
    }
  }
}

const userRoom = (userId: string): string => `user:${userId}`;

function extractBearer(header?: string): string | undefined {
  if (!header) return undefined;
  const [scheme, value] = header.split(' ');
  return scheme?.toLowerCase() === 'bearer' && value ? value : undefined;
}
