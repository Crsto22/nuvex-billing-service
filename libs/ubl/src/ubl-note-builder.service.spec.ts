import { DOMParser } from '@xmldom/xmldom';
import { Prisma } from '@prisma/client';
import { UblNoteBuilderService } from './ubl-note-builder.service';
import { UblDocument } from './ubl.types';

describe('UblNoteBuilderService', () => {
  const service = new UblNoteBuilderService();

  it('genera CreditNote UBL 2.1 con motivo y comprobante afectado', () => {
    const parsed = parse(service.build(fixture('CREDIT_NOTE')));
    expect(parsed.documentElement.nodeName).toBe('CreditNote');
    expect(text(parsed, 'cbc:UBLVersionID')).toBe('2.1');
    expect(text(parsed, 'cbc:ResponseCode')).toBe('07');
    expect(text(parsed, 'cbc:DocumentTypeCode')).toBe('01');
    expect(text(parsed, 'cbc:CreditedQuantity')).toBe('1');
    expect(text(parsed, 'cbc:PayableAmount')).toBe('59.00');
    expect(parsed.getElementsByTagName('cac:CreditNoteLine')).toHaveLength(1);
  });

  it('genera DebitNote UBL 2.1 con línea debitada', () => {
    const document = fixture('DEBIT_NOTE');
    document.reasonCode = '02';
    document.reasonDescription = 'Aumento en el valor';
    const parsed = parse(service.build(document));
    expect(parsed.documentElement.nodeName).toBe('DebitNote');
    expect(text(parsed, 'cbc:ResponseCode')).toBe('02');
    expect(text(parsed, 'cbc:DebitedQuantity')).toBe('1');
    expect(parsed.getElementsByTagName('cac:DebitNoteLine')).toHaveLength(1);
    expect(
      parsed.getElementsByTagName('cac:RequestedMonetaryTotal'),
    ).toHaveLength(1);
    expect(parsed.getElementsByTagName('cac:LegalMonetaryTotal')).toHaveLength(
      0,
    );
  });
});

function parse(xml: string) {
  const parsed = new DOMParser().parseFromString(xml, 'application/xml');
  expect(parsed.getElementsByTagName('parsererror')).toHaveLength(0);
  return parsed;
}

function text(document: Document, tag: string) {
  return document.getElementsByTagName(tag).item(0)?.textContent;
}

function fixture(type: 'CREDIT_NOTE' | 'DEBIT_NOTE') {
  const decimal = (value: string) => new Prisma.Decimal(value);
  return {
    id: '11111111-1111-1111-1111-111111111111',
    tenantId: '22222222-2222-2222-2222-222222222222',
    environment: 'BETA',
    documentType: type,
    series: 'FC01',
    number: 7,
    issueDate: new Date('2026-11-02T00:00:00.000Z'),
    issueTime: null,
    currency: 'PEN',
    paymentMethod: 'CASH',
    reasonCode: '07',
    reasonDescription: 'Devolución por ítem',
    issuerSnapshot: {
      ruc: '20123456789',
      legalName: 'EMPRESA DEMO SAC',
      tradeName: 'DEMO',
      address: 'AV. DEMO 123',
      ubigeo: '150101',
      establishmentCode: '0000',
    },
    customerSnapshot: {
      documentType: 'RUC',
      documentNumber: '20987654321',
      name: 'CLIENTE SAC',
    },
    taxableAmount: decimal('50'),
    exemptAmount: decimal('0'),
    unaffectedAmount: decimal('0'),
    discountAmount: decimal('0'),
    taxAmount: decimal('9'),
    totalAmount: decimal('59'),
    installments: [],
    references: [
      {
        referencedType: 'INVOICE',
        referencedSeries: 'F001',
        referencedNumber: 42,
      },
    ],
    lines: [
      {
        lineNumber: 1,
        externalId: 'NOTE-ITEM-1',
        sku: 'SKU-1',
        description: 'Servicio devuelto',
        unitCode: 'ZZ',
        quantity: decimal('1'),
        unitPrice: decimal('59'),
        unitPriceIncludesTax: true,
        taxAffectationCode: '10',
        unitValue: decimal('50'),
        discountAmount: decimal('0'),
        lineValue: decimal('50'),
        taxAmount: decimal('9'),
        totalAmount: decimal('59'),
      },
    ],
  } as unknown as UblDocument;
}
