import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { PrismaService } from '../../database/src/prisma.service';
import { PrivateObjectStorageService } from '../../storage/src/private-object-storage.service';
import { DespatchGuidePdfRendererService } from './despatch-guide-pdf-renderer.service';

const DESPATCH_GUIDE_A4_TEMPLATE_VERSION = 2;

@Injectable()
export class DespatchGuidePdfArtifactService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: PrivateObjectStorageService,
    private readonly renderer: DespatchGuidePdfRendererService,
  ) {}

  async generate(guideId: string) {
    const guide = await this.prisma.despatchGuide.findUnique({
      where: { id: guideId },
      include: {
        recipient: true,
        carrier: true,
        vehicles: true,
        drivers: true,
        items: { orderBy: { lineNumber: 'asc' } },
        artifacts: true,
      },
    });
    if (!guide) throw new NotFoundException('Guía de remisión no encontrada');

    if (!['ACCEPTED', 'ACCEPTED_WITH_OBSERVATIONS'].includes(guide.status)) {
      throw new ConflictException(
        'El PDF solo se genera para una GRE aceptada por SUNAT',
      );
    }
    if (!guide.sunatHash || !guide.respondedAt) {
      throw new ConflictException(
        'La respuesta SUNAT de la GRE está incompleta',
      );
    }
    const zip = guide.artifacts.find((artifact) => artifact.type === 'ZIP');
    if (!zip) throw new ConflictException('La GRE no tiene ZIP firmado');

    const body = await this.renderer.render(guide);
    const baseName = zip.fileName.slice(0, -4);
    const fileName = `${baseName}.a4-v${DESPATCH_GUIDE_A4_TEMPLATE_VERSION}.pdf`;
    const prefix = zip.objectKey.slice(0, zip.objectKey.lastIndexOf('/') + 1);
    const objectKey = `${prefix}${fileName}`;
    await this.storage.put(objectKey, body, 'application/pdf');
    return this.prisma.despatchGuideArtifact.upsert({
      where: { guideId_type: { guideId, type: 'PDF_A4' } },
      create: {
        guideId,
        type: 'PDF_A4',
        fileName,
        objectKey,
        contentType: 'application/pdf',
        sizeBytes: body.length,
        sha256: createHash('sha256').update(body).digest('hex'),
      },
      update: {
        fileName,
        objectKey,
        contentType: 'application/pdf',
        sizeBytes: body.length,
        sha256: createHash('sha256').update(body).digest('hex'),
      },
    });
  }
}
