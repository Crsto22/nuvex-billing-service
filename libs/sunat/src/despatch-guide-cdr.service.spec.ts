import { PrismaService } from '../../database/src/prisma.service';
import { PrivateObjectStorageService } from '../../storage/src/private-object-storage.service';
import { DespatchGuideCdrService } from './despatch-guide-cdr.service';
import { SunatCdrParserService } from './sunat-cdr-parser.service';
import { WebhookEventPublisherService } from '../../webhooks/src/webhook-event-publisher.service';

describe('DespatchGuideCdrService', () => {
  it.each([
    ['ACCEPTED', '0'],
    ['REJECTED', '2335'],
  ] as const)('persiste un CDR con estado %s', async (status, code) => {
    const guide = {
      id: 'guide-id',
      tenantId: 'tenant-id',
      applicationId: 'application-id',
      environment: 'BETA',
      status: 'REGISTERED',
      series: 'T001',
      number: 3,
      submittedAt: null,
      respondedAt: null,
      artifacts: [
        {
          type: 'ZIP',
          fileName: '20615136663-09-T001-3.zip',
          objectKey: 'private/20615136663-09-T001-3.zip',
        },
      ],
    };
    const tx = {
      despatchGuide: {
        findUnique: jest.fn().mockResolvedValue(guide),
        update: jest.fn().mockResolvedValue({ operation: 'update' }),
      },
      despatchGuideArtifact: {
        upsert: jest.fn().mockResolvedValue({ operation: 'artifact' }),
      },
      auditEvent: {
        create: jest.fn().mockResolvedValue({ operation: 'audit' }),
      },
    };
    const prisma = {
      ...tx,
      $transaction: jest.fn(
        (callback: (client: typeof tx) => Promise<unknown>) => callback(tx),
      ),
    };
    const storage = { put: jest.fn().mockResolvedValue(undefined) };
    const parser = {
      parse: jest.fn().mockReturnValue({
        status,
        code,
        message: status === 'ACCEPTED' ? 'Aceptada' : 'Rechazada',
        observations: [],
        referenceId: 'T001-3',
        xmlFileName: 'R.xml',
      }),
    };
    const webhooks = {
      publishDespatchGuide: jest.fn().mockResolvedValue({ id: 'event-id' }),
    };
    const service = new DespatchGuideCdrService(
      prisma as unknown as PrismaService,
      storage as unknown as PrivateObjectStorageService,
      parser as unknown as SunatCdrParserService,
      webhooks as unknown as WebhookEventPublisherService,
    );

    await expect(
      service.process('guide-id', Buffer.from('cdr')),
    ).resolves.toMatchObject({
      status,
      code,
    });
    expect(parser.parse).toHaveBeenCalledWith(expect.any(Buffer), 'T001-3');
    expect(storage.put).toHaveBeenCalledWith(
      'private/R-20615136663-09-T001-3.zip',
      Buffer.from('cdr'),
      'application/zip',
    );
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(webhooks.publishDespatchGuide).toHaveBeenCalledWith(
      tx,
      'guide-id',
      status === 'ACCEPTED'
        ? 'despatch_guide.accepted'
        : 'despatch_guide.rejected',
    );
  });
});
