import { NotFoundException } from '@nestjs/common';
import { Environment } from '@prisma/client';
import { PrismaService } from '../../../../libs/database/src/prisma.service';
import { PrivateObjectStorageService } from '../../../../libs/storage/src/private-object-storage.service';
import type { ApplicationPrincipal } from '../auth/auth.types';
import { ArtifactDownloadService } from './artifact-download.service';

describe('ArtifactDownloadService', () => {
  const principal: ApplicationPrincipal = {
    type: 'API_KEY',
    apiKeyId: 'key-1',
    applicationId: 'app-1',
    tenantId: 'tenant-1',
    environment: Environment.BETA,
    scopes: ['documents:read'],
  };
  const createdAt = new Date('2026-11-01T12:00:00.000Z');
  const artifact = {
    type: 'CDR',
    fileName: 'R-document.zip',
    objectKey: 'private/cdr.zip',
    contentType: 'application/zip',
    sizeBytes: 123,
    sha256: 'a'.repeat(64),
    createdAt,
  };

  it('lista metadatos dentro del ámbito autenticado sin exponer objectKey', async () => {
    const prisma = {
      taxDocument: {
        findFirst: jest.fn().mockResolvedValue({ artifacts: [artifact] }),
      },
    };
    const service = new ArtifactDownloadService(
      prisma as unknown as PrismaService,
      {} as PrivateObjectStorageService,
    );

    const result = await service.list('document-1', principal);

    expect(prisma.taxDocument.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'document-1',
        applicationId: 'app-1',
        environment: Environment.BETA,
      },
      select: {
        artifacts: {
          orderBy: { createdAt: 'asc' },
          select: {
            type: true,
            fileName: true,
            contentType: true,
            sizeBytes: true,
            sha256: true,
            createdAt: true,
          },
        },
      },
    });
    expect(result[0]).not.toHaveProperty('objectKey');
    expect(result[0]).toMatchObject({
      type: 'CDR',
      createdAt: createdAt.toISOString(),
    });
  });

  it('entrega URL temporal junto con datos para verificar integridad', async () => {
    const prisma = {
      artifact: { findFirst: jest.fn().mockResolvedValue(artifact) },
    };
    const storage = {
      signedUrlTtlSeconds: jest.fn().mockReturnValue(600),
      temporaryDownloadUrl: jest
        .fn()
        .mockResolvedValue('https://download.test'),
    };
    const service = new ArtifactDownloadService(
      prisma as unknown as PrismaService,
      storage as unknown as PrivateObjectStorageService,
    );

    await expect(
      service.get('document-1', 'CDR', principal),
    ).resolves.toMatchObject({
      sizeBytes: 123,
      sha256: 'a'.repeat(64),
      createdAt: createdAt.toISOString(),
      url: 'https://download.test',
    });
    expect(storage.temporaryDownloadUrl).toHaveBeenCalledWith(
      artifact.objectKey,
      artifact.fileName,
      600,
    );
  });

  it('oculta documentos de otra aplicación como no encontrados', async () => {
    const prisma = {
      taxDocument: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    const service = new ArtifactDownloadService(
      prisma as unknown as PrismaService,
      {} as PrivateObjectStorageService,
    );

    await expect(service.list('document-1', principal)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
