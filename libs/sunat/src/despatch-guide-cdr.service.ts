import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { PrismaService } from '../../database/src/prisma.service';
import { PrivateObjectStorageService } from '../../storage/src/private-object-storage.service';
import { SunatCdrParserService } from './sunat-cdr-parser.service';
import { WebhookEventPublisherService } from '../../webhooks/src/webhook-event-publisher.service';

const FINAL_STATUSES = [
  'ACCEPTED',
  'ACCEPTED_WITH_OBSERVATIONS',
  'REJECTED',
] as const;

@Injectable()
export class DespatchGuideCdrService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: PrivateObjectStorageService,
    private readonly parser: SunatCdrParserService,
    private readonly webhooks: WebhookEventPublisherService,
  ) {}

  async process(guideId: string, cdrZip: Buffer) {
    const guide = await this.prisma.despatchGuide.findUnique({
      where: { id: guideId },
      include: { artifacts: true },
    });
    if (!guide) throw new NotFoundException('Guía de remisión no encontrada');

    const existing = guide.artifacts.find(
      (artifact) => artifact.type === 'CDR',
    );
    if (
      existing &&
      guide.respondedAt &&
      FINAL_STATUSES.includes(guide.status as (typeof FINAL_STATUSES)[number])
    ) {
      return {
        status: guide.status,
        code: guide.sunatCode ?? '',
        message: guide.sunatMessage ?? '',
        observations: guide.sunatObservations,
      };
    }

    const signedZip = guide.artifacts.find(
      (artifact) => artifact.type === 'ZIP',
    );
    if (!signedZip) {
      throw new ConflictException('La GRE no tiene ZIP firmado');
    }
    const result = this.parser.parse(cdrZip, `${guide.series}-${guide.number}`);
    const fileName = `R-${signedZip.fileName}`;
    const prefix = signedZip.objectKey.slice(
      0,
      signedZip.objectKey.lastIndexOf('/') + 1,
    );
    const objectKey = `${prefix}${fileName}`;
    await this.storage.put(objectKey, cdrZip, 'application/zip');

    const now = new Date();
    const sha256 = createHash('sha256').update(cdrZip).digest('hex');
    await this.prisma.$transaction(async (tx) => {
      await tx.despatchGuideArtifact.upsert({
        where: { guideId_type: { guideId, type: 'CDR' } },
        create: {
          guideId,
          type: 'CDR',
          fileName,
          objectKey,
          contentType: 'application/zip',
          sizeBytes: cdrZip.length,
          sha256,
        },
        update: {
          fileName,
          objectKey,
          contentType: 'application/zip',
          sizeBytes: cdrZip.length,
          sha256,
        },
      });
      await tx.despatchGuide.update({
        where: { id: guideId },
        data: {
          status: result.status,
          sunatCode: result.code.slice(0, 40),
          sunatMessage: result.message.slice(0, 1_000),
          sunatObservations: result.observations,
          submittedAt: guide.submittedAt ?? now,
          respondedAt: now,
        },
      });
      await tx.auditEvent.create({
        data: {
          tenantId: guide.tenantId,
          applicationId: guide.applicationId,
          actorType: 'SYSTEM',
          actorId: 'billing-api',
          action: `sunat.despatch_cdr.${result.status.toLowerCase()}`,
          resourceType: 'despatch_guide',
          resourceId: guideId,
          data: {
            environment: guide.environment,
            code: result.code,
            observations: result.observations,
          },
        },
      });
      const eventType =
        result.status === 'ACCEPTED_WITH_OBSERVATIONS'
          ? 'despatch_guide.accepted_with_observations'
          : result.status === 'ACCEPTED'
            ? 'despatch_guide.accepted'
            : 'despatch_guide.rejected';
      await this.webhooks.publishDespatchGuide(tx, guideId, eventType);
    });
    return result;
  }
}
