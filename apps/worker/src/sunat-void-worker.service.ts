import {
  Injectable,
  Logger,
  OnApplicationShutdown,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { hostname } from 'node:os';
import { randomUUID } from 'node:crypto';
import { SunatVoidJobProcessorService } from './sunat-void-job-processor.service';
import { SunatVoidJobRepository } from './sunat-void-job.repository';

@Injectable()
export class SunatVoidWorkerService
  implements OnModuleInit, OnApplicationShutdown
{
  private readonly logger = new Logger(SunatVoidWorkerService.name);
  private readonly workerId = `${hostname()}:${process.pid}:void:${randomUUID().slice(0, 8)}`;
  private readonly concurrency: number;
  private readonly pollIntervalMs: number;
  private readonly lockTimeoutMs: number;
  private readonly inFlight = new Set<Promise<void>>();
  private timer?: ReturnType<typeof setTimeout>;
  private stopping = false;
  private pumping = false;

  constructor(
    config: ConfigService,
    private readonly repository: SunatVoidJobRepository,
    private readonly processor: SunatVoidJobProcessorService,
  ) {
    this.concurrency = config.getOrThrow<number>('WORKER_CONCURRENCY');
    this.pollIntervalMs = config.getOrThrow<number>('WORKER_POLL_INTERVAL_MS');
    this.lockTimeoutMs = config.getOrThrow<number>('WORKER_LOCK_TIMEOUT_MS');
  }

  onModuleInit() {
    this.logger.log(
      JSON.stringify({
        event: 'sunat_void_worker.started',
        workerId: this.workerId,
      }),
    );
    this.schedule(0);
  }

  async onApplicationShutdown() {
    this.stopping = true;
    if (this.timer) clearTimeout(this.timer);
    await Promise.allSettled([...this.inFlight]);
  }

  private schedule(delay: number) {
    if (this.stopping || this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.pump();
    }, delay);
  }

  private async pump() {
    if (this.stopping || this.pumping) return;
    this.pumping = true;
    try {
      while (!this.stopping && this.inFlight.size < this.concurrency) {
        const job = await this.repository.claim(
          this.workerId,
          this.lockTimeoutMs,
        );
        if (!job) break;
        const task = this.processor
          .process(job, this.workerId)
          .catch((error: unknown) => {
            this.logger.error(
              JSON.stringify({
                event: 'sunat_void_job.processor_failed',
                jobId: job.id,
                error:
                  error instanceof Error ? error.message : 'Error desconocido',
              }),
            );
          })
          .finally(() => {
            this.inFlight.delete(task);
            this.schedule(0);
          });
        this.inFlight.add(task);
      }
    } finally {
      this.pumping = false;
      if (this.inFlight.size < this.concurrency) {
        this.schedule(this.pollIntervalMs);
      }
    }
  }
}
