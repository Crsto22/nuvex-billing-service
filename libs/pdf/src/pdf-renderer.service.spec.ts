import { Prisma } from '@prisma/client';
import { PdfRendererService } from './pdf-renderer.service';
import { PdfTaxDocument } from './pdf.types';
import { SunatQrService } from './sunat-qr.service';
import sharp from 'sharp';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

describe('PdfRendererService', () => {
  const renderer = new PdfRendererService(new SunatQrService());

  it('no presenta un documento en proceso como aceptado', () => {
    const document = { ...fixture('RECEIPT'), status: 'PROCESSING' };
    expect(
      (
        renderer as unknown as {
          status: (value: PdfTaxDocument) => string | null;
        }
      ).status(document),
    ).toBeNull();
  });

  it('identifica un documento rechazado', () => {
    const document = { ...fixture('INVOICE'), status: 'REJECTED' };
    expect(
      (
        renderer as unknown as {
          status: (value: PdfTaxDocument) => string | null;
        }
      ).status(document),
    ).toBe('RECHAZADO');
  });

  it.each([
    ['PROCESSING', 'receipt-processing-production.pdf'],
    ['REJECTED', 'receipt-rejected-production.pdf'],
  ] as const)(
    'genera ticket de producción con estado %s',
    async (status, fileName) => {
      const document = {
        ...fixture('RECEIPT'),
        environment: 'PRODUCTION',
        status,
        sunatCode: status === 'REJECTED' ? '1234' : null,
        sunatMessage:
          status === 'REJECTED' ? 'El comprobante fue rechazado' : null,
        respondedAt: status === 'REJECTED' ? new Date() : null,
      } as PdfTaxDocument;
      const result = await renderer.render(
        document,
        'TICKET',
        await testLogo(),
      );

      expect(result.subarray(0, 5).toString()).toBe('%PDF-');
      await saveVisual(fileName, result);
    },
    20_000,
  );

  it.each([
    ['INVOICE', 'A4'],
    ['INVOICE', 'TICKET'],
    ['RECEIPT', 'A4'],
    ['RECEIPT', 'TICKET'],
    ['CREDIT_NOTE', 'A4'],
    ['CREDIT_NOTE', 'TICKET'],
    ['DEBIT_NOTE', 'A4'],
    ['DEBIT_NOTE', 'TICKET'],
  ] as const)(
    'genera un PDF válido para %s en formato %s',
    async (documentType, format) => {
      const result = await renderer.render(
        fixture(documentType),
        format,
        await testLogo(),
      );

      expect(result.subarray(0, 5).toString()).toBe('%PDF-');
      expect(result.length).toBeGreaterThan(2_000);
      await saveVisual(
        `${documentType.toLowerCase()}-${format.toLowerCase()}.pdf`,
        result,
      );
    },
    20_000,
  );
});

async function testLogo() {
  const body = await sharp({
    create: {
      width: 240,
      height: 80,
      channels: 4,
      background: { r: 20, g: 55, b: 95, alpha: 1 },
    },
  })
    .png()
    .toBuffer();
  return { body, version: 1, width: 240, height: 80 };
}

async function saveVisual(fileName: string, body: Buffer) {
  const output = process.env.PDF_VISUAL_QA_OUTPUT;
  if (!output) return;
  const directory = resolve(output);
  await mkdir(directory, { recursive: true });
  await writeFile(resolve(directory, fileName), body);
}

function fixture(
  documentType: 'INVOICE' | 'RECEIPT' | 'CREDIT_NOTE' | 'DEBIT_NOTE',
) {
  const decimal = (value: string) => new Prisma.Decimal(value);
  const isInvoice = documentType === 'INVOICE';
  const isNote = ['CREDIT_NOTE', 'DEBIT_NOTE'].includes(documentType);
  return {
    documentType,
    environment: 'BETA',
    series: isInvoice
      ? 'F001'
      : documentType === 'RECEIPT'
        ? 'B001'
        : documentType === 'CREDIT_NOTE'
          ? 'FC01'
          : 'FD01',
    number: 42,
    issueDate: new Date('2026-11-01T00:00:00.000Z'),
    issueTime: '10:30:00',
    currency: 'PEN',
    paymentMethod: 'CASH',
    status: 'ACCEPTED',
    issuerSnapshot: {
      ruc: '20123456789',
      legalName: 'EMPRESA DEMO SAC',
      tradeName: 'NUVEX DEMO',
      address: 'AV. DEMO 123, LIMA',
      ubigeo: '150101',
      establishmentCode: '0000',
    },
    customerSnapshot: {
      documentType: isInvoice || isNote ? 'RUC' : 'DNI',
      documentNumber: isInvoice || isNote ? '20987654321' : '12345678',
      name: isInvoice || isNote ? 'CLIENTE EMPRESA SAC' : 'CLIENTE FINAL',
      address: 'JR. CLIENTE 456, LIMA',
    },
    taxableAmount: decimal('100'),
    exemptAmount: decimal('0'),
    unaffectedAmount: decimal('0'),
    discountAmount: decimal('0'),
    taxAmount: decimal('18'),
    totalAmount: decimal('118'),
    sunatCode: '0',
    sunatMessage: 'La factura ha sido aceptada',
    sunatHash: 'QmFzZTY0RGlnZXN0VmFsdWU=',
    respondedAt: new Date('2026-11-01T10:31:00.000Z'),
    artifacts: [],
    installments: [],
    reasonCode:
      documentType === 'CREDIT_NOTE'
        ? '07'
        : documentType === 'DEBIT_NOTE'
          ? '02'
          : null,
    reasonDescription: isNote ? 'Ajuste del comprobante original' : null,
    references: isNote
      ? [
          {
            referencedDocumentId: '00000000-0000-0000-0000-000000000099',
            referencedType: 'INVOICE',
            referencedSeries: 'F001',
            referencedNumber: 41,
          },
        ]
      : [],
    lines: [
      {
        lineNumber: 1,
        description: 'Servicio profesional de implementación',
        unitCode: 'ZZ',
        quantity: decimal('1'),
        unitValue: decimal('100'),
        totalAmount: decimal('118'),
      },
    ],
  } as unknown as PdfTaxDocument;
}
