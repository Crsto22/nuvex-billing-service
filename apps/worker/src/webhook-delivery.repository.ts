import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../libs/database/src/prisma.service';
import { ClaimedWebhookDelivery } from '../../../libs/webhooks/src/webhook.types';

@Injectable()
export class WebhookDeliveryRepository {
  constructor(private readonly prisma: PrismaService) {}

  async claim(workerId: string, lockTimeoutMs: number) {
    const rows = await this.prisma.$queryRaw<
      ClaimedWebhookDelivery[]
    >(Prisma.sql`
      WITH candidate AS (
        SELECT delivery.id
        FROM webhook_delivery AS delivery
        JOIN webhook_endpoint AS endpoint ON endpoint.id = delivery.endpoint_id
        WHERE endpoint.active = true AND (
          (delivery.status = 'PENDING' AND delivery.next_attempt_at <= NOW())
          OR
          (delivery.status = 'PROCESSING' AND delivery.locked_at < NOW() - (${lockTimeoutMs} * INTERVAL '1 millisecond'))
        )
        ORDER BY delivery.next_attempt_at ASC, delivery.created_at ASC
        FOR UPDATE OF delivery SKIP LOCKED
        LIMIT 1
      )
      UPDATE webhook_delivery AS delivery
      SET
        status = 'PROCESSING',
        attempts = delivery.attempts + 1,
        locked_at = NOW(),
        locked_by = ${workerId},
        last_error = NULL
      FROM candidate, webhook_event AS event, webhook_endpoint AS endpoint
      WHERE delivery.id = candidate.id
        AND event.id = delivery.event_id
        AND endpoint.id = delivery.endpoint_id
      RETURNING
        delivery.id,
        delivery.event_id AS "eventId",
        delivery.endpoint_id AS "endpointId",
        endpoint.application_id AS "applicationId",
        endpoint.url,
        endpoint.signing_secret_encrypted AS "signingSecretEncrypted",
        event.event_type AS "eventType",
        event.payload,
        delivery.attempts,
        delivery.max_attempts AS "maxAttempts"
    `);
    return rows[0] ?? null;
  }

  async delivered(
    delivery: ClaimedWebhookDelivery,
    workerId: string,
    status: number,
  ) {
    const result = await this.prisma.webhookDelivery.updateMany({
      where: { id: delivery.id, status: 'PROCESSING', lockedBy: workerId },
      data: {
        status: 'DELIVERED',
        lockedAt: null,
        lockedBy: null,
        lastHttpStatus: status,
        deliveredAt: new Date(),
      },
    });
    return result.count === 1;
  }

  async failed(
    delivery: ClaimedWebhookDelivery,
    workerId: string,
    failure: { message: string; retryable: boolean; httpStatus?: number },
    nextAttemptAt: Date,
  ) {
    const dead =
      !failure.retryable || delivery.attempts >= delivery.maxAttempts;
    const result = await this.prisma.webhookDelivery.updateMany({
      where: { id: delivery.id, status: 'PROCESSING', lockedBy: workerId },
      data: {
        status: dead ? 'DEAD' : 'PENDING',
        lockedAt: null,
        lockedBy: null,
        nextAttemptAt,
        lastHttpStatus: failure.httpStatus,
        lastError: failure.message.slice(0, 1_000),
      },
    });
    return { dead, owned: result.count === 1 };
  }
}
