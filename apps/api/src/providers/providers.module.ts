import { Global, Logger, Module } from '@nestjs/common';
import { loadConfig } from '../config/configuration';
import { PAYMENT_PROVIDER, type PaymentProvider } from './payments/payment-provider';
import { MockPaymentProvider } from './payments/mock-payment.provider';
import { MercadoPagoPaymentProvider } from './payments/mercadopago-payment.provider';
import { AI_PROVIDER, type AiProvider } from './ai/ai-provider';
import { MockAiProvider } from './ai/mock-ai.provider';
import { STORAGE_PROVIDER, type StorageProvider } from './storage/storage-provider';
import { LocalStorageProvider } from './storage/local-storage.provider';
import { PUSH_PROVIDER, type PushProvider } from './push/push-provider';
import { MockPushProvider } from './push/mock-push.provider';

/**
 * Binds every external integration behind its interface.
 *
 * Selection is driven by environment variables, and every one of them has a
 * working mock, so `pnpm dev` needs no third-party credentials at all
 * (spec §89, §127).
 *
 * Production refuses to start on a mock provider: shipping a build that
 * cheerfully "captures" payments without moving money is the kind of mistake
 * that must fail loudly at boot.
 */
@Global()
@Module({
  providers: [
    {
      provide: PAYMENT_PROVIDER,
      useFactory: (): PaymentProvider => {
        const config = loadConfig();
        const logger = new Logger('PaymentProvider');

        switch (config.PAYMENT_PROVIDER) {
          case 'mercadopago':
            logger.log('Using Mercado Pago');
            return new MercadoPagoPaymentProvider(config.MERCADOPAGO_ACCESS_TOKEN!);
          case 'stripe':
            throw new Error(
              'PAYMENT_PROVIDER=stripe is declared but not implemented. Use mercadopago or mock, or add a StripePaymentProvider.',
            );
          case 'mock':
          default:
            assertNotProduction(config.isProduction, 'PAYMENT_PROVIDER=mock');
            logger.warn('Using the MOCK payment provider — no real money moves');
            return new MockPaymentProvider();
        }
      },
    },
    {
      provide: AI_PROVIDER,
      useFactory: (): AiProvider => {
        // The mock is a genuine rule-based parser, so AI search degrades rather
        // than disappearing when no key is configured.
        return new MockAiProvider();
      },
    },
    {
      provide: STORAGE_PROVIDER,
      useFactory: (): StorageProvider => {
        const config = loadConfig();
        if (config.STORAGE_PROVIDER === 's3') {
          throw new Error(
            'STORAGE_PROVIDER=s3 is declared but not implemented. Add an S3StorageProvider or use local.',
          );
        }
        assertNotProduction(config.isProduction, 'STORAGE_PROVIDER=local');
        return new LocalStorageProvider(config.LOCAL_STORAGE_DIR, config.PUBLIC_ASSET_BASE_URL);
      },
    },
    {
      provide: PUSH_PROVIDER,
      useFactory: (): PushProvider => new MockPushProvider(),
    },
  ],
  exports: [PAYMENT_PROVIDER, AI_PROVIDER, STORAGE_PROVIDER, PUSH_PROVIDER],
})
export class ProvidersModule {}

function assertNotProduction(isProduction: boolean, setting: string): void {
  if (isProduction) {
    throw new Error(
      `${setting} is not allowed when NODE_ENV=production. Configure a real provider before deploying.`,
    );
  }
}
