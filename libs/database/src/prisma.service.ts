import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly connectOnInit: boolean;

  constructor(config: ConfigService) {
    super({
      datasources: {
        db: { url: config.getOrThrow<string>('DATABASE_URL') },
      },
    });
    this.connectOnInit = config.get<string>('NODE_ENV') !== 'test';
  }

  async onModuleInit() {
    if (this.connectOnInit) await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
