import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { loadConfig } from './config/configuration';
import { HttpExceptionFilter } from './common/http-exception.filter';

async function bootstrap(): Promise<void> {
  const config = loadConfig();
  const logger = new Logger('Bootstrap');

  // Typed as the Express adapter so static assets can be mounted below.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: config.isProduction
      ? ['error', 'warn', 'log']
      : ['error', 'warn', 'log', 'debug', 'verbose'],
  });

  app.setGlobalPrefix(config.API_PREFIX);

  // Local uploads are served straight off disk, outside the API prefix so the
  // URLs the storage provider hands out resolve. This exists so image upload
  // works with no cloud credentials (spec §89); with STORAGE_PROVIDER=s3 the
  // provider returns bucket URLs and nothing is mounted here.
  if (config.STORAGE_PROVIDER === 'local') {
    const { join } = await import('node:path');
    const { existsSync, mkdirSync } = await import('node:fs');
    const root = join(process.cwd(), config.LOCAL_STORAGE_DIR);
    if (!existsSync(root)) mkdirSync(root, { recursive: true });

    app.useStaticAssets(root, {
      prefix: '/assets/',
      // Uploads are immutable — the key is a fresh UUID on every upload, so a
      // URL never points at different bytes than it did before.
      maxAge: '1y',
      immutable: true,
      index: false,
      dotfiles: 'deny',
    });
  }
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.enableCors({ origin: config.corsOrigins, credentials: true });
  app.useGlobalFilters(new HttpExceptionFilter());
  app.enableShutdownHooks();

  await app.listen(config.PORT);

  logger.log(`Cerquita API on http://localhost:${config.PORT}/${config.API_PREFIX}`);
  logger.log(
    `Providers — payments: ${config.PAYMENT_PROVIDER}, ai: ${config.AI_PROVIDER}, storage: ${config.STORAGE_PROVIDER}, push: ${config.PUSH_PROVIDER}`,
  );
}

void bootstrap();
