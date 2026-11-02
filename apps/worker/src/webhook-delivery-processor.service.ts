import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SecretCryptoService } from '../../../libs/security/src/secret-crypto.service';
import { WebhookSignatureService } from '../../../libs/webhooks/src/webhook-signature.service';
import { ClaimedWebhookDelivery } from '../../../libs/webhooks/src/webhook.types';
import { WebhookUrlPolicyService } from '../../../libs/webhooks/src/webhook-url-policy.service';
import { WebhookHttpClientService } from '../../../libs/webhooks/src/webhook-http-client.service';
import { WebhookDeliveryRepository } from './webhook-delivery.repository';

@Injectable()
export class WebhookDeliveryProcessorService {
  private readonly logger = new Logger(WebhookDeliveryProcessorService.name);
  private readonly timeoutMs: number;
  private readonly retryBaseMs: number;
  private readonly retryMaxMs: number;

  constructor(
    config: ConfigService,
    private readonly repository: WebhookDeliveryRepository,
    private readonly crypto: SecretCryptoService,
    private readonly signatures: WebhookSignatureService,
    private readonly urlPolicy: WebhookUrlPolicyService,
    private readonly http: WebhookHttpClientService,
  ) {
    this.timeoutMs = config.getOrThrow<number>('WEBHOOK_TIMEOUT_MS');
    this.retryBaseMs = config.getOrThrow<number>('WEBHOOK_RETRY_BASE_MS');
    this.retryMaxMs = config.getOrThrow<number>('WEBHOOK_RETRY_MAX_MS');
  }

  async process(delivery: ClaimedWebhookDelivery, workerId: string) {
    try {
      const url = await this.urlPolicy.assertSafe(delivery.url);
      const body = JSON.stringify(delivery.payload);
      const timestamp = Math.floor(Date.now() / 1_000);
      const secret = this.crypto.decrypt(
        delivery.signingSecretEncrypted,
        `${delivery.applicationId}:webhook:${delivery.endpointId}`,
      );
      const status = await this.http.post(
        url,
        {
          'content-type': 'application/json',
          'user-agent': 'Nuvex-Billing-Webhooks/1.0',
          'x-nuvex-event-id': delivery.eventId,
          'x-nuvex-event': delivery.eventType,
          'x-nuvex-timestamp': String(timestamp),
          'x-nuvex-signature': this.signatures.sign(secret, timestamp, body),
        },
        body,
        this.timeoutMs,
      );
      if (status >= 200 && status < 300) {
        await this.repository.delivered(delivery, workerId, status);
        this.log('webhook.delivered', delivery, { status });
        return;
      }
      await this.fail(delivery, workerId, {
        message: `El endpoint respondió HTTP ${status}`,
        retryable: isRetryableStatus(status),
        httpStatus: status,
      });
    } catch (error) {
      await this.fail(delivery, workerId, {
        message: safeMessage(error),
        retryable: !(error instanceof BadRequestException),
      });
    }
  }

  private async fail(
    delivery: ClaimedWebhookDelivery,
    workerId: string,
    failure: { message: string; retryable: boolean; httpStatus?: number },
  ) {
    const delay = webhookRetryDelay(
      delivery.attempts,
      this.retryBaseMs,
      this.retryMaxMs,
    );
    const result = await this.repository.failed(
      delivery,
      workerId,
      failure,
      new Date(Date.now() + delay),
    );
    if (!result.owned) return;
    this.log(
      result.dead ? 'webhook.dead' : 'webhook.retry_scheduled',
      delivery,
      {
        status: failure.httpStatus ?? null,
        retryInMs: result.dead ? null : delay,
      },
    );
  }

  private log(
    event: string,
    delivery: ClaimedWebhookDelivery,
    data: Record<string, unknown>,
  ) {
    this.logger.log(
      JSON.stringify({
        event,
        deliveryId: delivery.id,
        eventId: delivery.eventId,
        endpointId: delivery.endpointId,
        attempt: delivery.attempts,
        ...data,
      }),
    );
  }
}

export function isRetryableStatus(status: number) {
  return [408, 409, 425, 429].includes(status) || status >= 500;
}

export function webhookRetryDelay(
  attempt: number,
  baseMs: number,
  maximumMs: number,
  random = Math.random,
) {
  const exponential = Math.min(
    maximumMs,
    baseMs * 2 ** Math.max(0, attempt - 1),
  );
  return Math.min(
    maximumMs,
    Math.max(baseMs, Math.round(exponential * (0.75 + random() * 0.5))),
  );
}

function safeMessage(error: unknown) {
  return (error instanceof Error ? error.message : 'Error desconocido')
    .replace(/[\r\n\t]+/g, ' ')
    .slice(0, 1_000);
}
