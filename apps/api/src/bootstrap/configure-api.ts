import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Express } from 'express';
import helmet from 'helmet';

export function configureApi(app: INestApplication, config: ConfigService) {
  const corsOrigins = config.getOrThrow<string[]>('CORS_ORIGINS');
  const trustProxyHops = config.getOrThrow<number>('TRUST_PROXY_HOPS');
  const express = app.getHttpAdapter().getInstance() as Express;

  app.setGlobalPrefix('v1');
  app.use(helmet());
  express.disable('x-powered-by');
  if (trustProxyHops > 0) express.set('trust proxy', trustProxyHops);
  if (corsOrigins.length > 0) {
    app.enableCors({
      origin: corsOrigins,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
      allowedHeaders: [
        'Authorization',
        'Content-Type',
        'Idempotency-Key',
        'X-Request-Id',
      ],
      exposedHeaders: ['Location', 'Retry-After', 'X-Request-Id'],
      credentials: false,
      maxAge: 600,
    });
  }
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
      stopAtFirstError: false,
    }),
  );
  app.enableShutdownHooks();
}
