import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type {
  CreatePaymentInput,
  PaymentIntent,
  PaymentProvider,
  RefundInput,
  RefundResult,
  WebhookResult,
} from './payment-provider';

/**
 * Development payment provider.
 *
 * Succeeds immediately so the whole purchase flow — cart, checkout, order
 * lifecycle, reviews — is exercisable with no credentials (spec §89). It keeps
 * intents in memory; restarting the API clears them, which is fine for its
 * purpose and a reason it refuses to load in production.
 */
@Injectable()
export class MockPaymentProvider implements PaymentProvider {
  readonly name = 'mock';
  private readonly logger = new Logger(MockPaymentProvider.name);
  private readonly intents = new Map<string, PaymentIntent>();

  async createPayment(input: CreatePaymentInput): Promise<PaymentIntent> {
    const intent: PaymentIntent = {
      id: randomUUID(),
      provider: this.name,
      status: 'captured',
      amount: input.amount,
      providerRef: `mock_${input.orderReference}`,
    };

    this.intents.set(intent.providerRef!, intent);
    this.logger.log(
      `Mock payment captured for order ${input.orderReference}: ${input.amount.amount} ${input.amount.currency}`,
    );
    return intent;
  }

  async capture(providerRef: string): Promise<PaymentIntent> {
    return this.transition(providerRef, 'captured');
  }

  async cancel(providerRef: string): Promise<PaymentIntent> {
    return this.transition(providerRef, 'cancelled');
  }

  async refund(input: RefundInput): Promise<RefundResult> {
    this.logger.log(`Mock refund of ${input.amount.amount}: ${input.reason}`);
    return { id: randomUUID(), status: 'refunded', amount: input.amount };
  }

  async handleWebhook(payload: unknown): Promise<WebhookResult> {
    const body = (payload ?? {}) as { orderId?: string; providerRef?: string };
    return {
      orderId: body.orderId,
      providerRef: body.providerRef ?? 'mock_unknown',
      status: 'captured',
    };
  }

  private transition(providerRef: string, status: PaymentIntent['status']): PaymentIntent {
    const existing = this.intents.get(providerRef);
    const intent: PaymentIntent = existing
      ? { ...existing, status }
      : {
          id: randomUUID(),
          provider: this.name,
          status,
          amount: { amount: 0, currency: 'ARS' },
          providerRef,
        };
    this.intents.set(providerRef, intent);
    return intent;
  }
}
