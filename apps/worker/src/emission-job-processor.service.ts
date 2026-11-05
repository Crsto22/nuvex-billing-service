import { HttpException, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import { UblArtifactService } from '../../../libs/ubl/src/ubl-artifact.service';
import { SunatSubmissionService } from '../../../libs/sunat/src/sunat-submission.service';
import { PdfArtifactService } from '../../../libs/pdf/src/pdf-artifact.service';
import {
  EmissionJobRepository,
  LostJobLockError,
} from './emission-job.repository';
import { ClaimedEmissionJob } from './emission-job.types';

@Injectable()
export class EmissionJobProcessorService {
  private readonly logger = new Logger(EmissionJobProcessorService.name);
  private readonly lockTimeoutMs: number;
  private readonly retryBaseMs: number;
  private readonly retryMaxMs: number;

  constructor(
    config: ConfigService,
    private readonly repository: EmissionJobRepository,
    private readonly artifacts: UblArtifactService,
    private readonly sunat: SunatSubmissionService,
    private readonly pdf: PdfArtifactService,
  ) {
    this.lockTimeoutMs = config.getOrThrow<number>('WORKER_LOCK_TIMEOUT_MS');
    this.retryBaseMs = config.getOrThrow<number>('WORKER_RETRY_BASE_MS');
    this.retryMaxMs = config.getOrThrow<number>('WORKER_RETRY_MAX_MS');
  }

  async process(job: ClaimedEmissionJob, workerId: string) {
    const stopHeartbeat = this.startHeartbeat(job.id, workerId);
    const startedAt = Date.now();
    try {
      if (job.operation !== 'ISSUE') {
        throw new PermanentJobError(
          'UNSUPPORTED_OPERATION',
          `Operacion no soportada: ${String(job.operation)}`,
        );
      }
      await this.artifacts.generate(job.documentId);
      await this.pdf.generate(job.documentId);
      const sunat = await this.sunat.submit(job.documentId);
      if (
        sunat.status === 'ACCEPTED' ||
        sunat.status === 'ACCEPTED_WITH_OBSERVATIONS' ||
        sunat.status === 'REJECTED'
      ) {
        await this.pdf.generate(job.documentId, { refresh: true });
      }
      await this.repository.complete(job, workerId);
      this.logger.log(
        JSON.stringify({
          event: 'emission_job.completed',
          jobId: job.id,
          documentId: job.documentId,
          attempt: job.attempts,
          durationMs: Date.now() - startedAt,
        }),
      );
    } catch (error) {
      if (error instanceof LostJobLockError) {
        this.logger.warn(
          JSON.stringify({ event: 'emission_job.lock_lost', jobId: job.id }),
        );
        return;
      }
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
          event: dead ? 'emission_job.dead' : 'emission_job.retry_scheduled',
          jobId: job.id,
          documentId: job.documentId,
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
    let stopped = false;
    let running = false;
    const interval = Math.max(1_000, Math.floor(this.lockTimeoutMs / 3));
    const timer = setInterval(() => {
      if (stopped || running) return;
      running = true;
      void this.repository
        .heartbeat(jobId, workerId)
        .then((owned) => {
          if (!owned) stopped = true;
        })
        .catch((error: unknown) => {
          this.logger.warn(
            JSON.stringify({
              event: 'emission_job.heartbeat_failed',
              jobId,
              error: safeErrorMessage(error),
            }),
          );
        })
        .finally(() => {
          running = false;
        });
    }, interval);
    timer.unref();
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }
}

export function classifyJobError(error: unknown) {
  if (error instanceof PermanentJobError) {
    return { code: error.code, message: error.message, retryable: false };
  }
  if (error instanceof HttpException) {
    const status = error.getStatus();
    return {
      code: `HTTP_${status}`,
      message: safeErrorMessage(error),
      retryable: status === 408 || status === 429 || status >= 500,
    };
  }
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    return {
      code: error.code,
      message: safeErrorMessage(error),
      retryable: ['P1001', 'P1002', 'P1008', 'P1017', 'P2024'].includes(
        error.code,
      ),
    };
  }
  return {
    code: 'UNEXPECTED_ERROR',
    message: safeErrorMessage(error),
    retryable: true,
  };
}

export function retryDelayMs(
  attempt: number,
  baseMs: number,
  maximumMs: number,
  random = Math.random,
) {
  const exponential = Math.min(
    maximumMs,
    baseMs * 2 ** Math.max(0, attempt - 1),
  );
  const jitter = 0.75 + random() * 0.5;
  return Math.min(
    maximumMs,
    Math.max(baseMs, Math.round(exponential * jitter)),
  );
}

function safeErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : 'Error desconocido';
  return message.replace(/[\r\n\t]+/g, ' ').slice(0, 1_000);
}

class PermanentJobError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}
