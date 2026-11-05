import { Prisma } from '@prisma/client';
import { DOMParser } from '@xmldom/xmldom';
import { UblDailySummaryBuilderService } from './ubl-daily-summary-builder.service';

describe('UblDailySummaryBuilderService', () => {
  it('genera un Resumen Diario UBL para una boleta', () => {
    const service = new UblDailySummaryBuilderService();
    const xml = service.build(summary() as never);
    const document = new DOMParser().parseFromString(xml, 'application/xml');

    expect(document.getElementsByTagName('parsererror')).toHaveLength(0);
    expect(text(document, 'ID')).toBe('RC-20261102-001');
    expect(text(document, 'ReferenceDate')).toBe('2026-11-01');
    expect(text(document, 'DocumentTypeCode')).toBe('03');
    expect(text(document, 'ConditionCode')).toBe('1');
    expect(text(document, 'TotalAmount')).toBe('118.00');
    expect(text(document, 'Percent')).toBe('18.00');
  });

  it('incluye el comprobante afectado para una nota de boleta', () => {
    const service = new UblDailySummaryBuilderService();
    const data = summary();
    data.items[0].document.documentType = 'CREDIT_NOTE';
    data.items[0].document.series = 'BC01';
    data.items[0].document.references = [
      {
        referencedType: 'RECEIPT',
        referencedSeries: 'B001',
        referencedNumber: 42,
      },
    ];
    const document = new DOMParser().parseFromString(
      service.build(data as never),
      'application/xml',
    );
    expect(text(document, 'DocumentTypeCode')).toBe('07');
    expect(text(document, 'DocumentTypeCode', 1)).toBe('03');
    const ids = document.getElementsByTagNameNS('*', 'ID');
    expect(
      Array.from(
        { length: ids.length },
        (_, index) => ids.item(index)?.textContent,
      ),
    ).toContain('B001-42');
    const line = document.getElementsByTagNameNS(
      '*',
      'SummaryDocumentsLine',
    )[0];
    const children = Array.from(
      { length: line?.childNodes.length ?? 0 },
      (_, index) => line?.childNodes.item(index),
    )
      .filter((node): node is Element => node?.nodeType === 1)
      .map((node) => node.localName);
    expect(children).toEqual([
      'LineID',
      'DocumentTypeCode',
      'ID',
      'AccountingCustomerParty',
      'BillingReference',
      'Status',
      'TotalAmount',
      'BillingPayment',
      'TaxTotal',
    ]);
  });

  it.each([
    ['3', 'anulacion de un comprobante ya informado'],
    ['4', 'anulacion en el dia antes de informarlo'],
  ])('genera ConditionCode %s para %s', (conditionCode) => {
    const service = new UblDailySummaryBuilderService();
    const data = summary();
    data.items[0].conditionCode = conditionCode;
    const document = new DOMParser().parseFromString(
      service.build(data as never),
      'application/xml',
    );

    expect(text(document, 'ConditionCode')).toBe(conditionCode);
  });

  it('mantiene la tasa IGV 18.00 aunque los importes esten redondeados', () => {
    const service = new UblDailySummaryBuilderService();
    const data = summary();
    data.items[0].document.taxableAmount = new Prisma.Decimal('8.47');
    data.items[0].document.taxAmount = new Prisma.Decimal('1.53');
    data.items[0].document.totalAmount = new Prisma.Decimal('10.00');
    const document = new DOMParser().parseFromString(
      service.build(data as never),
      'application/xml',
    );

    expect(text(document, 'Percent')).toBe('18.00');
  });
});

function summary() {
  const decimal = (value: string) => new Prisma.Decimal(value);
  return {
    id: 'summary-1',
    tenantId: 'tenant-1',
    environment: 'BETA',
    referenceDate: new Date('2026-11-01T00:00:00.000Z'),
    generationDate: new Date('2026-11-02T00:00:00.000Z'),
    sequence: 1,
    tenant: { ruc: '20123456789' },
    items: [
      {
        lineId: 1,
        conditionCode: '1',
        document: {
          documentType: 'RECEIPT',
          series: 'B001',
          number: 42,
          currency: 'PEN',
          totalAmount: decimal('118'),
          taxableAmount: decimal('100'),
          exemptAmount: decimal('0'),
          unaffectedAmount: decimal('0'),
          taxAmount: decimal('18'),
          references: [],
          issuerSnapshot: {
            ruc: '20123456789',
            legalName: 'EMPRESA DEMO SAC',
            tradeName: 'NUVEX DEMO',
          },
          customerSnapshot: {
            documentType: 'DNI',
            documentNumber: '12345678',
          },
        },
      },
    ],
  };
}

function text(document: Document, localName: string, index = 0) {
  return (
    document.getElementsByTagNameNS('*', localName).item(index)?.textContent ??
    ''
  );
}
