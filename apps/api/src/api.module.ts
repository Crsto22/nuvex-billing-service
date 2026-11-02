import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { BillingConfigModule } from '../../../libs/config/src/billing-config.module';
import { DatabaseModule } from '../../../libs/database/src/database.module';
import { SecurityModule } from '../../../libs/security/src/security.module';
import { ApplicationsModule } from './applications/applications.module';
import { AuthModule } from './auth/auth.module';
import { AuthenticationGuard } from './auth/authentication.guard';
import { ScopeGuard } from './auth/scope.guard';
import { ProblemDetailsFilter } from './common/problem-details.filter';
import { RequestIdMiddleware } from './common/request-id.middleware';
import { HealthController } from './health/health.controller';
import { DocumentsModule } from './documents/documents.module';
import { TenantsModule } from './tenants/tenants.module';
import { SunatCredentialsModule } from './sunat-credentials/sunat-credentials.module';
import { WebhooksApiModule } from './webhooks/webhooks-api.module';
import { NotesModule } from './notes/notes.module';
import { DespatchGuidesModule } from './despatch-guides/despatch-guides.module';
import { VoidRequestsModule } from './void-requests/void-requests.module';

@Module({
  imports: [
    BillingConfigModule,
    DatabaseModule,
    SecurityModule,
    AuthModule,
    TenantsModule,
    ApplicationsModule,
    SunatCredentialsModule,
    DocumentsModule,
    NotesModule,
    DespatchGuidesModule,
    VoidRequestsModule,
    WebhooksApiModule,
    ThrottlerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => [
        {
          ttl: config.getOrThrow<number>('RATE_LIMIT_TTL_MS'),
          limit: config.getOrThrow<number>('RATE_LIMIT_LIMIT'),
        },
      ],
    }),
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: AuthenticationGuard },
    { provide: APP_GUARD, useClass: ScopeGuard },
    { provide: APP_FILTER, useClass: ProblemDetailsFilter },
  ],
})
export class ApiModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RequestIdMiddleware).forRoutes('*');
  }
}
