import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../../libs/database/src/prisma.service';
import { DespatchGuidePdfArtifactService } from '../../../libs/pdf/src/despatch-guide-pdf-artifact.service';
import { DespatchGuideSunatRestService } from '../../../libs/sunat/src/despatch-guide-sunat-rest.service';
import { DespatchGuideArtifactService } from '../../../libs/ubl/src/despatch-guide-artifact.service';
import { WebhookEventPublisherService } from '../../../libs/webhooks/src/webhook-event-publisher.service';
import { DespatchGuideJobRepository } from './despatch-guide-job.repository';
import { ClaimedDespatchGuideJob } from './despatch-guide-job.types';

@Injectable()
export class DespatchGuideJobProcessorService {
  private readonly logger = new Logger(DespatchGuideJobProcessorService.name);
  private readonly retryBaseMs: number;
  private readonly retryMaxMs: number;

  constructor(
    config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly repository: DespatchGuideJobRepository,
    private readonly artifacts: DespatchGuideArtifactService,
    private readonly sunat: DespatchGuideSunatRestService,
    private readonly pdf: DespatchGuidePdfArtifactService,
    private readonly webhooks: WebhookEventPublisherService,
  ) {
    this.retryBaseMs = config.getOrThrow<number>('WORKER_RETRY_BASE_MS');
    this.retryMaxMs = config.getOrThrow<number>('WORKER_RETRY_MAX_MS');
  }

  async process(job: ClaimedDespatchGuideJob, workerId: string) {
    try {
      const guide = await this.prisma.despatchGuide.findUniqueOrThrow({
        where: { id: job.guideId },
      });
      await this.artifacts.generate(guide.id, {
        tenantId: guide.tenantId,
        applicationId: guide.applicationId,
        environment: guide.environment,
      });
      if (guide.environment === 'BETA') {
        await this.prisma.$transaction(async (tx) => {
          await tx.despatchGuide.update({
            where: { id: guide.id },
            data: {
              status: 'VALIDATED_BETA',
              sunatMessage:
                'GRE validada internamente en BETA; no fue enviada a SUNAT.',
              respondedAt: new Date(),
            },
          });
          await this.webhooks.publishDespatchGuide(
            tx,
            guide.id,
            'despatch_guide.beta_validated',
          );
        });
      } else {
        const result = await this.sunat.submit(guide.id);
        if (
          result.status === 'ACCEPTED' ||
          result.status === 'ACCEPTED_WITH_OBSERVATIONS'
        ) {
          await this.pdf.generate(guide.id);
        }
      }
      await this.repository.complete(job, workerId);
    } catch (error) {
      const delay = Math.min(
        this.retryMaxMs,
        this.retryBaseMs * 2 ** Math.max(0, job.attempts - 1),
      );
      await this.repository.fail(
        job,
        workerId,
        error,
        new Date(Date.now() + delay),
      );
      this.logger.warn(
        JSON.stringify({
          event: 'despatch_guide_job.failed',
          guideId: job.guideId,
          attempt: job.attempts,
          error: error instanceof Error ? error.message : 'Error desconocido',
        }),
      );
    }
  }
}
