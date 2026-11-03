import { BadRequestException } from '@nestjs/common';
import { DespatchTransportMode, Environment, Prisma } from '@prisma/client';
import { PrismaService } from '../../../../libs/database/src/prisma.service';
import type { ApplicationPrincipal } from '../auth/auth.types';
import { DespatchGuidesService } from './despatch-guides.service';
import {
  CreateDespatchGuideDto,
  DespatchPartyDocumentType,
} from './dto/create-despatch-guide.dto';

describe('DespatchGuidesService', () => {
  const principal: ApplicationPrincipal = {
    type: 'API_KEY',
    apiKeyId: 'api-key-id',
    applicationId: 'application-id',
    tenantId: 'tenant-id',
    environment: Environment.BETA,
    scopes: ['documents:read', 'documents:write'],
  };
  const request = { requestId: 'request-id', ip: '127.0.0.1' } as never;

  it('registra una GRE remitente privada y reserva el correlativo T', async () => {
    const { service, tx, capture } = setup();

    const result = await service.create(
      dto(),
      'despatch-guide-key-0001',
      principal,
      request,
    );

    expect(result).toMatchObject({
      type: 'DESPATCH_GUIDE',
      status: 'REGISTERED',
      fullNumber: 'T001-00000001',
      transfer: {
        transportMode: 'PRIVATE',
        grossWeight: '10.500',
      },
    });
    expect(tx.fiscalSeries.update).toHaveBeenCalledWith({
      where: { id: 'series-id' },
      data: { currentNumber: { increment: 1 } },
    });
    expect(tx.despatchGuide.create).toHaveBeenCalled();
    expect(capture.createdGuide?.brandingSnapshot).toMatchObject({
      version: 3,
    });
  });

  it('exige transportista para transporte público', async () => {
    const { service } = setup();

    await expect(
      service.create(
        dto({
          transportMode: DespatchTransportMode.PUBLIC,
          carrierDeliveryDate: peruDate(0),
          vehicles: [],
          drivers: [],
        }),
        'despatch-guide-key-0002',
        principal,
        request,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rechaza motivos que no pertenecen al Catálogo SUNAT 20', async () => {
    const { service } = setup();

    await expect(
      service.create(
        dto({ transferReasonCode: '99' }),
        'despatch-guide-key-0003',
        principal,
        request,
      ),
    ).rejects.toThrow('Catálogo SUNAT 20');
  });

  it('rechaza ubigeos inexistentes en el Catálogo SUNAT 13', async () => {
    const { service } = setup();

    await expect(
      service.create(
        dto({ departure: { ubigeo: '999999', address: 'DIRECCION INVALIDA' } }),
        'despatch-guide-key-0004',
        principal,
        request,
      ),
    ).rejects.toThrow('ubigeo de partida');
  });

  it('exige DAM o DS para una importación', async () => {
    const { service } = setup();

    await expect(
      service.create(
        dto({ transferReasonCode: '08' }),
        'despatch-guide-key-0005',
        principal,
        request,
      ),
    ).rejects.toThrow('documento aduanero');
  });

  it('acepta transporte público con código SUNAT 01 y fecha de entrega', async () => {
    const { service } = setup();

    await expect(
      service.create(
        dto({
          transportMode: DespatchTransportMode.PUBLIC,
          carrierDeliveryDate: peruDate(0),
          carrier: {
            ruc: '20100070970',
            legalName: 'TRANSPORTES PRUEBA SAC',
          },
          vehicles: [],
          drivers: [],
        }),
        'despatch-guide-key-0006',
        principal,
        request,
      ),
    ).resolves.toBeDefined();
  });

  it('anula localmente una guía todavía no enviada a SUNAT', async () => {
    const guide = storedGuide();
    const updated = {
      ...guide,
      status: 'CANCELLED' as const,
      cancellationReason: 'Traslado cancelado por el cliente',
      cancellationRequestedAt: new Date('2026-11-02T12:00:00.000Z'),
      cancelledAt: new Date('2026-11-02T12:00:00.000Z'),
    };
    const tx = {
      despatchGuide: {
        findFirst: jest.fn().mockResolvedValue(guide),
        update: jest.fn().mockResolvedValue(updated),
      },
      idempotencyRecord: { create: jest.fn().mockResolvedValue({}) },
      auditEvent: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      idempotencyRecord: { findUnique: jest.fn().mockResolvedValue(null) },
      $transaction: jest.fn((callback: (client: typeof tx) => unknown) =>
        callback(tx),
      ),
    } as unknown as PrismaService;
    const service = new DespatchGuidesService(
      prisma,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

    const result = await service.cancel(
      guide.id,
      { reason: 'Traslado cancelado por el cliente' },
      'despatch-cancel-key-0001',
      principal,
      request,
    );

    expect(result.status).toBe('CANCELLED');
    expect(result.cancellation).toMatchObject({
      reason: 'Traslado cancelado por el cliente',
    });
  });
});

function dto(overrides: Partial<CreateDespatchGuideDto> = {}) {
  return {
    externalId: 'GRE-ORDER-1',
    series: 'T001',
    issueDate: peruDate(0),
    transferStartDate: peruDate(1),
    transferReasonCode: '01',
    transportMode: DespatchTransportMode.PRIVATE,
    grossWeight: '10.500',
    weightUnit: 'KGM',
    packageCount: 2,
    recipient: {
      documentType: DespatchPartyDocumentType.RUC,
      documentNumber: '20100070970',
      name: 'CLIENTE PRUEBA SAC',
    },
    departure: {
      ubigeo: '150132',
      address: 'AV. LOS CIRUELOS 500, LIMA',
    },
    arrival: {
      ubigeo: '150101',
      address: 'AV. DESTINO 100, LIMA',
    },
    vehicles: [
      {
        plate: 'ABC123',
        brand: 'VOLVO',
        primary: true,
      },
    ],
    drivers: [
      {
        documentType: DespatchPartyDocumentType.DNI,
        documentNumber: '12345678',
        firstNames: 'JUAN',
        lastNames: 'PEREZ',
        licenseNumber: 'Q12345678',
        primary: true,
      },
    ],
    items: [
      {
        externalId: 'ITEM-1',
        sku: 'SKU-1',
        description: 'PRODUCTO DE PRUEBA',
        quantity: '2',
        unitCode: 'NIU',
      },
    ],
    ...overrides,
  } as CreateDespatchGuideDto;
}

function setup() {
  const guide = storedGuide();
  const capture: { createdGuide?: Record<string, unknown> } = {};
  const tx = {
    idempotencyRecord: {
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({}),
    },
    fiscalSeries: {
      findFirst: jest.fn().mockResolvedValue({
        id: 'series-id',
        currentNumber: 0,
        tenant: {
          ruc: '20615136663',
          legalName: 'CORDEX T & D S.A.C.',
          tradeName: 'CORDEX T & D',
          address: 'AV. LOS CIRUELOS 500',
          ubigeo: '150132',
          branding: {
            version: 3,
            pdfObjectKey: 'tenant/logo-v3.png',
            pdfSizeBytes: 100,
            pdfSha256: 'b'.repeat(64),
            pdfWidth: 800,
            pdfHeight: 320,
          },
        },
        establishment: {
          code: '0000',
          address: 'AV. LOS CIRUELOS 500',
          ubigeo: '150132',
        },
      }),
      update: jest.fn().mockResolvedValue({ currentNumber: 1 }),
    },
    despatchGuide: {
      create: jest
        .fn()
        .mockImplementation(({ data }: { data: Record<string, unknown> }) => {
          capture.createdGuide = data;
          return Promise.resolve(guide);
        }),
    },
    auditEvent: { create: jest.fn().mockResolvedValue({}) },
  };
  const prisma = {
    idempotencyRecord: { findUnique: jest.fn().mockResolvedValue(null) },
    $transaction: jest.fn((callback: (client: typeof tx) => unknown) =>
      callback(tx),
    ),
  } as unknown as PrismaService;
  return {
    service: new DespatchGuidesService(
      prisma,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    ),
    tx,
    capture,
  };
}

function storedGuide() {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    externalId: 'GRE-ORDER-1',
    environment: Environment.BETA,
    status: 'REGISTERED' as const,
    series: 'T001',
    number: 1,
    issueDate: new Date('2026-11-02T00:00:00.000Z'),
    issueTime: '10:00:00',
    transferStartDate: new Date('2026-11-03T00:00:00.000Z'),
    carrierDeliveryDate: null,
    transferReasonCode: '01',
    transferReasonDescription: null,
    transportMode: DespatchTransportMode.PRIVATE,
    grossWeight: new Prisma.Decimal('10.500'),
    weightUnit: 'KGM',
    packageCount: 2,
    departureUbigeo: '150132',
    departureAddress: 'AV. LOS CIRUELOS 500, LIMA',
    arrivalUbigeo: '150101',
    arrivalAddress: 'AV. DESTINO 100, LIMA',
    relatedDocumentType: null,
    relatedDocumentNumber: null,
    cancellationReason: null,
    cancellationRequestedAt: null,
    cancelledAt: null,
    submittedAt: null,
    respondedAt: null,
    sunatCode: null,
    sunatMessage: null,
    sunatObservations: [],
    sunatHash: null,
    artifacts: [],
    createdAt: new Date('2026-11-02T10:00:00.000Z'),
    updatedAt: new Date('2026-11-02T10:00:00.000Z'),
    recipient: {
      documentType: 'RUC',
      documentNumber: '20100070970',
      name: 'CLIENTE PRUEBA SAC',
      address: null,
      ubigeo: null,
    },
    carrier: null,
    vehicles: [
      {
        plate: 'ABC123',
        brand: 'VOLVO',
        authorizationNumber: null,
        primary: true,
      },
    ],
    drivers: [
      {
        documentType: 'DNI',
        documentNumber: '12345678',
        firstNames: 'JUAN',
        lastNames: 'PEREZ',
        licenseNumber: 'Q12345678',
        primary: true,
      },
    ],
    items: [
      {
        lineNumber: 1,
        externalId: 'ITEM-1',
        sku: 'SKU-1',
        description: 'PRODUCTO DE PRUEBA',
        quantity: new Prisma.Decimal(2),
        unitCode: 'NIU',
      },
    ],
  };
}

function peruDate(offsetDays: number) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Lima',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const values = Object.fromEntries(
    parts.map((part) => [part.type, part.value]),
  );
  const date = new Date(
    `${values.year}-${values.month}-${values.day}T00:00:00.000Z`,
  );
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}
