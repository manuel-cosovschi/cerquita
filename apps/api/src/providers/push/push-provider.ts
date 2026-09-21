import type { NotificationType } from '@cerquita/types';

/** Push delivery abstraction (spec §57). */
export interface PushMessage {
  readonly tokens: string[];
  readonly type: NotificationType;
  readonly title: string;
  readonly body?: string;
  readonly deepLink?: string;
  readonly data?: Record<string, string>;
}

export interface PushResult {
  readonly delivered: number;
  /** Tokens the provider reported as permanently invalid, to be pruned. */
  readonly invalidTokens: string[];
}

export interface PushProvider {
  readonly name: string;
  send(message: PushMessage): Promise<PushResult>;
}

export const PUSH_PROVIDER = Symbol('PUSH_PROVIDER');
