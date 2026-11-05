import { PrismaService } from '../../database/src/prisma.service';
import { SecretCryptoService } from '../../security/src/secret-crypto.service';
import { PrivateObjectStorageService } from '../../storage/src/private-object-storage.service';
import { UblDailySummaryBuilderService } from '../../ubl/src/ubl-daily-summary-builder.service';
import { XmlSignatureService } from '../../ubl/src/xml-signature.service';
import { WebhookEventPublisherService } from '../../webhooks/src/webhook-event-publisher.service';
import { SunatCdrParserService } from './sunat-cdr-parser.service';
import {
  SunatDailySummaryService,
  SunatSummaryProcessingException,
  limaDateOnly,
} from './sunat-daily-summary.service';
import { SunatSoapClientService } from './sunat-soap-client.service';

describe('SunatDailySummaryService', () => {
  it('usa la fecha calendario de Peru durante el cambio de dia UTC', () => {
    expect(limaDateOnly(new Date('2026-11-05T00:53:00.000Z'))).toEqual(
      new Date('2026-11-04T00:00:00.000Z'),
    );
  });

  it('conserva el ticket y reintenta cuando SUNAT responde 98', async () => {
    const summary = fixture();
    const prisma = {
      dailySummaryItem: {
        findFirst: jest.fn().mockResolvedValue({ summary }),
      },
      dailySummary: {
        update: jest.fn().mockResolvedValue(summary),
      },
      taxCredential: {
        findUnique: jest.fn().mockResolvedValue({
          active: true,
          solUsernameEncrypted: 'user',
          solPasswordEncrypted: 'password',
          certificateObjectKey: 'certificate.p12',
          certificatePasswordEncrypted: 'certificate-password',
        }),
      },
    };
    const soap = {
      getStatus: jest
        .fn()
        .mockResolvedValue({ statusCode: '98', cdrZip: null }),
    };
    const crypto = { decrypt: jest.fn((value: string) => value) };
    const service = new SunatDailySummaryService(
      prisma as unknown as PrismaService,
      {} as PrivateObjectStorageService,
      crypto as unknown as SecretCryptoService,
      soap as unknown as SunatSoapClientService,
      {} as SunatCdrParserService,
      {} as UblDailySummaryBuilderService,
      {} as never,
      {} as XmlSignatureService,
      {} as WebhookEventPublisherService,
    );

    await expect(service.submitDocument('document-1')).rejects.toBeInstanceOf(
      SunatSummaryProcessingException,
    );
    expect(soap.getStatus).toHaveBeenCalledWith(
      expect.objectContaining({ ticket: 'ticket-1' }),
    );
    expect(prisma.dailySummary.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { status: 'PROCESSING', sunatCode: '98' },
      }),
    );
  });

  it.each([
    ['CREDIT_NOTE', 'BC01', 'ACCEPTED', 'document.accepted'],
    ['DEBIT_NOTE', 'BD01', 'REJECTED', 'document.rejected'],
  ] as const)(
    'publica %s para %s de boleta cuando termina el Resumen Diario',
    async (documentType, series, resultStatus, eventType) => {
      const summary = {
        ...fixture(),
        tenantId: 'tenant-1',
        environment: 'BETA',
        fileName: '20123456789-RC-20261101-1.zip',
        zipObjectKey: 'summaries/summary-1/summary.zip',
        items: [
          {
            id: 'item-1',
            documentId: 'document-1',
            document: {
              id: 'document-1',
              tenantId: 'tenant-1',
              documentType,
              series,
              number: 7,
              status: 'PROCESSING',
              sunatCode: null,
              sunatMessage: null,
              issuerSnapshot: { ruc: '20123456789' },
              references: [
                {
                  referencedType: 'RECEIPT',
                  referencedSeries: 'B001',
                  referencedNumber: 42,
                },
              ],
            },
          },
        ],
        tenant: { ruc: '20123456789' },
      };
      const documentUpdates: Array<{
        where: { id: string };
        data: { status: string };
      }> = [];
      const transaction = {
        dailySummary: { update: jest.fn().mockResolvedValue({}) },
        dailySummaryItem: { update: jest.fn().mockResolvedValue({}) },
        artifact: { upsert: jest.fn().mockResolvedValue({}) },
        taxDocument: {
          update: jest.fn(
            (input: { where: { id: string }; data: { status: string } }) => {
              documentUpdates.push(input);
              return Promise.resolve({});
            },
          ),
        },
      };
      const prisma = {
        dailySummaryItem: {
          findFirst: jest.fn().mockResolvedValue({ summary }),
        },
        dailySummary: {
          findUnique: jest.fn().mockResolvedValue(summary),
        },
        taxCredential: {
          findUnique: jest.fn().mockResolvedValue({
            active: true,
            solUsernameEncrypted: 'user',
            solPasswordEncrypted: 'password',
            certificateObjectKey: 'certificate.p12',
            certificatePasswordEncrypted: 'certificate-password',
          }),
        },
        $transaction: jest.fn((callback: (tx: typeof transaction) => unknown) =>
          callback(transaction),
        ),
      };
      const storage = { put: jest.fn().mockResolvedValue(undefined) };
      const soap = {
        getStatus: jest.fn().mockResolvedValue({
          statusCode: '0',
          cdrZip: Buffer.from('cdr-summary'),
        }),
      };
      const parser = {
        parse: jest.fn().mockReturnValue({
          status: resultStatus,
          code: resultStatus === 'ACCEPTED' ? '0' : '2335',
          message: resultStatus === 'ACCEPTED' ? 'Aceptado' : 'Rechazado',
          observations: [],
        }),
      };
      const crypto = { decrypt: jest.fn((value: string) => value) };
      const webhooks = { publish: jest.fn().mockResolvedValue({}) };
      const builder = {
        id: jest.fn().mockReturnValue('RC-20261101-1'),
      };
      const service = new SunatDailySummaryService(
        prisma as unknown as PrismaService,
        storage as unknown as PrivateObjectStorageService,
        crypto as unknown as SecretCryptoService,
        soap as unknown as SunatSoapClientService,
        parser as unknown as SunatCdrParserService,
        builder as unknown as UblDailySummaryBuilderService,
        {} as never,
        {} as XmlSignatureService,
        webhooks,
      );

      await service.submitDocument('document-1');

      expect(webhooks.publish).toHaveBeenCalledWith(
        transaction,
        'document-1',
        eventType,
      );
      expect(documentUpdates[0]).toMatchObject({
        where: { id: 'document-1' },
        data: { status: resultStatus },
      });
    },
  );
});

function fixture() {
  return {
    id: 'summary-1',
    status: 'SUBMITTED',
    ticket: 'ticket-1',
    items: [
      {
        document: {
          id: 'document-1',
          tenantId: 'tenant-1',
          environment: 'BETA',
          status: 'PROCESSING',
          sunatCode: null,
          sunatMessage: null,
          issuerSnapshot: { ruc: '20123456789' },
        },
      },
    ],
  };
}
