import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../libs/database/src/prisma.service';
import { JobFailure } from './emission-job.types';
import { LostJobLockError } from './emission-job.repository';
import { ClaimedSunatVoidJob } from './sunat-void-job.types';
import { WebhookEventPublisherService } from '../../../libs/webhooks/src/webhook-event-publisher.service';

@Injectable()
export class SunatVoidJobRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly webhooks: WebhookEventPublisherService,
  ) {}

  async claim(workerId: string, lockTimeoutMs: number) {
    const rows = await this.prisma.$queryRaw<ClaimedSunatVoidJob[]>(Prisma.sql`
      WITH candidate AS (
        SELECT id
        FROM sunat_void_job
        WHERE
          (status = 'PENDING' AND next_attempt_at <= NOW())
          OR
          (status = 'PROCESSING' AND locked_at < NOW() - (${lockTimeoutMs} * INTERVAL '1 millisecond'))
        ORDER BY next_attempt_at ASC, created_at ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      )
      UPDATE sunat_void_job AS job
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
        job.void_request_id AS "voidRequestId",
        job.attempts,
        job.max_attempts AS "maxAttempts"
    `);
    return rows[0] ?? null;
  }

  async heartbeat(jobId: string, workerId: string) {
    const result = await this.prisma.sunatVoidJob.updateMany({
      where: { id: jobId, status: 'PROCESSING', lockedBy: workerId },
      data: { lockedAt: new Date() },
    });
    return result.count === 1;
  }

  async complete(job: ClaimedSunatVoidJob, workerId: string) {
    const result = await this.prisma.sunatVoidJob.updateMany({
      where: { id: job.id, status: 'PROCESSING', lockedBy: workerId },
      data: {
        status: 'DONE',
        lockedAt: null,
        lockedBy: null,
        processedAt: new Date(),
      },
    });
    if (result.count !== 1) throw new LostJobLockError(job.id);
  }

  async fail(
    job: ClaimedSunatVoidJob,
    workerId: string,
    failure: JobFailure,
    nextAttemptAt: Date | null,
  ) {
    const dead = !failure.retryable || job.attempts >= job.maxAttempts;
    await this.prisma.$transaction(async (tx) => {
      const result = await tx.sunatVoidJob.updateMany({
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
      if (result.count !== 1) throw new LostJobLockError(job.id);
      if (dead) {
        const updated = await tx.sunatVoidRequest.updateMany({
          where: {
            id: job.voidRequestId,
            status: { notIn: ['ACCEPTED', 'REJECTED'] },
          },
          data: {
            status: 'FAILED',
            sunatMessage: failure.message.slice(0, 1_000),
          },
        });
        if (updated.count === 1) {
          await this.webhooks.publishVoidRequest(
            tx,
            job.voidRequestId,
            'sunat_void.failed',
          );
        }
      }
    });
    return dead;
  }
}
