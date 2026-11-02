import {
  DocumentStatus,
  DocumentType,
  Environment,
  SunatVoidProcedure,
  SunatVoidRequestStatus,
} from '@prisma/client';
import { PrismaService } from '../../../../libs/database/src/prisma.service';
import type { ApplicationPrincipal } from '../auth/auth.types';
import { VoidRequestsService } from './void-requests.service';

describe('VoidRequestsService', () => {
  const principal: ApplicationPrincipal = {
    type: 'API_KEY',
    apiKeyId: 'api-key-id',
    applicationId: 'application-id',
    tenantId: 'tenant-id',
    environment: Environment.BETA,
    scopes: ['documents:write'],
  };
  const httpRequest = {
    requestId: 'request-id',
    ip: '127.0.0.1',
  } as never;

  it('crea una comunicación RA para una factura', async () => {
    const document = taxDocument(DocumentType.INVOICE);
    const { prisma } = prismaMock(document);
    const service = new VoidRequestsService(
      prisma as unknown as PrismaService,
      {} as never,
      {} as never,
    );

    const result = await service.createForDocument(
      document.id,
      { reason: 'Error en la operación', documentDelivered: false },
      'void-invoice-key-0001',
      principal,
      httpRequest,
    );

    expect(result.procedure).toBe(SunatVoidProcedure.VOIDED_DOCUMENTS);
    expect(result.status).toBe(SunatVoidRequestStatus.PENDING);
  });

  it('usa resumen diario para una nota vinculada a boleta', async () => {
    const document = taxDocument(DocumentType.CREDIT_NOTE, [
      { referencedType: DocumentType.RECEIPT },
    ]);
    const { prisma } = prismaMock(document);
    const service = new VoidRequestsService(
      prisma as unknown as PrismaService,
      {} as never,
      {} as never,
    );

    const result = await service.createForDocument(
      document.id,
      { reason: 'Nota no otorgada', documentDelivered: false },
      'void-receipt-note-0001',
      principal,
      httpRequest,
    );

    expect(result.procedure).toBe(SunatVoidProcedure.DAILY_SUMMARY);
  });

  it.each([DocumentType.CREDIT_NOTE, DocumentType.DEBIT_NOTE])(
    'crea una comunicacion RA para %s vinculada a factura',
    async (documentType) => {
      const document = taxDocument(documentType, [
        { referencedType: DocumentType.INVOICE },
      ]);
      const { prisma } = prismaMock(document);
      const service = new VoidRequestsService(
        prisma as unknown as PrismaService,
        {} as never,
        {} as never,
      );

      const result = await service.createForDocument(
        document.id,
        { reason: 'Documento no otorgado', documentDelivered: false },
        `void-invoice-note-${documentType}`,
        principal,
        httpRequest,
      );

      expect(result.procedure).toBe(SunatVoidProcedure.VOIDED_DOCUMENTS);
    },
  );

  it('deja la baja de GRE pendiente de acción manual en SOL', async () => {
    const guide = {
      id: 'guide-id',
      tenantId: principal.tenantId,
      applicationId: principal.applicationId,
      environment: principal.environment,
      documentType: DocumentType.DESPATCH_GUIDE,
      externalId: 'guide-1',
      issueDate: new Date('2026-11-02T00:00:00.000Z'),
      series: 'T001',
      number: 10,
      status: 'ACCEPTED',
      submittedAt: new Date('2026-11-02T09:00:00.000Z'),
      voidRequest: null,
    };
    const { prisma } = prismaMock(null, guide);
    const service = new VoidRequestsService(
      prisma as unknown as PrismaService,
      {} as never,
      { publishVoidRequest: jest.fn().mockResolvedValue({}) } as never,
    );

    const result = await service.createForGuide(
      guide.id,
      {
        reason: 'Cambio de destinatario',
        transferStarted: true,
        recipientChanged: true,
      },
      'void-guide-key-0001',
      principal,
      httpRequest,
    );

    expect(result.procedure).toBe(SunatVoidProcedure.GRE_SOL);
    expect(result.status).toBe(SunatVoidRequestStatus.MANUAL_ACTION_REQUIRED);
    expect(result.manualAction?.channel).toBe('SUNAT_SOL');
  });

  it('confirma una baja de GRE aceptada manualmente en SOL', async () => {
    const current = {
      id: 'void-request-id',
      tenantId: principal.tenantId,
      applicationId: principal.applicationId,
      environment: principal.environment,
      taxDocumentId: null,
      despatchGuideId: 'guide-id',
      documentType: DocumentType.DESPATCH_GUIDE,
      procedure: SunatVoidProcedure.GRE_SOL,
      status: SunatVoidRequestStatus.MANUAL_ACTION_REQUIRED,
      referenceDate: new Date('2026-11-02T00:00:00.000Z'),
      series: 'T001',
      number: 10,
      reason: 'Cambio de destinatario',
      requestPayload: { previousGuideStatus: 'ACCEPTED' },
      attempts: 0,
      ticket: null,
      sunatCode: null,
      sunatMessage: null,
      submittedAt: null,
      respondedAt: null,
      completedAt: null,
      manualReference: null,
      manualEvidence: null,
      manualConfirmedAt: null,
      createdAt: new Date('2026-11-02T10:00:00.000Z'),
      updatedAt: new Date('2026-11-02T10:00:00.000Z'),
      taxDocument: null,
      despatchGuide: { id: 'guide-id', externalId: 'guide-1' },
      summaryItem: null,
      job: null,
    };
    let guideUpdateInput: {
      where: { id: string };
      data: { status: string; cancelledAt: Date };
    } | null = null;
    const tx = {
      sunatVoidRequest: {
        findFirst: jest.fn().mockResolvedValue(current),
        update: jest.fn().mockResolvedValue({
          ...current,
          status: SunatVoidRequestStatus.ACCEPTED,
          manualReference: 'SOL-BAJA-0001',
          manualConfirmedAt: new Date('2026-11-02T11:00:00.000Z'),
          completedAt: new Date('2026-11-02T11:00:00.000Z'),
          respondedAt: new Date('2026-11-02T11:00:00.000Z'),
        }),
      },
      despatchGuide: {
        update: jest.fn(
          (input: {
            where: { id: string };
            data: { status: string; cancelledAt: Date };
          }) => {
            guideUpdateInput = input;
            return Promise.resolve({});
          },
        ),
      },
      idempotencyRecord: { create: jest.fn().mockResolvedValue({}) },
      auditEvent: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      idempotencyRecord: { findUnique: jest.fn().mockResolvedValue(null) },
      $transaction: jest.fn((callback: (client: typeof tx) => unknown) =>
        callback(tx),
      ),
    };
    const webhooks = { publishVoidRequest: jest.fn().mockResolvedValue({}) };
    const service = new VoidRequestsService(
      prisma as unknown as PrismaService,
      {} as never,
      webhooks as never,
    );

    const result = await service.confirmGreManualResult(
      current.id,
      { result: 'ACCEPTED', solReference: 'SOL-BAJA-0001' },
      'confirm-gre-sol-0001',
      principal,
      httpRequest,
    );

    expect(result.status).toBe(SunatVoidRequestStatus.ACCEPTED);
    expect(guideUpdateInput).toMatchObject({ data: { status: 'CANCELLED' } });
    expect(webhooks.publishVoidRequest).toHaveBeenCalledWith(
      tx,
      current.id,
      'sunat_void.accepted',
    );
  });
});

function taxDocument(
  documentType: DocumentType,
  references: { referencedType: DocumentType }[] = [],
) {
  return {
    id: 'document-id',
    tenantId: 'tenant-id',
    applicationId: 'application-id',
    environment: Environment.BETA,
    externalId: 'document-1',
    documentType,
    status: DocumentStatus.ACCEPTED,
    issueDate: new Date('2026-11-01T00:00:00.000Z'),
    respondedAt: new Date(),
    series: documentType === DocumentType.INVOICE ? 'F001' : 'FC01',
    number: 15,
    voidRequest: null,
    references,
  };
}

function prismaMock(
  document: ReturnType<typeof taxDocument> | null,
  guide: Record<string, unknown> | null = null,
) {
  const tx = {
    sunatVoidRequest: {
      create: jest.fn().mockImplementation(({ data }) =>
        Promise.resolve({
          id: 'void-request-id',
          ...data,
          attempts: 0,
          ticket: null,
          sunatCode: null,
          sunatMessage: null,
          submittedAt: null,
          respondedAt: null,
          completedAt: null,
          createdAt: new Date('2026-11-02T10:00:00.000Z'),
          updatedAt: new Date('2026-11-02T10:00:00.000Z'),
          taxDocument: document
            ? { id: document.id, externalId: document.externalId }
            : null,
          despatchGuide: guide
            ? { id: guide.id, externalId: guide.externalId }
            : null,
        }),
      ),
    },
    despatchGuide: { update: jest.fn().mockResolvedValue({}) },
    idempotencyRecord: { create: jest.fn().mockResolvedValue({}) },
    auditEvent: { create: jest.fn().mockResolvedValue({}) },
  };
  const prisma = {
    idempotencyRecord: { findUnique: jest.fn().mockResolvedValue(null) },
    taxDocument: { findFirst: jest.fn().mockResolvedValue(document) },
    despatchGuide: { findFirst: jest.fn().mockResolvedValue(guide) },
    $transaction: jest.fn((callback: (client: typeof tx) => Promise<unknown>) =>
      callback(tx),
    ),
  };
  return { prisma, tx };
}
