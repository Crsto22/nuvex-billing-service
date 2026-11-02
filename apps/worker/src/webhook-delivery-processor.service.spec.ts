import { ConfigService } from '@nestjs/config';
import { SecretCryptoService } from '../../../libs/security/src/secret-crypto.service';
import { WebhookSignatureService } from '../../../libs/webhooks/src/webhook-signature.service';
import { WebhookUrlPolicyService } from '../../../libs/webhooks/src/webhook-url-policy.service';
import {
  WebhookDeliveryProcessorService,
  isRetryableStatus,
  webhookRetryDelay,
} from './webhook-delivery-processor.service';
import { WebhookDeliveryRepository } from './webhook-delivery.repository';

describe('WebhookDeliveryProcessorService', () => {
  it('envía JSON firmado y confirma una respuesta 2xx', async () => {
    const repository = {
      delivered: jest.fn().mockResolvedValue(true),
      failed: jest.fn(),
    };
    const signatures = new WebhookSignatureService();
    const http = { post: jest.fn().mockResolvedValue(204) };
    const service = new WebhookDeliveryProcessorService(
      config(),
      repository as unknown as WebhookDeliveryRepository,
      {
        decrypt: jest.fn().mockReturnValue('whsec_test'),
      } as unknown as SecretCryptoService,
      signatures,
      {
        assertSafe: jest
          .fn()
          .mockResolvedValue(new URL('https://hooks.example.com/')),
      } as unknown as WebhookUrlPolicyService,
      http,
    );

    await service.process(delivery(), 'worker-1');

    expect(repository.delivered).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'delivery-1' }),
      'worker-1',
      204,
    );
    const request = http.post.mock.calls[0] as unknown as [
      URL,
      Record<string, string>,
      string,
      number,
    ];
    const headers = request[1];
    expect(headers['x-nuvex-signature']).toMatch(/^v1=[a-f0-9]{64}$/);
    expect(headers['x-nuvex-event-id']).toBe('event-1');
    expect(request[0].toString()).toBe('https://hooks.example.com/');
    expect(request[3]).toBe(10_000);
  });
});

describe('política de reintento webhook', () => {
  it('reintenta límites y errores temporales, no otros 4xx', () => {
    expect(isRetryableStatus(429)).toBe(true);
    expect(isRetryableStatus(503)).toBe(true);
    expect(isRetryableStatus(400)).toBe(false);
    expect(isRetryableStatus(302)).toBe(false);
  });

  it('aplica backoff exponencial con límite', () => {
    expect(webhookRetryDelay(1, 10_000, 600_000, () => 0.5)).toBe(10_000);
    expect(webhookRetryDelay(20, 10_000, 600_000, () => 1)).toBe(600_000);
  });
});

function config() {
  return {
    getOrThrow: jest.fn((key: string) =>
      key === 'WEBHOOK_TIMEOUT_MS'
        ? 10_000
        : key === 'WEBHOOK_RETRY_BASE_MS'
          ? 10_000
          : 600_000,
    ),
  } as unknown as ConfigService;
}

function delivery() {
  return {
    id: 'delivery-1',
    eventId: 'event-1',
    endpointId: 'endpoint-1',
    applicationId: 'application-1',
    url: 'https://hooks.example.com/',
    signingSecretEncrypted: 'encrypted',
    eventType: 'document.accepted' as const,
    payload: { id: 'event-1', type: 'document.accepted' },
    attempts: 1,
    maxAttempts: 10,
  };
}
