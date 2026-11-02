import {
  Injectable,
  Logger,
  OnApplicationShutdown,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { hostname } from 'node:os';
import { randomUUID } from 'node:crypto';
import { WebhookDeliveryProcessorService } from './webhook-delivery-processor.service';
import { WebhookDeliveryRepository } from './webhook-delivery.repository';

@Injectable()
export class WebhookWorkerService
  implements OnModuleInit, OnApplicationShutdown
{
  private readonly logger = new Logger(WebhookWorkerService.name);
  private readonly workerId = `${hostname()}:${process.pid}:webhook:${randomUUID().slice(0, 8)}`;
  private readonly concurrency: number;
  private readonly pollIntervalMs: number;
  private readonly lockTimeoutMs: number;
  private readonly inFlight = new Set<Promise<void>>();
  private timer?: ReturnType<typeof setTimeout>;
  private stopping = false;
  private pumping = false;

  constructor(
    config: ConfigService,
    private readonly repository: WebhookDeliveryRepository,
    private readonly processor: WebhookDeliveryProcessorService,
  ) {
    this.concurrency = config.getOrThrow<number>('WEBHOOK_CONCURRENCY');
    this.pollIntervalMs = config.getOrThrow<number>('WEBHOOK_POLL_INTERVAL_MS');
    this.lockTimeoutMs = config.getOrThrow<number>('WEBHOOK_LOCK_TIMEOUT_MS');
  }

  onModuleInit() {
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
        const delivery = await this.repository.claim(
          this.workerId,
          this.lockTimeoutMs,
        );
        if (!delivery) break;
        const task = this.processor
          .process(delivery, this.workerId)
          .catch((error: unknown) => {
            this.logger.error(
              JSON.stringify({
                event: 'webhook.processor_failed',
                deliveryId: delivery.id,
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
          event: 'webhook.poll_failed',
          error: error instanceof Error ? error.message : 'Error desconocido',
        }),
      );
    } finally {
      this.pumping = false;
      if (this.inFlight.size < this.concurrency)
        this.schedule(this.pollIntervalMs);
    }
  }
}
