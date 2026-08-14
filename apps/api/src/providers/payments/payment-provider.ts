import type { MoneyDto } from '@cerquita/types';

/**
 * Payment provider abstraction (spec §43, §44).
 *
 * The domain never imports a payment SDK. It talks to this interface, so
 * Mercado Pago, Stripe and the mock are interchangeable and the order lifecycle
 * is written once.
 *
 * On marketplace settlement: this interface models the STATES a marketplace
 * payment moves through (charge, hold, commission, payout, refund) without
 * asserting how the money is actually held. Real escrow is a regulated
 * arrangement that differs per provider and jurisdiction; inventing one here
 * would be worse than leaving the seam explicit.
 */
export interface PaymentIntent {
  readonly id: string;
  readonly provider: string;
  readonly status: PaymentIntentStatus;
  readonly amount: MoneyDto;
  /** Where to send the buyer to complete payment, when the provider needs it. */
  readonly checkoutUrl?: string;
  readonly providerRef?: string;
}

export type PaymentIntentStatus =
  | 'requires_action'
  | 'pending'
  | 'authorized'
  | 'captured'
  | 'failed'
  | 'cancelled';

export interface CreatePaymentInput {
  readonly orderId: string;
  readonly orderReference: string;
  readonly amount: MoneyDto;
  readonly buyerId: string;
  readonly sellerId: string;
  /** Marketplace commission, for providers that support split payments. */
  readonly platformFee: MoneyDto;
  readonly description: string;
  readonly returnUrl?: string;
}

export interface RefundInput {
  readonly paymentId: string;
  readonly providerRef?: string;
  readonly amount: MoneyDto;
  readonly reason: string;
}

export interface RefundResult {
  readonly id: string;
  readonly status: 'refunded' | 'partially_refunded' | 'failed';
  readonly amount: MoneyDto;
}

export interface WebhookResult {
  readonly orderId?: string;
  readonly providerRef: string;
  readonly status: PaymentIntentStatus;
}

export interface PaymentProvider {
  readonly name: string;
  createPayment(input: CreatePaymentInput): Promise<PaymentIntent>;
  capture(providerRef: string): Promise<PaymentIntent>;
  cancel(providerRef: string): Promise<PaymentIntent>;
  refund(input: RefundInput): Promise<RefundResult>;
  /**
   * Parses and verifies a provider webhook. Implementations MUST validate the
   * signature; returning a result for an unverified payload would let anyone
   * mark an order paid.
   */
  handleWebhook(payload: unknown, signature?: string): Promise<WebhookResult>;
}

export const PAYMENT_PROVIDER = Symbol('PAYMENT_PROVIDER');
