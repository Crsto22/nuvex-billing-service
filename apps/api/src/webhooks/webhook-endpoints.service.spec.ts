import { Environment } from '@prisma/client';
import { PrismaService } from '../../../../libs/database/src/prisma.service';
import { SecretCryptoService } from '../../../../libs/security/src/secret-crypto.service';
import { WebhookUrlPolicyService } from '../../../../libs/webhooks/src/webhook-url-policy.service';
import type { ApplicationPrincipal } from '../auth/auth.types';
import { WebhookEndpointsService } from './webhook-endpoints.service';

describe('WebhookEndpointsService', () => {
  const principal: ApplicationPrincipal = {
    type: 'API_KEY',
    apiKeyId: 'key-1',
    applicationId: 'app-1',
    tenantId: 'tenant-1',
    environment: Environment.BETA,
    scopes: ['webhooks:manage'],
  };

  it('crea un endpoint aislado por ambiente y devuelve el secreto una vez', async () => {
    const now = new Date('2026-11-01T12:00:00.000Z');
    const tx = {
      webhookEndpoint: {
        create: jest.fn().mockResolvedValue({
          id: 'endpoint-1',
          environment: Environment.BETA,
          url: 'https://hooks.example.com/nuvex',
          eventTypes: ['document.accepted'],
          active: true,
          createdAt: now,
          updatedAt: now,
        }),
      },
      auditEvent: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      $transaction: jest.fn((callback: (client: typeof tx) => unknown) =>
        callback(tx),
      ),
    };
    const crypto = { encrypt: jest.fn().mockReturnValue('encrypted') };
    const policy = {
      assertSafe: jest
        .fn()
        .mockResolvedValue(new URL('https://hooks.example.com/nuvex')),
    };
    const service = new WebhookEndpointsService(
      prisma as unknown as PrismaService,
      crypto as unknown as SecretCryptoService,
      policy as unknown as WebhookUrlPolicyService,
    );

    const result = await service.create(
      {
        url: 'https://hooks.example.com/nuvex',
        events: ['document.accepted'],
      },
      principal,
    );

    expect(result).toMatchObject({
      environment: Environment.BETA,
      events: ['document.accepted'],
      active: true,
    });
    expect(result.signingSecret).toMatch(/^whsec_[A-Za-z0-9_-]{43}$/);
    expect(crypto.encrypt).toHaveBeenCalledWith(
      expect.stringMatching(/^whsec_/),
      expect.stringMatching(/^app-1:webhook:/),
    );
  });

  it('lista solo el ambiente autenticado y nunca expone el secreto', async () => {
    const now = new Date('2026-11-01T12:00:00.000Z');
    const prisma = {
      webhookEndpoint: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'endpoint-1',
            environment: Environment.BETA,
            url: 'https://hooks.example.com/',
            eventTypes: ['document.failed'],
            active: true,
            createdAt: now,
            updatedAt: now,
          },
        ]),
      },
    };
    const service = new WebhookEndpointsService(
      prisma as unknown as PrismaService,
      {} as SecretCryptoService,
      {} as WebhookUrlPolicyService,
    );

    const result = await service.list(principal);

    expect(prisma.webhookEndpoint.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          applicationId: 'app-1',
          environment: Environment.BETA,
        },
      }),
    );
    expect(result[0]).not.toHaveProperty('signingSecret');
    expect(result[0]).toMatchObject({ events: ['document.failed'] });
  });
});
