import { Module } from '@nestjs/common';
import { WebhooksModule } from '../../../../libs/webhooks/src/webhooks.module';
import { WebhookEndpointsController } from './webhook-endpoints.controller';
import { WebhookEndpointsService } from './webhook-endpoints.service';

@Module({
  imports: [WebhooksModule],
  controllers: [WebhookEndpointsController],
  providers: [WebhookEndpointsService],
})
export class WebhooksApiModule {}
