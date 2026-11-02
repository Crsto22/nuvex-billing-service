import { Prisma } from '@prisma/client';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { PdfRendererService } from '../libs/pdf/src/pdf-renderer.service';
import { PdfTaxDocument } from '../libs/pdf/src/pdf.types';
import { SunatQrService } from '../libs/pdf/src/sunat-qr.service';

async function main() {
  const output = resolve('output/pdf');
  await mkdir(output, { recursive: true });
  const renderer = new PdfRendererService(new SunatQrService());
  for (const [documentType, format, fileName] of [
    ['INVOICE', 'A4', 'muestra-factura-a4.pdf'],
    ['INVOICE', 'TICKET', 'muestra-factura-ticket.pdf'],
    ['RECEIPT', 'A4', 'muestra-boleta-a4.pdf'],
    ['RECEIPT', 'TICKET', 'muestra-boleta-ticket.pdf'],
  ] as const) {
    await writeFile(
      resolve(output, fileName),
      await renderer.render(fixture(documentType), format),
    );
  }
}

function fixture(documentType: 'INVOICE' | 'RECEIPT') {
  const decimal = (value: string) => new Prisma.Decimal(value);
  return {
    documentType,
    series: documentType === 'INVOICE' ? 'F001' : 'B001',
    number: 42,
    issueDate: new Date('2026-11-01T00:00:00.000Z'),
    issueTime: '10:30:00',
    currency: 'PEN',
    paymentMethod: documentType === 'INVOICE' ? 'CREDIT' : 'CASH',
    status: 'ACCEPTED_WITH_OBSERVATIONS',
    issuerSnapshot: {
      ruc: '20123456789',
      legalName: 'EMPRESA DEMOSTRACIÓN NUVEX S.A.C.',
      tradeName: 'NUVEX DEMO',
      address: 'AV. TECNOLOGÍA 123, MIRAFLORES, LIMA',
      ubigeo: '150122',
      establishmentCode: '0000',
    },
    customerSnapshot: {
      documentType: documentType === 'INVOICE' ? 'RUC' : 'DNI',
      documentNumber: documentType === 'INVOICE' ? '20987654321' : '12345678',
      name:
        documentType === 'INVOICE' ? 'CLIENTE EMPRESA S.A.C.' : 'CLIENTE FINAL',
      address: 'JR. LOS CLIENTES 456, SAN ISIDRO, LIMA',
    },
    taxableAmount: decimal('258.47'),
    exemptAmount: decimal('0'),
    unaffectedAmount: decimal('0'),
    discountAmount: decimal('0'),
    taxAmount: decimal('46.53'),
    totalAmount: decimal('305.00'),
    sunatCode: '0',
    sunatMessage: 'El comprobante ha sido aceptado',
    sunatHash: 'QmFzZTY0RGlnZXN0VmFsdWVEYXRvRGVEZW1vc3RyYWNpb24=',
    respondedAt: new Date('2026-11-01T10:31:00.000Z'),
    artifacts: [],
    installments:
      documentType === 'INVOICE'
        ? [
            {
              number: 1,
              amount: decimal('152.50'),
              dueDate: new Date('2026-11-15T00:00:00.000Z'),
            },
            {
              number: 2,
              amount: decimal('152.50'),
              dueDate: new Date('2026-11-30T00:00:00.000Z'),
            },
          ]
        : [],
    lines: [
      {
        lineNumber: 1,
        description:
          'Implementación y configuración del servicio de facturación electrónica',
        unitCode: 'ZZ',
        quantity: decimal('1'),
        unitValue: decimal('200'),
        totalAmount: decimal('236'),
      },
      {
        lineNumber: 2,
        description: 'Capacitación operativa y acompañamiento técnico',
        unitCode: 'ZZ',
        quantity: decimal('1'),
        unitValue: decimal('58.47'),
        totalAmount: decimal('69'),
      },
    ],
  } as unknown as PdfTaxDocument;
}

void main();
