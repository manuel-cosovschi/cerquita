import { Injectable, Logger } from '@nestjs/common';
import type { PushMessage, PushProvider, PushResult } from './push-provider';

/**
 * Logs push notifications instead of delivering them.
 *
 * In-app notifications are written to the database regardless of this provider,
 * so the notification feature is fully testable without push credentials — only
 * the device delivery is stubbed.
 */
@Injectable()
export class MockPushProvider implements PushProvider {
  readonly name = 'mock';
  private readonly logger = new Logger(MockPushProvider.name);

  async send(message: PushMessage): Promise<PushResult> {
    this.logger.log(
      `[push:${message.type}] "${message.title}" -> ${message.tokens.length} device(s)`,
    );
    return { delivered: message.tokens.length, invalidTokens: [] };
  }
}
