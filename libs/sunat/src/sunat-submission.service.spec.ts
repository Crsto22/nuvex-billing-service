import { PrismaService } from '../../database/src/prisma.service';
import { SecretCryptoService } from '../../security/src/secret-crypto.service';
import { ArtifactIntegrityService } from '../../storage/src/artifact-integrity.service';
import { PrivateObjectStorageService } from '../../storage/src/private-object-storage.service';
import { SunatCdrParserService } from './sunat-cdr-parser.service';
import { SunatSoapClientService } from './sunat-soap-client.service';
import { SunatSubmissionService } from './sunat-submission.service';
import { WebhookEventPublisherService } from '../../webhooks/src/webhook-event-publisher.service';
import { SunatDailySummaryService } from './sunat-daily-summary.service';

describe('SunatSubmissionService', () => {
  it('concatena RUC y usuario SOL, guarda el CDR y actualiza el estado', async () => {
    const document = documentFixture();
    document.environment = 'PRODUCTION';
    const transaction = {
      artifact: { upsert: jest.fn().mockResolvedValue({}) },
      taxDocument: { update: jest.fn().mockResolvedValue({}) },
      auditEvent: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      taxDocument: {
        findUnique: jest.fn().mockResolvedValue(document),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      taxCredential: {
        findUnique: jest.fn().mockResolvedValue({
          active: true,
          solUsernameEncrypted: 'encrypted-user',
          solPasswordEncrypted: 'encrypted-password',
        }),
      },
      $transaction: jest.fn((callback: (tx: typeof transaction) => unknown) =>
        callback(transaction),
      ),
    };
    const storage = {
      get: jest.fn().mockResolvedValue(Buffer.from('signed-zip')),
      put: jest.fn().mockResolvedValue(undefined),
    };
    const crypto = {
      decrypt: jest.fn((value: string) =>
        value === 'encrypted-user' ? 'MODDATOS' : 'MODDATOS',
      ),
    };
    const integrity = { assert: jest.fn() };
    const soap = {
      sendBill: jest.fn().mockResolvedValue({ cdrZip: Buffer.from('cdr-zip') }),
    };
    const parser = {
      parse: jest.fn().mockReturnValue({
        status: 'ACCEPTED',
        code: '0',
        message: 'Aceptado',
        observations: [],
        referenceId: 'F001-42',
        xmlFileName: 'R-document.xml',
      }),
    };
    const webhooks = { publish: jest.fn().mockResolvedValue({}) };
    const service = new SunatSubmissionService(
      prisma as unknown as PrismaService,
      storage as unknown as PrivateObjectStorageService,
      integrity,
      crypto as unknown as SecretCryptoService,
      soap as unknown as SunatSoapClientService,
      parser as unknown as SunatCdrParserService,
      webhooks,
      {} as SunatDailySummaryService,
    );

    await expect(service.submit('document-1')).resolves.toMatchObject({
      status: 'ACCEPTED',
      code: '0',
    });
    expect(soap.sendBill).toHaveBeenCalledWith(
      expect.objectContaining({
        environment: 'PRODUCTION',
        username: '20123456789MODDATOS',
        password: 'MODDATOS',
        fileName: '20123456789-01-F001-42.zip',
      }),
    );
    expect(prisma.taxCredential.findUnique).toHaveBeenCalledWith({
      where: {
        tenantId_environment: {
          tenantId: 'tenant-1',
          environment: 'PRODUCTION',
        },
      },
    });
    expect(crypto.decrypt).toHaveBeenCalledWith(
      'encrypted-user',
      'tenant-1:PRODUCTION:sol-username',
    );
    expect(storage.put).toHaveBeenCalledWith(
      expect.stringContaining('/R-20123456789-01-F001-42.zip'),
      Buffer.from('cdr-zip'),
      'application/zip',
    );
    expect(integrity.assert).toHaveBeenCalledWith(
      Buffer.from('signed-zip'),
      expect.objectContaining({ type: 'ZIP' }),
      'ZIP firmado',
    );
    expect(webhooks.publish).toHaveBeenCalledWith(
      transaction,
      'document-1',
      'document.accepted',
    );
    const updateCalls = transaction.taxDocument.update.mock.calls as Array<
      [{ data: { status: string; sunatCode: string } }]
    >;
    expect(updateCalls[0]?.[0].data).toMatchObject({
      status: 'ACCEPTED',
      sunatCode: '0',
    });
  });

  it('no reenvia cuando el CDR final ya fue persistido', async () => {
    const document = documentFixture();
    document.status = 'REJECTED';
    document.respondedAt = new Date();
    document.sunatCode = '2335';
    document.sunatMessage = 'Rechazado';
    document.artifacts.push({ type: 'CDR' });
    const prisma = {
      taxDocument: { findUnique: jest.fn().mockResolvedValue(document) },
    };
    const soap = { sendBill: jest.fn() };
    const service = new SunatSubmissionService(
      prisma as unknown as PrismaService,
      {} as PrivateObjectStorageService,
      {} as ArtifactIntegrityService,
      {} as SecretCryptoService,
      soap as unknown as SunatSoapClientService,
      {} as SunatCdrParserService,
      {} as WebhookEventPublisherService,
      {} as SunatDailySummaryService,
    );

    await expect(service.submit('document-1')).resolves.toMatchObject({
      status: 'REJECTED',
      code: '2335',
    });
    expect(soap.sendBill).not.toHaveBeenCalled();
  });

  it.each([
    ['RECEIPT', 'B001'],
    ['CREDIT_NOTE', 'BC01'],
    ['DEBIT_NOTE', 'BD01'],
  ] as const)(
    'enruta %s serie %s al Resumen Diario y no usa sendBill',
    async (documentType, series) => {
      const document = { ...documentFixture(), documentType, series };
      const prisma = {
        taxDocument: { findUnique: jest.fn().mockResolvedValue(document) },
      };
      const soap = { sendBill: jest.fn() };
      const summaries = {
        submitDocument: jest.fn().mockResolvedValue({
          status: 'ACCEPTED',
          code: '0',
          message: 'Aceptado por Resumen Diario',
        }),
      };
      const service = new SunatSubmissionService(
        prisma as unknown as PrismaService,
        {} as PrivateObjectStorageService,
        {} as ArtifactIntegrityService,
        {} as SecretCryptoService,
        soap as unknown as SunatSoapClientService,
        {} as SunatCdrParserService,
        {} as WebhookEventPublisherService,
        summaries as unknown as SunatDailySummaryService,
      );

      await expect(service.submit('document-1')).resolves.toMatchObject({
        status: 'ACCEPTED',
      });
      expect(summaries.submitDocument).toHaveBeenCalledWith('document-1');
      expect(soap.sendBill).not.toHaveBeenCalled();
    },
  );
});

function documentFixture() {
  return {
    id: 'document-1',
    tenantId: 'tenant-1',
    applicationId: 'application-1',
    environment: 'BETA',
    documentType: 'INVOICE',
    status: 'PROCESSING',
    series: 'F001',
    number: 42,
    issuerSnapshot: { ruc: '20123456789' },
    submittedAt: null as Date | null,
    respondedAt: null as Date | null,
    sunatCode: null as string | null,
    sunatMessage: null as string | null,
    artifacts: [
      {
        type: 'ZIP',
        fileName: '20123456789-01-F001-42.zip',
        objectKey:
          'tenants/tenant-1/beta/documents/2026/11/document-1/file.zip',
        sizeBytes: 10,
        sha256: 'a'.repeat(64),
      },
    ] as Array<{
      type: string;
      fileName?: string;
      objectKey?: string;
      sizeBytes?: number;
      sha256?: string;
    }>,
  };
}
