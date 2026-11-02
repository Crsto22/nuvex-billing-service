import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SunatDailySummaryService } from '../../../libs/sunat/src/sunat-daily-summary.service';
import { LostJobLockError } from './emission-job.repository';
import {
  classifyJobError,
  retryDelayMs,
} from './emission-job-processor.service';
import { SunatVoidJobRepository } from './sunat-void-job.repository';
import { ClaimedSunatVoidJob } from './sunat-void-job.types';

@Injectable()
export class SunatVoidJobProcessorService {
  private readonly logger = new Logger(SunatVoidJobProcessorService.name);
  private readonly lockTimeoutMs: number;
  private readonly retryBaseMs: number;
  private readonly retryMaxMs: number;

  constructor(
    config: ConfigService,
    private readonly repository: SunatVoidJobRepository,
    private readonly summaries: SunatDailySummaryService,
  ) {
    this.lockTimeoutMs = config.getOrThrow<number>('WORKER_LOCK_TIMEOUT_MS');
    this.retryBaseMs = config.getOrThrow<number>('WORKER_RETRY_BASE_MS');
    this.retryMaxMs = config.getOrThrow<number>('WORKER_RETRY_MAX_MS');
  }

  async process(job: ClaimedSunatVoidJob, workerId: string) {
    const stopHeartbeat = this.startHeartbeat(job.id, workerId);
    try {
      await this.summaries.submitVoidRequest(job.voidRequestId);
      await this.repository.complete(job, workerId);
      this.logger.log(
        JSON.stringify({
          event: 'sunat_void_job.completed',
          jobId: job.id,
          voidRequestId: job.voidRequestId,
          attempt: job.attempts,
        }),
      );
    } catch (error) {
      if (error instanceof LostJobLockError) return;
      const failure = classifyJobError(error);
      const delay = retryDelayMs(
        job.attempts,
        this.retryBaseMs,
        this.retryMaxMs,
      );
      const dead = await this.repository.fail(
        job,
        workerId,
        failure,
        failure.retryable ? new Date(Date.now() + delay) : null,
      );
      this.logger[dead ? 'error' : 'warn'](
        JSON.stringify({
          event: dead
            ? 'sunat_void_job.dead'
            : 'sunat_void_job.retry_scheduled',
          jobId: job.id,
          voidRequestId: job.voidRequestId,
          attempt: job.attempts,
          code: failure.code,
          retryInMs: dead ? null : delay,
        }),
      );
    } finally {
      stopHeartbeat();
    }
  }

  private startHeartbeat(jobId: string, workerId: string) {
    let running = false;
    const timer = setInterval(
      () => {
        if (running) return;
        running = true;
        void this.repository
          .heartbeat(jobId, workerId)
          .finally(() => (running = false));
      },
      Math.max(1_000, Math.floor(this.lockTimeoutMs / 3)),
    );
    timer.unref();
    return () => clearInterval(timer);
  }
}
