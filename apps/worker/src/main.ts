import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { WorkerModule } from './worker.module';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(WorkerModule, {
    bufferLogs: true,
  });

  app.enableShutdownHooks();
  app.flushLogs();
  Logger.log('Nuvex Billing Worker started', 'Bootstrap');
}

void bootstrap();
