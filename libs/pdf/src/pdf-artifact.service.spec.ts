import { ConflictException } from '@nestjs/common';
import { PrismaService } from '../../database/src/prisma.service';
import { PrivateObjectStorageService } from '../../storage/src/private-object-storage.service';
import { PdfArtifactService } from './pdf-artifact.service';
import { PdfRendererService } from './pdf-renderer.service';

describe('PdfArtifactService', () => {
  it('genera y persiste A4 y ticket para un comprobante aceptado', async () => {
    const prisma = {
      taxDocument: { findUnique: jest.fn().mockResolvedValue(document()) },
      artifact: {
        upsert: jest.fn(({ create }: { create: { type: string } }) =>
          Promise.resolve({ type: create.type }),
        ),
      },
    };
    const storage = { put: jest.fn().mockResolvedValue(undefined) };
    const renderer = {
      render: jest.fn((_document: unknown, format: string) =>
        Promise.resolve(Buffer.from(`%PDF ${format}`)),
      ),
    };
    const service = new PdfArtifactService(
      prisma as unknown as PrismaService,
      storage as unknown as PrivateObjectStorageService,
      renderer as unknown as PdfRendererService,
    );

    await expect(service.generate('document-1')).resolves.toEqual([
      { type: 'PDF_A4' },
      { type: 'PDF_TICKET' },
    ]);
    expect(renderer.render).toHaveBeenNthCalledWith(1, expect.anything(), 'A4');
    expect(renderer.render).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      'TICKET',
    );
    expect(storage.put).toHaveBeenCalledWith(
      expect.stringMatching(/document\.a4\.pdf$/),
      Buffer.from('%PDF A4'),
      'application/pdf',
    );
    expect(storage.put).toHaveBeenCalledWith(
      expect.stringMatching(/document\.ticket\.pdf$/),
      Buffer.from('%PDF TICKET'),
      'application/pdf',
    );
    expect(prisma.artifact.upsert).toHaveBeenCalledTimes(2);
  });

  it('reutiliza ambos formatos existentes sin volver a renderizar', async () => {
    const existing = [
      { type: 'PDF_A4', fileName: 'document.a4.pdf' },
      { type: 'PDF_TICKET', fileName: 'document.ticket.pdf' },
    ];
    const prisma = {
      taxDocument: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ ...document(), artifacts: existing }),
      },
    };
    const renderer = { render: jest.fn() };
    const service = new PdfArtifactService(
      prisma as unknown as PrismaService,
      {} as PrivateObjectStorageService,
      renderer as unknown as PdfRendererService,
    );

    await expect(service.generate('document-1')).resolves.toEqual(existing);
    expect(renderer.render).not.toHaveBeenCalled();
  });

  it('genera solamente el formato que falta', async () => {
    const existing = { type: 'PDF_A4', fileName: 'document.a4.pdf' };
    const prisma = {
      taxDocument: {
        findUnique: jest.fn().mockResolvedValue({
          ...document(),
          artifacts: [document().artifacts[0], existing],
        }),
      },
      artifact: {
        upsert: jest.fn().mockResolvedValue({ type: 'PDF_TICKET' }),
      },
    };
    const storage = { put: jest.fn().mockResolvedValue(undefined) };
    const renderer = {
      render: jest.fn().mockResolvedValue(Buffer.from('%PDF TICKET')),
    };
    const service = new PdfArtifactService(
      prisma as unknown as PrismaService,
      storage as unknown as PrivateObjectStorageService,
      renderer as unknown as PdfRendererService,
    );

    await expect(service.generate('document-1')).resolves.toEqual([
      existing,
      { type: 'PDF_TICKET' },
    ]);
    expect(renderer.render).toHaveBeenCalledTimes(1);
    expect(renderer.render).toHaveBeenCalledWith(expect.anything(), 'TICKET');
  });

  it('no produce representaciones de un comprobante rechazado', async () => {
    const prisma = {
      taxDocument: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ ...document(), status: 'REJECTED' }),
      },
    };
    const service = new PdfArtifactService(
      prisma as unknown as PrismaService,
      {} as PrivateObjectStorageService,
      {} as PdfRendererService,
    );

    await expect(service.generate('document-1')).rejects.toBeInstanceOf(
      ConflictException,
    );
  });
});

function document() {
  return {
    status: 'ACCEPTED',
    sunatHash: 'digest',
    respondedAt: new Date(),
    lines: [],
    installments: [],
    artifacts: [
      {
        type: 'ZIP',
        fileName: 'document.zip',
        objectKey: 'private/document.zip',
      },
    ],
  };
}
