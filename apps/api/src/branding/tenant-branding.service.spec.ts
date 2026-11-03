import { PrismaService } from '../../../../libs/database/src/prisma.service';
import { PrivateObjectStorageService } from '../../../../libs/storage/src/private-object-storage.service';
import {
  LogoImageOptimizerService,
  type OptimizedTenantLogo,
} from './logo-image-optimizer.service';
import { TenantBrandingService } from './tenant-branding.service';

describe('TenantBrandingService', () => {
  it('guarda las tres variantes privadas y audita la nueva version', async () => {
    const stored = brandingRecord();
    let upsertInput: unknown;
    let auditInput: unknown;
    const transaction = {
      tenantBranding: {
        findUnique: jest.fn().mockResolvedValue({ version: 2 }),
        upsert: jest.fn((input: unknown) => {
          upsertInput = input;
          return Promise.resolve(stored);
        }),
      },
      auditEvent: {
        create: jest.fn((input: unknown) => {
          auditInput = input;
          return Promise.resolve({});
        }),
      },
    };
    const prisma = {
      tenant: { findUnique: jest.fn().mockResolvedValue({ id: 'tenant-1' }) },
      $transaction: jest.fn((callback: (tx: typeof transaction) => unknown) =>
        callback(transaction),
      ),
    };
    const storage = {
      put: jest.fn().mockResolvedValue(undefined),
      delete: jest.fn().mockResolvedValue(undefined),
    };
    const optimizer = { optimize: jest.fn().mockResolvedValue(logo()) };
    const service = new TenantBrandingService(
      prisma as unknown as PrismaService,
      storage as unknown as PrivateObjectStorageService,
      optimizer as unknown as LogoImageOptimizerService,
    );

    await expect(
      service.uploadLogo('tenant-1', {} as Express.Multer.File, {
        requestId: 'request-1',
        ip: '127.0.0.1',
      }),
    ).resolves.toMatchObject({
      tenantId: 'tenant-1',
      logoConfigured: true,
      logo: { version: 3, sourceFileName: 'logo.png' },
    });

    expect(storage.put).toHaveBeenCalledTimes(3);
    expect(storage.put).toHaveBeenNthCalledWith(
      2,
      expect.stringMatching(
        /^tenants\/tenant-1\/branding\/logos\/.+\/logo-pdf\.png$/,
      ),
      Buffer.from('pdf'),
      'image/png',
    );
    expect(upsertInput).toMatchObject({
      where: { tenantId: 'tenant-1' },
      update: { version: 3, pdfSha256: 'b'.repeat(64) },
    });
    expect(auditInput).toMatchObject({
      data: {
        action: 'tenant_branding.logo_uploaded',
        tenantId: 'tenant-1',
      },
    });
  });

  it('elimina los objetos nuevos si falla la persistencia', async () => {
    const prisma = {
      tenant: { findUnique: jest.fn().mockResolvedValue({ id: 'tenant-1' }) },
      $transaction: jest.fn().mockRejectedValue(new Error('database failed')),
    };
    const storage = {
      put: jest.fn().mockResolvedValue(undefined),
      delete: jest.fn().mockResolvedValue(undefined),
    };
    const optimizer = { optimize: jest.fn().mockResolvedValue(logo()) };
    const service = new TenantBrandingService(
      prisma as unknown as PrismaService,
      storage as unknown as PrivateObjectStorageService,
      optimizer as unknown as LogoImageOptimizerService,
    );

    await expect(
      service.uploadLogo('tenant-1', {} as Express.Multer.File, {}),
    ).rejects.toThrow('database failed');
    expect(storage.delete).toHaveBeenCalledTimes(3);
  });
});

function logo(): OptimizedTenantLogo {
  return {
    source: {
      fileName: 'logo.png',
      contentType: 'image/png',
      sizeBytes: 1000,
      width: 1200,
      height: 480,
    },
    master: variant('master', 1600, 640, 'a'),
    pdf: variant('pdf', 800, 320, 'b'),
    preview: {
      ...variant('preview', 320, 128, 'c'),
      contentType: 'image/webp',
      extension: 'webp',
    },
  };
}

function variant(value: string, width: number, height: number, hash: string) {
  const body = Buffer.from(value);
  return {
    body,
    contentType: 'image/png',
    extension: 'png' as const,
    sizeBytes: body.length,
    sha256: hash.repeat(64),
    width,
    height,
  };
}

function brandingRecord() {
  return {
    id: 'branding-1',
    tenantId: 'tenant-1',
    version: 3,
    sourceFileName: 'logo.png',
    sourceMimeType: 'image/png',
    sourceSizeBytes: 1000,
    sourceWidth: 1200,
    sourceHeight: 480,
    masterObjectKey: 'master',
    masterSizeBytes: 6,
    masterSha256: 'a'.repeat(64),
    masterWidth: 1600,
    masterHeight: 640,
    pdfObjectKey: 'pdf',
    pdfSizeBytes: 3,
    pdfSha256: 'b'.repeat(64),
    pdfWidth: 800,
    pdfHeight: 320,
    previewObjectKey: 'preview',
    previewSizeBytes: 7,
    previewSha256: 'c'.repeat(64),
    previewWidth: 320,
    previewHeight: 128,
    uploadedAt: new Date('2026-11-02T12:00:00Z'),
    createdAt: new Date('2026-11-02T12:00:00Z'),
    updatedAt: new Date('2026-11-02T12:00:00Z'),
  };
}
