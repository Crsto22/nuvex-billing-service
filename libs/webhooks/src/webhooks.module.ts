import { Global, Module } from '@nestjs/common';
import { WebhookEventPublisherService } from './webhook-event-publisher.service';
import { WebhookSignatureService } from './webhook-signature.service';
import { WebhookUrlPolicyService } from './webhook-url-policy.service';
import { WebhookHttpClientService } from './webhook-http-client.service';

@Global()
@Module({
  providers: [
    WebhookEventPublisherService,
    WebhookSignatureService,
    WebhookUrlPolicyService,
    WebhookHttpClientService,
  ],
  exports: [
    WebhookEventPublisherService,
    WebhookSignatureService,
    WebhookUrlPolicyService,
    WebhookHttpClientService,
  ],
})
export class WebhooksModule {}
