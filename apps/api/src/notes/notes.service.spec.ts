import { BadRequestException, ConflictException } from '@nestjs/common';
import { Environment, Prisma } from '@prisma/client';
import { PrismaService } from '../../../../libs/database/src/prisma.service';
import type { ApplicationPrincipal } from '../auth/auth.types';
import { CustomerDocumentType } from '../documents/dto/create-document.dto';
import { NotesService } from './notes.service';
import { NoteTaxCalculatorService } from './note-tax-calculator.service';

describe('NotesService', () => {
  const principal: ApplicationPrincipal = {
    type: 'API_KEY',
    apiKeyId: 'api-key-id',
    applicationId: 'application-id',
    tenantId: 'tenant-id',
    environment: Environment.BETA,
    scopes: ['documents:write'],
  };
  const request = { requestId: 'request-id', ip: '127.0.0.1' } as never;

  it('validates and reserves an available credit balance', async () => {
    const { service, tx } = setup();
    const result = await service.create(
      'CREDIT_NOTE',
      dto(),
      'credit-note-key-0001',
      principal,
      request,
    );

    expect(result.status).toBe('QUEUED');
    expect(result.validation.remainingTotalAfter).toBe('68.00');
    expect(result.calculation.tax).toBe('7.63');
    expect(tx.taxDocument.create).toHaveBeenCalled();
  });

  it('rejects a source document not accepted by SUNAT', async () => {
    const { service } = setup({ status: 'QUEUED' });
    await expect(
      service.create(
        'CREDIT_NOTE',
        dto(),
        'credit-note-key-0002',
        principal,
        request,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects a customer different from the original document', async () => {
    const { service } = setup();
    await expect(
      service.create(
        'CREDIT_NOTE',
        dto({
          customer: {
            documentType: CustomerDocumentType.RUC,
            documentNumber: '20999999999',
          },
        }),
        'credit-note-key-0003',
        principal,
        request,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a currency different from the original document', async () => {
    const { service } = setup();
    await expect(
      service.create(
        'CREDIT_NOTE',
        dto({ currency: 'USD' }),
        'credit-note-key-0004',
        principal,
        request,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a reason outside the corresponding SUNAT catalog', async () => {
    const { service } = setup();
    await expect(
      service.create(
        'CREDIT_NOTE',
        dto({ reasonCode: '99' }),
        'credit-note-key-0099',
        principal,
        request,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects an amount above the remaining credit balance', async () => {
    const { service } = setup({
      referencedBy: [
        {
          document: {
            documentType: 'CREDIT_NOTE',
            status: 'RECEIVED',
            reasonCode: '07',
            noteAdjustments: [
              {
                referenceLineNumber: 1,
                amount: new Prisma.Decimal(80),
                quantity: new Prisma.Decimal('0.5'),
              },
            ],
          },
        },
      ],
    });
    await expect(
      service.create(
        'CREDIT_NOTE',
        dto(),
        'credit-note-key-0005',
        principal,
        request,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects a quantity above the remaining original quantity', async () => {
    const { service } = setup();
    await expect(
      service.create(
        'CREDIT_NOTE',
        dto({
          adjustments: [
            { referenceLineNumber: 1, amount: '50.00', quantity: '2' },
          ],
        }),
        'credit-note-key-0006',
        principal,
        request,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('accepts current SUNAT debit reason 13 without consuming credit balance', async () => {
    const { service } = setup();
    const result = await service.create(
      'DEBIT_NOTE',
      dto({
        reasonCode: '13',
        adjustments: [{ referenceLineNumber: 1, amount: '25.00' }],
      }),
      'debit-note-key-00007',
      principal,
      request,
    );
    expect(result.type).toBe('DEBIT_NOTE');
    expect(result.validation.remainingTotalAfter).toBeNull();
  });
});

function dto(overrides: Record<string, unknown> = {}) {
  return {
    externalId: 'credit-1',
    referenceDocumentId: 'f816b0d3-9c8c-45d9-bcab-a8d729b6a230',
    series: 'FC01',
    issueDate: '2026-11-02',
    currency: 'PEN',
    reasonCode: '07',
    reasonDescription: 'Devolución parcial solicitada por el cliente',
    customer: {
      documentType: CustomerDocumentType.RUC,
      documentNumber: '20123456789',
    },
    adjustments: [{ referenceLineNumber: 1, amount: '50.00', quantity: '0.5' }],
    ...overrides,
  } as never;
}

function setup(sourceOverrides: Record<string, unknown> = {}) {
  const source = {
    id: 'f816b0d3-9c8c-45d9-bcab-a8d729b6a230',
    tenantId: 'tenant-id',
    applicationId: 'application-id',
    documentType: 'INVOICE',
    status: 'ACCEPTED',
    series: 'F001',
    number: 1,
    issueDate: new Date('2026-11-01T00:00:00.000Z'),
    currency: 'PEN',
    paymentMethod: 'CASH',
    issuerSnapshot: { ruc: '20615136663' },
    customerSnapshot: {
      documentType: CustomerDocumentType.RUC,
      documentNumber: '20123456789',
      name: 'Cliente SAC',
    },
    totalAmount: new Prisma.Decimal(118),
    lines: [
      {
        lineNumber: 1,
        externalId: 'ITEM-1',
        sku: 'SKU-1',
        description: 'Servicio',
        unitCode: 'ZZ',
        quantity: new Prisma.Decimal(1),
        taxAffectationCode: '10',
        lineValue: new Prisma.Decimal(100),
        taxAmount: new Prisma.Decimal(18),
        totalAmount: new Prisma.Decimal(118),
      },
    ],
    referencedBy: [],
    ...sourceOverrides,
  };
  const tx = {
    idempotencyRecord: {
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({}),
    },
    taxDocument: {
      findFirst: jest.fn().mockResolvedValue(source),
      create: jest
        .fn()
        .mockImplementation(({ data }: { data: Record<string, unknown> }) => ({
          id: '14b64a48-3632-47eb-804d-2d7bb70bd35e',
          externalId: String(data.externalId),
          environment: String(data.environment),
          series: String(data.series),
          number: 1,
          currency: String(data.currency),
        })),
    },
    fiscalSeries: {
      findFirst: jest.fn().mockResolvedValue({ id: 'series-id' }),
      update: jest.fn().mockResolvedValue({ currentNumber: 1 }),
    },
    auditEvent: { create: jest.fn().mockResolvedValue({}) },
  };
  const prisma = {
    idempotencyRecord: { findUnique: jest.fn().mockResolvedValue(null) },
    $transaction: jest
      .fn()
      .mockImplementation((callback: (client: typeof tx) => unknown) =>
        callback(tx),
      ),
  } as unknown as PrismaService;
  return {
    service: new NotesService(prisma, new NoteTaxCalculatorService()),
    tx,
  };
}
