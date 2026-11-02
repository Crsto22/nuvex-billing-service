import { ConflictException } from '@nestjs/common';
import { DocumentType, Environment, PaymentMethod } from '@prisma/client';
import { PrismaService } from '../../../../libs/database/src/prisma.service';
import type { ApplicationPrincipal } from '../auth/auth.types';
import { DocumentsService } from './documents.service';
import { CustomerDocumentType } from './dto/create-document.dto';
import { TaxCalculatorService } from './tax-calculator.service';

describe('DocumentsService', () => {
  const principal: ApplicationPrincipal = {
    type: 'API_KEY',
    apiKeyId: 'api-key-id',
    applicationId: 'application-id',
    tenantId: 'tenant-id',
    environment: Environment.BETA,
    scopes: ['documents:write'],
  };
  const request = { requestId: 'request-id', ip: '127.0.0.1' } as never;
  const dto = {
    documentType: DocumentType.INVOICE,
    currency: 'PEN',
    lines: [
      {
        externalId: 'line-1',
        description: 'Servicio',
        quantity: '1',
        unitCode: 'ZZ',
        unitPrice: '100',
        unitPriceIncludesTax: false,
        taxAffectationCode: '10',
      },
    ],
    externalId: 'sale-1',
    series: 'F001',
    issueDate: '2026-11-01',
    establishmentCode: '0000',
    customer: {
      documentType: CustomerDocumentType.RUC,
      documentNumber: '20123456789',
      name: 'Cliente SAC',
    },
    paymentTerms: { method: PaymentMethod.CASH },
  };

  it('rejects reuse of an idempotency key with a different request', async () => {
    const prisma = {
      idempotencyRecord: {
        findUnique: jest.fn().mockResolvedValue({
          requestHash: 'different-hash',
          responseBody: { id: 'old-document' },
        }),
      },
    } as unknown as PrismaService;
    const service = new DocumentsService(prisma, new TaxCalculatorService());

    await expect(
      service.create(dto, 'idempotency-key-0001', principal, request),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('does not queue a document without active SUNAT credentials', async () => {
    const prisma = {
      idempotencyRecord: { findUnique: jest.fn().mockResolvedValue(null) },
      taxCredential: { findUnique: jest.fn().mockResolvedValue(null) },
    } as unknown as PrismaService;
    const service = new DocumentsService(prisma, new TaxCalculatorService());

    await expect(
      service.create(dto, 'idempotency-key-0002', principal, request),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
