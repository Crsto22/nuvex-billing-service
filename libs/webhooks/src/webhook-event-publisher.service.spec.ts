import { Prisma } from '@prisma/client';
import { WebhookEventPublisherService } from './webhook-event-publisher.service';

describe('WebhookEventPublisherService', () => {
  it('crea evento y entregas solo para endpoints suscritos del ambiente', async () => {
    const tx = {
      taxDocument: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'document-1',
          applicationId: 'application-1',
          externalId: 'sale-1',
          environment: 'BETA',
          documentType: 'INVOICE',
          status: 'ACCEPTED',
          series: 'F001',
          number: 42,
          currency: 'PEN',
          totalAmount: new Prisma.Decimal('118'),
          reasonCode: null,
          reasonDescription: null,
          references: [],
          sunatCode: '0',
          sunatMessage: 'Aceptado',
          sunatObservations: [],
          submittedAt: new Date('2026-11-01T12:00:00.000Z'),
          respondedAt: new Date('2026-11-01T12:00:01.000Z'),
          updatedAt: new Date('2026-11-01T12:00:01.000Z'),
        }),
      },
      webhookEvent: {
        create: jest.fn().mockResolvedValue({ id: 'event-1' }),
      },
      webhookEndpoint: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ id: 'endpoint-1' }, { id: 'endpoint-2' }]),
      },
      webhookDelivery: {
        createMany: jest.fn().mockResolvedValue({ count: 2 }),
      },
    };
    const publisher = new WebhookEventPublisherService();

    await publisher.publish(tx as never, 'document-1', 'document.accepted');

    expect(tx.webhookEndpoint.findMany).toHaveBeenCalledWith({
      where: {
        applicationId: 'application-1',
        environment: 'BETA',
        active: true,
        eventTypes: { has: 'document.accepted' },
      },
      select: { id: true },
    });
    expect(tx.webhookDelivery.createMany).toHaveBeenCalledWith({
      data: [
        { eventId: 'event-1', endpointId: 'endpoint-1' },
        { eventId: 'event-1', endpointId: 'endpoint-2' },
      ],
      skipDuplicates: true,
    });
  });

  it.each([
    ['CREDIT_NOTE', '07', 'document.accepted'],
    ['DEBIT_NOTE', '02', 'document.rejected'],
  ] as const)(
    'incluye motivo y comprobante afectado para %s en %s',
    async (documentType, reasonCode, eventType) => {
      const createdPayloads: unknown[] = [];
      const tx = {
        taxDocument: {
          findUnique: jest.fn().mockResolvedValue({
            id: 'note-1',
            applicationId: 'application-1',
            externalId: 'note-external-1',
            environment: 'BETA',
            documentType,
            status: eventType === 'document.accepted' ? 'ACCEPTED' : 'REJECTED',
            series: documentType === 'CREDIT_NOTE' ? 'FC01' : 'FD01',
            number: 7,
            currency: 'PEN',
            totalAmount: new Prisma.Decimal('59'),
            reasonCode,
            reasonDescription: 'Ajuste del comprobante original',
            references: [
              {
                referencedDocumentId: 'invoice-1',
                referencedType: 'INVOICE',
                referencedSeries: 'F001',
                referencedNumber: 42,
              },
            ],
            sunatCode: eventType === 'document.accepted' ? '0' : '2335',
            sunatMessage:
              eventType === 'document.accepted' ? 'Aceptado' : 'Rechazado',
            sunatObservations: [],
            submittedAt: new Date('2026-11-01T12:00:00.000Z'),
            respondedAt: new Date('2026-11-01T12:00:01.000Z'),
            updatedAt: new Date('2026-11-01T12:00:01.000Z'),
          }),
        },
        webhookEvent: {
          create: jest.fn((input: { data: { payload: unknown } }) => {
            createdPayloads.push(input.data.payload);
            return Promise.resolve({ id: 'event-1' });
          }),
        },
        webhookEndpoint: { findMany: jest.fn().mockResolvedValue([]) },
        webhookDelivery: { createMany: jest.fn() },
      };
      const publisher = new WebhookEventPublisherService();

      await publisher.publish(tx as never, 'note-1', eventType);

      expect(createdPayloads[0]).toMatchObject({
        type: eventType,
        data: {
          document: {
            documentType,
            note: {
              reasonCode,
              reasonDescription: 'Ajuste del comprobante original',
              referencedDocument: {
                id: 'invoice-1',
                documentType: 'INVOICE',
                series: 'F001',
                number: 42,
              },
            },
          },
        },
      });
    },
  );

  it('publica una GRE aceptada con datos del traslado y crea sus entregas', async () => {
    const createdPayloads: unknown[] = [];
    const createdEvents: Array<{
      applicationId: string;
      despatchGuideId?: string;
      eventType: string;
    }> = [];
    const tx = {
      despatchGuide: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'guide-1',
          applicationId: 'application-1',
          externalId: 'gre-external-1',
          environment: 'BETA',
          status: 'ACCEPTED',
          series: 'T001',
          number: 8,
          transferStartDate: new Date('2026-11-02T00:00:00.000Z'),
          transferReasonCode: '01',
          transferReasonDescription: 'Venta',
          transportMode: 'PRIVATE',
          grossWeight: new Prisma.Decimal('125.5'),
          weightUnit: 'KGM',
          packageCount: 10,
          departureUbigeo: '150132',
          departureAddress: 'AV. LOS CIRUELOS 500',
          arrivalUbigeo: '150101',
          arrivalAddress: 'AV. DESTINO 100',
          recipient: {
            documentType: 'RUC',
            documentNumber: '20100070970',
            name: 'CLIENTE PRUEBA SAC',
          },
          sunatCode: '0',
          sunatMessage: 'Aceptada',
          sunatObservations: [],
          submittedAt: new Date('2026-11-02T12:00:00.000Z'),
          respondedAt: new Date('2026-11-02T12:00:01.000Z'),
          updatedAt: new Date('2026-11-02T12:00:01.000Z'),
        }),
      },
      webhookEvent: {
        create: jest.fn(
          (input: {
            data: {
              applicationId: string;
              despatchGuideId?: string;
              eventType: string;
              payload: unknown;
            };
          }) => {
            createdEvents.push(input.data);
            createdPayloads.push(input.data.payload);
            return Promise.resolve({ id: 'event-gre-1' });
          },
        ),
      },
      webhookEndpoint: {
        findMany: jest.fn().mockResolvedValue([{ id: 'endpoint-1' }]),
      },
      webhookDelivery: {
        createMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const publisher = new WebhookEventPublisherService();

    await publisher.publishDespatchGuide(
      tx as never,
      'guide-1',
      'despatch_guide.accepted',
    );

    expect(createdPayloads[0]).toMatchObject({
      type: 'despatch_guide.accepted',
      data: {
        despatchGuide: {
          id: 'guide-1',
          documentType: 'DESPATCH_GUIDE',
          status: 'ACCEPTED',
          series: 'T001',
          number: 8,
          transfer: {
            reasonCode: '01',
            transportMode: 'PRIVATE',
            grossWeight: '125.500',
          },
          sunat: { code: '0', message: 'Aceptada' },
        },
      },
    });
    expect(createdEvents[0]).toMatchObject({
      applicationId: 'application-1',
      despatchGuideId: 'guide-1',
      eventType: 'despatch_guide.accepted',
    });
    expect(tx.webhookDelivery.createMany).toHaveBeenCalledWith({
      data: [{ eventId: 'event-gre-1', endpointId: 'endpoint-1' }],
      skipDuplicates: true,
    });
  });
});
