import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../libs/database/src/prisma.service';
import { WebhookEventPublisherService } from '../../../libs/webhooks/src/webhook-event-publisher.service';
import { ClaimedDespatchGuideJob } from './despatch-guide-job.types';

@Injectable()
export class DespatchGuideJobRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly webhooks: WebhookEventPublisherService,
  ) {}

  async claim(workerId: string, lockTimeoutMs: number) {
    const rows = await this.prisma.$queryRaw<
      ClaimedDespatchGuideJob[]
    >(Prisma.sql`
      WITH candidate AS (
        SELECT id FROM despatch_guide_emission_job
        WHERE (status = 'PENDING' AND next_attempt_at <= NOW())
           OR (status = 'PROCESSING' AND locked_at < NOW() - (${lockTimeoutMs} * INTERVAL '1 millisecond'))
        ORDER BY next_attempt_at, created_at
        FOR UPDATE SKIP LOCKED LIMIT 1
      )
      UPDATE despatch_guide_emission_job AS job
      SET status = 'PROCESSING', attempts = job.attempts + 1,
          locked_at = NOW(), locked_by = ${workerId},
          last_error_code = NULL, last_error_message = NULL
      FROM candidate WHERE job.id = candidate.id
      RETURNING job.id, job.guide_id AS "guideId", job.attempts,
                job.max_attempts AS "maxAttempts"
    `);
    const job = rows[0];
    if (!job) return null;
    await this.prisma.$transaction(async (tx) => {
      await tx.despatchGuide.update({
        where: { id: job.guideId },
        data: { status: 'PROCESSING' },
      });
      await this.webhooks.publishDespatchGuide(
        tx,
        job.guideId,
        'despatch_guide.processing',
      );
    });
    return job;
  }

  async complete(job: ClaimedDespatchGuideJob, workerId: string) {
    const result = await this.prisma.despatchGuideEmissionJob.updateMany({
      where: { id: job.id, status: 'PROCESSING', lockedBy: workerId },
      data: {
        status: 'DONE',
        lockedAt: null,
        lockedBy: null,
        processedAt: new Date(),
      },
    });
    if (result.count !== 1)
      throw new Error(`Se perdió el bloqueo GRE ${job.id}`);
  }

  async fail(
    job: ClaimedDespatchGuideJob,
    workerId: string,
    error: unknown,
    nextAttemptAt: Date,
  ) {
    const retryable = isRetryable(error);
    const dead = !retryable || job.attempts >= job.maxAttempts;
    const message = safeMessage(error);
    await this.prisma.$transaction(async (tx) => {
      const result = await tx.despatchGuideEmissionJob.updateMany({
        where: { id: job.id, status: 'PROCESSING', lockedBy: workerId },
        data: {
          status: dead ? 'DEAD' : 'PENDING',
          lockedAt: null,
          lockedBy: null,
          nextAttemptAt: dead ? new Date() : nextAttemptAt,
          lastErrorCode:
            error instanceof Error ? error.name.slice(0, 40) : 'ERROR',
          lastErrorMessage: message,
          processedAt: dead ? new Date() : null,
        },
      });
      if (result.count !== 1)
        throw new Error(`Se perdió el bloqueo GRE ${job.id}`);
      if (dead) {
        await tx.despatchGuide.update({
          where: { id: job.guideId },
          data: { status: 'FAILED', sunatMessage: message },
        });
        await this.webhooks.publishDespatchGuide(
          tx,
          job.guideId,
          'despatch_guide.failed',
        );
      }
    });
    return dead;
  }
}

function isRetryable(error: unknown) {
  if (error && typeof error === 'object' && 'retryable' in error) {
    return Boolean(error.retryable);
  }
  if (error && typeof error === 'object' && 'getStatus' in error) {
    const status = Number((error as { getStatus(): number }).getStatus());
    return status === 408 || status === 429 || status >= 500;
  }
  return true;
}

function safeMessage(error: unknown) {
  return (error instanceof Error ? error.message : 'Error desconocido')
    .replace(/[\r\n\t]+/g, ' ')
    .slice(0, 1_000);
}
