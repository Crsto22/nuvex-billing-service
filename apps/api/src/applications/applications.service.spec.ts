import { ConfigService } from '@nestjs/config';
import { Environment } from '@prisma/client';
import { PrismaService } from '../../../../libs/database/src/prisma.service';
import { TokenHashService } from '../../../../libs/security/src/token-hash.service';
import { ApplicationsService } from './applications.service';

describe('ApplicationsService', () => {
  it('returns an API key once and persists only its HMAC', async () => {
    const createdAt = new Date();
    const createApiKey = jest.fn((args: { data: Record<string, unknown> }) =>
      Promise.resolve({
        id: 'key-id',
        name: args.data.name as string,
        prefix: args.data.prefix as string,
        environment: args.data.environment as Environment,
        scopes: args.data.scopes as string[],
        expiresAt: null,
        createdAt,
      }),
    );
    const transactionClient = {
      apiKey: { create: createApiKey },
      auditEvent: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      application: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'application-id',
          tenantId: 'tenant-id',
          status: 'ACTIVE',
          tenant: { status: 'ACTIVE' },
        }),
      },
      $transaction: jest.fn(
        (callback: (tx: typeof transactionClient) => Promise<unknown>) =>
          callback(transactionClient),
      ),
    } as unknown as PrismaService;
    const tokenHash = new TokenHashService(
      new ConfigService({
        API_KEY_PEPPER: 'unit-test-pepper-with-at-least-32-characters',
      }),
    );
    const service = new ApplicationsService(prisma, tokenHash);

    const result = await service.createApiKey(
      'application-id',
      {
        name: 'Nuvex beta',
        environment: Environment.BETA,
        scopes: ['documents:write', 'documents:read'],
      },
      { requestId: 'request-id', ip: '127.0.0.1' },
    );

    const persisted = createApiKey.mock.calls[0][0].data;
    expect(result.apiKey).toMatch(/^nb_test_[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(persisted.secretHash).toBe(tokenHash.hash(result.apiKey));
    expect(JSON.stringify(persisted)).not.toContain(result.apiKey);
    expect(result.scopes).toEqual(['documents:read', 'documents:write']);
  });
});
