import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ArtifactType } from '@prisma/client';
import { createHash } from 'node:crypto';
import { PrismaService } from '../../database/src/prisma.service';
import { PrivateObjectStorageService } from '../../storage/src/private-object-storage.service';
import { PdfRendererService } from './pdf-renderer.service';
import type { PdfFormat } from './pdf.types';

const PDF_FORMATS: ReadonlyArray<{
  type: ArtifactType;
  format: PdfFormat;
  suffix: string;
}> = [
  { type: ArtifactType.PDF_A4, format: 'A4', suffix: 'a4' },
  { type: ArtifactType.PDF_TICKET, format: 'TICKET', suffix: 'ticket' },
];

@Injectable()
export class PdfArtifactService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: PrivateObjectStorageService,
    private readonly renderer: PdfRendererService,
  ) {}

  async generate(documentId: string) {
    const document = await this.prisma.taxDocument.findUnique({
      where: { id: documentId },
      include: {
        lines: true,
        installments: true,
        artifacts: true,
        references: true,
      },
    });
    if (!document) throw new NotFoundException('Documento no encontrado');

    const existing = new Map(
      document.artifacts.map((artifact) => [artifact.type, artifact]),
    );
    if (PDF_FORMATS.every(({ type }) => existing.has(type))) {
      return PDF_FORMATS.map(({ type }) => existing.get(type)!);
    }
    if (!['ACCEPTED', 'ACCEPTED_WITH_OBSERVATIONS'].includes(document.status)) {
      throw new ConflictException(
        'Los PDF solo se generan para comprobantes aceptados por SUNAT',
      );
    }
    if (!document.sunatHash || !document.respondedAt) {
      throw new ConflictException('La respuesta SUNAT esta incompleta');
    }
    const zip = document.artifacts.find((item) => item.type === 'ZIP');
    if (!zip) throw new ConflictException('El documento no tiene ZIP firmado');

    const baseName = zip.fileName.slice(0, -4);
    const prefix = zip.objectKey.slice(0, zip.objectKey.lastIndexOf('/') + 1);
    const results = [];
    for (const definition of PDF_FORMATS) {
      const persisted = existing.get(definition.type);
      if (persisted) {
        results.push(persisted);
        continue;
      }
      const body = await this.renderer.render(document, definition.format);
      const fileName = `${baseName}.${definition.suffix}.pdf`;
      const objectKey = `${prefix}${fileName}`;
      await this.storage.put(objectKey, body, 'application/pdf');
      results.push(
        await this.prisma.artifact.upsert({
          where: {
            documentId_type: { documentId, type: definition.type },
          },
          create: {
            documentId,
            type: definition.type,
            fileName,
            objectKey,
            contentType: 'application/pdf',
            sizeBytes: body.length,
            sha256: createHash('sha256').update(body).digest('hex'),
          },
          update: {},
        }),
      );
    }
    return results;
  }
}
