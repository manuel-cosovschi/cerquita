import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { loadConfig } from './config/configuration';
import { HttpExceptionFilter } from './common/http-exception.filter';

async function bootstrap(): Promise<void> {
  const config = loadConfig();
  const logger = new Logger('Bootstrap');

  const app = await NestFactory.create(AppModule, {
    logger: config.isProduction
      ? ['error', 'warn', 'log']
      : ['error', 'warn', 'log', 'debug', 'verbose'],
  });

  app.setGlobalPrefix(config.API_PREFIX);
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
