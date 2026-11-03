import { Prisma } from '@prisma/client';
import { DespatchGuidePdfRendererService } from './despatch-guide-pdf-renderer.service';
import { DespatchGuideQrService } from './despatch-guide-qr.service';
import { PdfDespatchGuide } from './despatch-guide-pdf.types';
import sharp from 'sharp';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

describe('DespatchGuidePdfRendererService', () => {
  const renderer = new DespatchGuidePdfRendererService(
    new DespatchGuideQrService(),
  );

  it.each(['PRIVATE', 'PUBLIC'] as const)(
    'genera un PDF A4 válido para transporte %s',
    async (mode) => {
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
      const result = await renderer.render(guide(mode), {
        body,
        version: 1,
        width: 240,
        height: 80,
      });
      expect(result.subarray(0, 5).toString()).toBe('%PDF-');
      expect(result.length).toBeGreaterThan(3_000);
      const output = process.env.PDF_VISUAL_QA_OUTPUT;
      if (output) {
        const directory = resolve(output);
        await mkdir(directory, { recursive: true });
        await writeFile(
          resolve(directory, `gre-${mode.toLowerCase()}.pdf`),
          result,
        );
      }
    },
    20_000,
  );
});

function guide(mode: 'PRIVATE' | 'PUBLIC') {
  const id = '00000000-0000-0000-0000-000000000001';
  return {
    id,
    series: 'T001',
    number: 42,
    issueDate: new Date('2026-11-02T00:00:00.000Z'),
    issueTime: '10:30:00',
    transferStartDate: new Date('2026-11-03T00:00:00.000Z'),
    carrierDeliveryDate:
      mode === 'PUBLIC' ? new Date('2026-11-02T00:00:00.000Z') : null,
    transferReasonCode: '01',
    transferReasonDescription: 'Venta',
    transportMode: mode,
    grossWeight: new Prisma.Decimal('125.500'),
    weightUnit: 'KGM',
    packageCount: 10,
    departureUbigeo: '150132',
    departureAddress: 'AV. LOS CIRUELOS 500, LIMA',
    arrivalUbigeo: '150101',
    arrivalAddress: 'AV. DESTINO 100, LIMA',
    relatedDocumentType: '01',
    relatedDocumentNumber: 'F001-125',
    issuerSnapshot: {
      ruc: '20615136663',
      legalName: 'CORDEX T & D S.A.C.',
      tradeName: 'CORDEX T & D',
      address: 'AV. LOS CIRUELOS 500, LIMA',
      ubigeo: '150132',
      establishmentCode: '0000',
    },
    status: 'ACCEPTED',
    sunatCode: '0',
    sunatMessage: 'La guía fue aceptada',
    sunatHash: 'QmFzZTY0RGlnZXN0VmFsdWU=',
    respondedAt: new Date(),
    recipient: {
      name: 'CLIENTE PRUEBA SAC',
      documentType: 'RUC',
      documentNumber: '20100070970',
    },
    carrier:
      mode === 'PUBLIC'
        ? {
            ruc: '20555555551',
            legalName: 'TRANSPORTES PRUEBA SAC',
            mtcRegistrationNumber: 'MTC-12345',
          }
        : null,
    vehicles: mode === 'PRIVATE' ? [{ plate: 'ABC123', primary: true }] : [],
    drivers:
      mode === 'PRIVATE'
        ? [
            {
              documentNumber: '12345678',
              firstNames: 'JUAN',
              lastNames: 'PEREZ',
              licenseNumber: 'Q12345678',
              primary: true,
            },
          ]
        : [],
    items: [
      {
        lineNumber: 1,
        quantity: new Prisma.Decimal('10'),
        unitCode: 'NIU',
        sku: 'SKU-1',
        description: 'PRODUCTO DE PRUEBA PARA TRASLADO',
      },
    ],
    artifacts: [],
  } as unknown as PdfDespatchGuide;
}
