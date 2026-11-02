import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { ApiModule } from './api.module';
import { configureApi } from './bootstrap/configure-api';

async function bootstrap() {
  const app = await NestFactory.create(ApiModule, { bufferLogs: true });
  const config = app.get(ConfigService);
  const host = config.getOrThrow<string>('API_HOST');
  const port = config.getOrThrow<number>('API_PORT');
  configureApi(app, config);

  await app.listen(port, host);
  Logger.log(`Nuvex Billing API listening on ${host}:${port}`, 'Bootstrap');
}

void bootstrap();
