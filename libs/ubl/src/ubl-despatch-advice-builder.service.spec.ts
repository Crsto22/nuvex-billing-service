import { DOMParser } from '@xmldom/xmldom';
import { Prisma } from '@prisma/client';
import { UblDespatchAdviceBuilderService } from './ubl-despatch-advice-builder.service';

describe('UblDespatchAdviceBuilderService', () => {
  const builder = new UblDespatchAdviceBuilderService();

  it('genera DespatchAdvice UBL 2.1 para transporte privado', () => {
    const xml = builder.build(guide());
    const document = new DOMParser().parseFromString(xml, 'application/xml');

    expect(document.documentElement.localName).toBe('DespatchAdvice');
    expect(text(document, 'UBLVersionID')).toBe('2.1');
    expect(text(document, 'CustomizationID')).toBe('2.0');
    expect(text(document, 'ID')).toBe('T001-15');
    expect(text(document, 'IssueTime')).toBe('10:20:30');
    expect(text(document, 'DespatchAdviceTypeCode')).toBe('09');
    expect(text(document, 'HandlingCode')).toBe('01');
    expect(text(document, 'TransportModeCode')).toBe('02');
    expect(text(document, 'GrossWeightMeasure')).toBe('12.500');
    expect(text(document, 'DriverPerson')).toContain('Principal');
    expect(text(document, 'TransportEquipment')).toContain('ABC123');
    expect(text(document, 'DespatchLine')).toContain('Producto de prueba');
  });

  it('incluye transportista y fecha de entrega en transporte público', () => {
    const value = guide();
    value.transportMode = 'PUBLIC';
    value.carrierDeliveryDate = new Date('2026-11-02T00:00:00.000Z');
    value.carrier = {
      id: 'carrier',
      guideId: value.id,
      ruc: '20123456789',
      legalName: 'TRANSPORTES PRUEBA SAC',
      mtcRegistrationNumber: 'MTC-123',
    };
    value.vehicles = [];
    value.drivers = [];

    const xml = builder.build(value);
    const document = new DOMParser().parseFromString(xml, 'application/xml');

    expect(text(document, 'TransportModeCode')).toBe('01');
    expect(text(document, 'CarrierParty')).toContain('20123456789');
    expect(text(document, 'OccurrenceDate')).toBe('2026-11-02');
  });
});

function guide() {
  return {
    id: 'guide-id',
    tenantId: 'tenant-id',
    applicationId: 'application-id',
    fiscalSeriesId: 'series-id',
    externalId: 'GRE-15',
    environment: 'BETA',
    status: 'REGISTERED',
    series: 'T001',
    number: 15,
    issueDate: new Date('2026-11-02T00:00:00.000Z'),
    issueTime: '10:20:30',
    transferStartDate: new Date('2026-11-02T00:00:00.000Z'),
    carrierDeliveryDate: null,
    transferReasonCode: '01',
    transferReasonDescription: null,
    transportMode: 'PRIVATE',
    grossWeight: new Prisma.Decimal('12.5'),
    weightUnit: 'KGM',
    packageCount: 1,
    departureUbigeo: '150132',
    departureAddress: 'AV. LOS CIRUELOS 500',
    arrivalUbigeo: '150101',
    arrivalAddress: 'AV. DESTINO 100',
    relatedDocumentType: null,
    relatedDocumentNumber: null,
    issuerSnapshot: {
      ruc: '20615136663',
      legalName: 'CORDEX T & D S.A.C.',
      tradeName: 'CORDEX T & D',
    },
    requestPayload: {},
    metadata: null,
    sunatCode: null,
    sunatMessage: null,
    sunatObservations: [],
    sunatHash: null,
    cancellationReason: null,
    cancellationRequestedAt: null,
    cancelledAt: null,
    submittedAt: null,
    respondedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    recipient: {
      id: 'recipient',
      guideId: 'guide-id',
      documentType: 'DNI',
      documentNumber: '12345678',
      name: 'CLIENTE PRUEBA',
      address: null,
      ubigeo: null,
    },
    carrier: null,
    vehicles: [
      {
        id: 'vehicle',
        guideId: 'guide-id',
        plate: 'ABC123',
        brand: 'PRUEBA',
        authorizationNumber: null,
        primary: true,
      },
    ],
    drivers: [
      {
        id: 'driver',
        guideId: 'guide-id',
        documentType: 'DNI',
        documentNumber: '87654321',
        firstNames: 'JUAN',
        lastNames: 'PEREZ',
        licenseNumber: 'Q12345678',
        primary: true,
      },
    ],
    items: [
      {
        id: 'item',
        guideId: 'guide-id',
        lineNumber: 1,
        externalId: 'ITEM-1',
        sku: 'SKU-1',
        description: 'Producto de prueba',
        quantity: new Prisma.Decimal('2'),
        unitCode: 'NIU',
      },
    ],
  } as unknown as Parameters<UblDespatchAdviceBuilderService['build']>[0];
}

function text(document: Document, localName: string) {
  return Array.from(document.getElementsByTagNameNS('*', localName))[0]
    ?.textContent;
}
