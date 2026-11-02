import { PrismaService } from '../../../libs/database/src/prisma.service';
import { WebhookEventPublisherService } from '../../../libs/webhooks/src/webhook-event-publisher.service';
import { EmissionJobRepository } from './emission-job.repository';

describe('EmissionJobRepository', () => {
  it('reclama un trabajo, cambia el estado y publica el evento', async () => {
    const row = {
      id: 'job-1',
      documentId: 'document-1',
      operation: 'ISSUE',
      attempts: 2,
      maxAttempts: 10,
    };
    const tx = {
      taxDocument: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };
    const prisma = {
      $queryRaw: jest.fn().mockResolvedValue([row]),
      $transaction: jest.fn((callback: (client: typeof tx) => unknown) =>
        callback(tx),
      ),
    };
    const webhooks = { publish: jest.fn().mockResolvedValue({}) };
    const repository = new EmissionJobRepository(
      prisma as unknown as PrismaService,
      webhooks,
    );

    await expect(repository.claim('worker-1', 120_000)).resolves.toEqual(row);
    expect(tx.taxDocument.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'document-1',
        status: { in: ['QUEUED', 'RETRY_SCHEDULED'] },
      },
      data: { status: 'PROCESSING' },
    });
    expect(webhooks.publish).toHaveBeenCalledWith(
      tx,
      'document-1',
      'document.processing',
    );
  });

  it('no abre transacción cuando la cola está vacía', async () => {
    const prisma = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      $transaction: jest.fn(),
    };
    const repository = new EmissionJobRepository(
      prisma as unknown as PrismaService,
      {} as WebhookEventPublisherService,
    );

    await expect(repository.claim('worker-1', 120_000)).resolves.toBeNull();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
