import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Environment } from '@prisma/client';
import { PrismaService } from '../../../../libs/database/src/prisma.service';
import { SecretCryptoService } from '../../../../libs/security/src/secret-crypto.service';
import { CertificateInspectorService } from './certificate-inspector.service';
import { PrivateObjectStorageService } from '../../../../libs/storage/src/private-object-storage.service';
import { SunatCredentialsService } from './sunat-credentials.service';

describe('SunatCredentialsService', () => {
  const context = { requestId: 'request-id', ip: '127.0.0.1' };

  function setup(current: Record<string, unknown> | null = null) {
    let persisted: Record<string, unknown> = {};
    const tx = {
      taxCredential: {
        upsert: jest.fn(
          (args: {
            create: Record<string, unknown>;
            update: Record<string, unknown>;
          }) => {
            persisted = current
              ? { ...current, ...args.update }
              : { ...args.create };
            return Promise.resolve({
              id: 'credential-id',
              tenantId: 'tenant-id',
              environment: Environment.BETA,
              active: false,
              createdAt: new Date(),
              updatedAt: new Date(),
              ...persisted,
            });
          },
        ),
      },
      auditEvent: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      tenant: { findUnique: jest.fn().mockResolvedValue({ id: 'tenant-id' }) },
      taxCredential: { findUnique: jest.fn().mockResolvedValue(current) },
      $transaction: jest.fn(
        (callback: (client: typeof tx) => Promise<unknown>) => callback(tx),
      ),
    } as unknown as PrismaService;
    const crypto = new SecretCryptoService(
      new ConfigService({
        SECRETS_ENCRYPTION_KEY: Buffer.alloc(32, 9).toString('base64'),
      }),
    );
    const service = new SunatCredentialsService(
      prisma,
      crypto,
      {} as PrivateObjectStorageService,
      {} as CertificateInspectorService,
    );
    return { service, getPersisted: () => persisted };
  }

  it('encrypts SOL credentials and never returns their plaintext', async () => {
    const { service, getPersisted } = setup();
    const result = await service.update(
      'tenant-id',
      Environment.BETA,
      { solUsername: 'MODDATOS', solPassword: 'plain-secret' },
      context,
    );

    expect(getPersisted().solUsernameEncrypted).not.toBe('MODDATOS');
    expect(getPersisted().solPasswordEncrypted).not.toBe('plain-secret');
    expect(JSON.stringify(result)).not.toContain('MODDATOS');
    expect(JSON.stringify(result)).not.toContain('plain-secret');
    expect(result.solUsernameConfigured).toBe(true);
  });

  it('does not activate an incomplete SUNAT configuration', async () => {
    const { service } = setup();
    await expect(
      service.update('tenant-id', Environment.BETA, { active: true }, context),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
