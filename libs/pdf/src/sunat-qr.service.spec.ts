import { Prisma } from '@prisma/client';
import { PdfTaxDocument } from './pdf.types';
import { SunatQrService } from './sunat-qr.service';

describe('SunatQrService', () => {
  it('construye la cadena QR en el orden exigido por SUNAT', () => {
    const service = new SunatQrService();
    const document = {
      documentType: 'INVOICE',
      series: 'F001',
      number: 42,
      taxAmount: new Prisma.Decimal('18'),
      totalAmount: new Prisma.Decimal('118'),
      issueDate: new Date('2026-11-01T00:00:00.000Z'),
      issuerSnapshot: { ruc: '20123456789' },
      customerSnapshot: {
        documentType: 'RUC',
        documentNumber: '20987654321',
      },
      sunatHash: 'BASE64DIGEST=',
    } as unknown as PdfTaxDocument;

    expect(service.payload(document)).toBe(
      '20123456789|01|F001|42|18.00|118.00|2026-11-01|6|20987654321|BASE64DIGEST=|',
    );
  });
});
