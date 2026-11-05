import {
  Injectable,
  OnApplicationShutdown,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { hostname } from 'node:os';
import { randomUUID } from 'node:crypto';
import { DespatchGuideJobProcessorService } from './despatch-guide-job-processor.service';
import { DespatchGuideJobRepository } from './despatch-guide-job.repository';

@Injectable()
export class DespatchGuideWorkerService
  implements OnModuleInit, OnApplicationShutdown
{
  private readonly workerId = `${hostname()}:${process.pid}:gre:${randomUUID().slice(0, 8)}`;
  private readonly pollMs: number;
  private readonly lockMs: number;
  private timer?: ReturnType<typeof setTimeout>;
  private stopping = false;
  private running = false;

  constructor(
    config: ConfigService,
    private readonly repository: DespatchGuideJobRepository,
    private readonly processor: DespatchGuideJobProcessorService,
  ) {
    this.pollMs = config.getOrThrow<number>('WORKER_POLL_INTERVAL_MS');
    this.lockMs = config.getOrThrow<number>('WORKER_LOCK_TIMEOUT_MS');
  }

  onModuleInit() {
    this.schedule(0);
  }

  onApplicationShutdown() {
    this.stopping = true;
    if (this.timer) clearTimeout(this.timer);
  }

  private schedule(delay: number) {
    if (this.stopping || this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.pump();
    }, delay);
  }

  private async pump() {
    if (this.stopping || this.running) return;
    this.running = true;
    try {
      const job = await this.repository.claim(this.workerId, this.lockMs);
      if (job) await this.processor.process(job, this.workerId);
    } finally {
      this.running = false;
      this.schedule(this.pollMs);
    }
  }
}
