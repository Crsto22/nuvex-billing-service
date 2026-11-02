import { DOMParser } from '@xmldom/xmldom';
import { Prisma } from '@prisma/client';
import { UblInvoiceBuilderService } from './ubl-invoice-builder.service';
import { UblDocument } from './ubl.types';

describe('UblInvoiceBuilderService', () => {
  const service = new UblInvoiceBuilderService();

  it('genera una factura UBL 2.1 con importes y pago al contado', () => {
    const xml = service.build(fixture());
    const parsed = new DOMParser().parseFromString(xml, 'application/xml');

    expect(parsed.getElementsByTagName('parsererror')).toHaveLength(0);
    expect(text(parsed, 'cbc:UBLVersionID')).toBe('2.1');
    expect(text(parsed, 'cbc:InvoiceTypeCode')).toBe('01');
    expect(text(parsed, 'cbc:ID')).toBe('F001-42');
    expect(text(parsed, 'cbc:PaymentMeansID')).toBe('Contado');
    expect(text(parsed, 'cbc:TaxAmount')).toBe('18.00');
    expect(text(parsed, 'cbc:PayableAmount')).toBe('118.00');
    expect(parsed.getElementsByTagName('cac:InvoiceLine')).toHaveLength(1);
    expect(parsed.getElementsByTagName('ext:ExtensionContent')).toHaveLength(1);
  });

  it('usa el codigo 03 y documento 0 para una boleta sin documento', () => {
    const document = fixture();
    document.documentType = 'RECEIPT';
    document.series = 'B001';
    document.customerSnapshot = {
      documentType: 'NONE',
      name: 'CLIENTE',
    };
    const parsed = new DOMParser().parseFromString(
      service.build(document),
      'application/xml',
    );

    expect(text(parsed, 'cbc:InvoiceTypeCode')).toBe('03');
    const ids = parsed.getElementsByTagName('cbc:ID');
    expect(
      Array.from({ length: ids.length }, (_, index) => ids.item(index)).some(
        (node) => node?.getAttribute('schemeID') === '0',
      ),
    ).toBe(true);
  });
});

function text(document: Document, tag: string) {
  return document.getElementsByTagName(tag).item(0)?.textContent;
}

function fixture() {
  const decimal = (value: string) => new Prisma.Decimal(value);
  return {
    id: '11111111-1111-1111-1111-111111111111',
    tenantId: '22222222-2222-2222-2222-222222222222',
    environment: 'BETA',
    documentType: 'INVOICE',
    series: 'F001',
    number: 42,
    issueDate: new Date('2026-11-01T00:00:00.000Z'),
    issueTime: '10:30:00',
    currency: 'PEN',
    paymentMethod: 'CASH',
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
    taxableAmount: decimal('100'),
    exemptAmount: decimal('0'),
    unaffectedAmount: decimal('0'),
    discountAmount: decimal('0'),
    taxAmount: decimal('18'),
    totalAmount: decimal('118'),
    installments: [],
    lines: [
      {
        lineNumber: 1,
        externalId: 'ITEM-1',
        sku: 'SKU-1',
        description: 'Servicio de prueba',
        unitCode: 'NIU',
        quantity: decimal('1'),
        unitPrice: decimal('118'),
        unitPriceIncludesTax: true,
        taxAffectationCode: '10',
        unitValue: decimal('100'),
        discountAmount: decimal('0'),
        lineValue: decimal('100'),
        taxAmount: decimal('18'),
        totalAmount: decimal('118'),
      },
    ],
  } as unknown as UblDocument;
}
