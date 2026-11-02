import {
  Injectable,
  Logger,
  OnApplicationShutdown,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { hostname } from 'node:os';
import { randomUUID } from 'node:crypto';
import { EmissionJobProcessorService } from './emission-job-processor.service';
import { EmissionJobRepository } from './emission-job.repository';

@Injectable()
export class WorkerService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(WorkerService.name);
  private readonly workerId = `${hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`;
  private readonly concurrency: number;
  private readonly pollIntervalMs: number;
  private readonly lockTimeoutMs: number;
  private readonly inFlight = new Set<Promise<void>>();
  private timer?: ReturnType<typeof setTimeout>;
  private stopping = false;
  private pumping = false;

  constructor(
    config: ConfigService,
    private readonly repository: EmissionJobRepository,
    private readonly processor: EmissionJobProcessorService,
  ) {
    this.concurrency = config.getOrThrow<number>('WORKER_CONCURRENCY');
    this.pollIntervalMs = config.getOrThrow<number>('WORKER_POLL_INTERVAL_MS');
    this.lockTimeoutMs = config.getOrThrow<number>('WORKER_LOCK_TIMEOUT_MS');
  }

  onModuleInit() {
    this.logger.log(
      JSON.stringify({
        event: 'worker.started',
        workerId: this.workerId,
        concurrency: this.concurrency,
      }),
    );
    this.schedule(0);
  }

  async onApplicationShutdown(signal?: string) {
    this.stopping = true;
    if (this.timer) clearTimeout(this.timer);
    this.logger.log(
      JSON.stringify({
        event: 'worker.stopping',
        workerId: this.workerId,
        signal: signal ?? null,
        inFlight: this.inFlight.size,
      }),
    );
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
        const task: Promise<void> = this.processor
          .process(job, this.workerId)
          .catch((error: unknown) => {
            this.logger.error(
              JSON.stringify({
                event: 'emission_job.processor_failed',
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
    } catch (error) {
      this.logger.error(
        JSON.stringify({
          event: 'worker.poll_failed',
          workerId: this.workerId,
          error: error instanceof Error ? error.message : 'Error desconocido',
        }),
      );
    } finally {
      this.pumping = false;
      if (this.inFlight.size < this.concurrency) {
        this.schedule(this.pollIntervalMs);
      }
    }
  }
}
