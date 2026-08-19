import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import type {
  CreatePaymentInput,
  PaymentIntent,
  PaymentProvider,
  RefundInput,
  RefundResult,
  WebhookResult,
} from './payment-provider';

/**
 * Mercado Pago provider — the priority integration for Argentina (spec §43).
 *
 * This is a real HTTP client against the Checkout Pro API, wired to the same
 * interface as the mock. It activates only when `PAYMENT_PROVIDER=mercadopago`
 * AND `MERCADOPAGO_ACCESS_TOKEN` is set; the config loader refuses to boot
 * otherwise, so it can never silently no-op.
 *
 * What is deliberately NOT implemented here: marketplace split settlement.
 * Mercado Pago exposes it through `application_fee` on a marketplace
 * application, which requires an approved marketplace account and an OAuth
 * onboarding flow for each seller. Wiring that requires credentials and a legal
 * arrangement that do not exist yet, so `platformFee` is carried through to the
 * order record and the seller payout is computed by the domain — the money
 * movement is the piece left to connect. See docs/api.md.
 */
@Injectable()
export class MercadoPagoPaymentProvider implements PaymentProvider {
  readonly name = 'mercadopago';
  private readonly logger = new Logger(MercadoPagoPaymentProvider.name);
  private readonly baseUrl = 'https://api.mercadopago.com';

  constructor(private readonly accessToken: string) {}

  async createPayment(input: CreatePaymentInput): Promise<PaymentIntent> {
    const body = {
      external_reference: input.orderReference,
      items: [
        {
          id: input.orderId,
          title: input.description,
          quantity: 1,
          currency_id: input.amount.currency,
          // Mercado Pago takes major units; our amounts are minor units.
          unit_price: input.amount.amount / 100,
        },
      ],
      back_urls: input.returnUrl
        ? { success: input.returnUrl, failure: input.returnUrl }
        : undefined,
      auto_return: input.returnUrl ? 'approved' : undefined,
    };

    const response = await this.request('/checkout/preferences', 'POST', body);
    const preference = response as { id: string; init_point?: string };

    return {
      id: preference.id,
      provider: this.name,
      status: 'requires_action',
      amount: input.amount,
      checkoutUrl: preference.init_point,
      providerRef: preference.id,
    };
  }

  async capture(providerRef: string): Promise<PaymentIntent> {
    const payment = (await this.request(`/v1/payments/${providerRef}`, 'GET')) as {
      status: string;
      transaction_amount: number;
      currency_id: string;
    };

    return {
      id: providerRef,
      provider: this.name,
      status: mapStatus(payment.status),
      amount: {
        amount: Math.round(payment.transaction_amount * 100),
        currency: payment.currency_id as 'ARS',
      },
      providerRef,
    };
  }

  async cancel(providerRef: string): Promise<PaymentIntent> {
    await this.request(`/v1/payments/${providerRef}`, 'PUT', { status: 'cancelled' });
    return {
      id: providerRef,
      provider: this.name,
      status: 'cancelled',
      amount: { amount: 0, currency: 'ARS' },
      providerRef,
    };
  }

  async refund(input: RefundInput): Promise<RefundResult> {
    const response = (await this.request(`/v1/payments/${input.providerRef}/refunds`, 'POST', {
      amount: input.amount.amount / 100,
    })) as { id: string; status: string };

    return {
      id: String(response.id),
      status: response.status === 'approved' ? 'refunded' : 'failed',
      amount: input.amount,
    };
  }

  async handleWebhook(payload: unknown): Promise<WebhookResult> {
    const body = payload as { data?: { id?: string }; type?: string };
    const paymentId = body?.data?.id;

    if (!paymentId) {
      throw new ServiceUnavailableException({
        message: 'Webhook sin identificador de pago',
        code: 'invalid_webhook',
      });
    }

    const intent = await this.capture(String(paymentId));
    return { providerRef: intent.providerRef!, status: intent.status };
  }

  private async request(path: string, method: string, body?: unknown): Promise<unknown> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${this.accessToken}`,
        'content-type': 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      this.logger.error(`Mercado Pago ${method} ${path} -> ${response.status}: ${detail}`);
      throw new ServiceUnavailableException({
        message: 'No pudimos procesar el pago. Probá de nuevo.',
        code: 'payment_provider_error',
      });
    }

    return response.json();
  }
}

function mapStatus(status: string): PaymentIntent['status'] {
  switch (status) {
    case 'approved':
      return 'captured';
    case 'authorized':
    case 'in_process':
      return 'authorized';
    case 'pending':
      return 'pending';
    case 'cancelled':
      return 'cancelled';
    default:
      return 'failed';
  }
}
