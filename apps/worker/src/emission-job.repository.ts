import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../libs/database/src/prisma.service';
import { ClaimedEmissionJob, JobFailure } from './emission-job.types';
import { WebhookEventPublisherService } from '../../../libs/webhooks/src/webhook-event-publisher.service';

type ClaimedRow = {
  id: string;
  documentId: string;
  operation: 'ISSUE';
  attempts: number;
  maxAttempts: number;
};

@Injectable()
export class EmissionJobRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly webhooks: WebhookEventPublisherService,
  ) {}

  async claim(workerId: string, lockTimeoutMs: number) {
    const rows = await this.prisma.$queryRaw<ClaimedRow[]>(Prisma.sql`
      WITH candidate AS (
        SELECT id
        FROM emission_job
        WHERE
          (status = 'PENDING' AND next_attempt_at <= NOW())
          OR
          (status = 'PROCESSING' AND locked_at < NOW() - (${lockTimeoutMs} * INTERVAL '1 millisecond'))
        ORDER BY next_attempt_at ASC, created_at ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      )
      UPDATE emission_job AS job
      SET
        status = 'PROCESSING',
        attempts = job.attempts + 1,
        locked_at = NOW(),
        locked_by = ${workerId},
        last_error_code = NULL,
        last_error_message = NULL
      FROM candidate
      WHERE job.id = candidate.id
      RETURNING
        job.id,
        job.document_id AS "documentId",
        job.operation,
        job.attempts,
        job.max_attempts AS "maxAttempts"
    `);
    const job = rows[0];
    if (!job) return null;
    await this.prisma.$transaction(async (tx) => {
      const updated = await tx.taxDocument.updateMany({
        where: {
          id: job.documentId,
          status: { in: ['QUEUED', 'RETRY_SCHEDULED'] },
        },
        data: { status: 'PROCESSING' },
      });
      if (updated.count === 1) {
        await this.webhooks.publish(tx, job.documentId, 'document.processing');
      }
    });
    return job satisfies ClaimedEmissionJob;
  }

  async heartbeat(jobId: string, workerId: string) {
    const result = await this.prisma.emissionJob.updateMany({
      where: { id: jobId, status: 'PROCESSING', lockedBy: workerId },
      data: { lockedAt: new Date() },
    });
    return result.count === 1;
  }

  async complete(job: ClaimedEmissionJob, workerId: string) {
    await this.prisma.$transaction(async (tx) => {
      const owned = await tx.emissionJob.updateMany({
        where: { id: job.id, status: 'PROCESSING', lockedBy: workerId },
        data: {
          status: 'DONE',
          lockedAt: null,
          lockedBy: null,
          processedAt: new Date(),
        },
      });
      if (owned.count !== 1) throw new LostJobLockError(job.id);
    });
  }

  async fail(
    job: ClaimedEmissionJob,
    workerId: string,
    failure: JobFailure,
    nextAttemptAt: Date | null,
  ) {
    const dead = !failure.retryable || job.attempts >= job.maxAttempts;
    await this.prisma.$transaction(async (tx) => {
      const owned = await tx.emissionJob.updateMany({
        where: { id: job.id, status: 'PROCESSING', lockedBy: workerId },
        data: {
          status: dead ? 'DEAD' : 'PENDING',
          lockedAt: null,
          lockedBy: null,
          nextAttemptAt: dead ? new Date() : nextAttemptAt!,
          lastErrorCode: failure.code,
          lastErrorMessage: failure.message.slice(0, 1_000),
          processedAt: dead ? new Date() : null,
        },
      });
      if (owned.count !== 1) throw new LostJobLockError(job.id);
      const document = await tx.taxDocument.updateMany({
        where: { id: job.documentId, respondedAt: null },
        data: { status: dead ? 'FAILED' : 'RETRY_SCHEDULED' },
      });
      if (document.count === 1) {
        await this.webhooks.publish(
          tx,
          job.documentId,
          dead ? 'document.failed' : 'document.retry_scheduled',
        );
      }
    });
    return dead;
  }
}

export class LostJobLockError extends Error {
  constructor(jobId: string) {
    super(`El worker perdio el bloqueo del trabajo ${jobId}`);
    this.name = 'LostJobLockError';
  }
}
