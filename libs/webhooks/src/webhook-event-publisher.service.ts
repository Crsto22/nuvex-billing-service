import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { WebhookEventType } from './webhook.types';

@Injectable()
export class WebhookEventPublisherService {
  async publish(
    tx: Prisma.TransactionClient,
    documentId: string,
    eventType: WebhookEventType,
  ) {
    const document = await tx.taxDocument.findUnique({
      where: { id: documentId },
      select: {
        id: true,
        applicationId: true,
        externalId: true,
        environment: true,
        documentType: true,
        status: true,
        series: true,
        number: true,
        currency: true,
        totalAmount: true,
        reasonCode: true,
        reasonDescription: true,
        references: {
          select: {
            referencedDocumentId: true,
            referencedType: true,
            referencedSeries: true,
            referencedNumber: true,
          },
          take: 1,
        },
        sunatCode: true,
        sunatMessage: true,
        sunatObservations: true,
        submittedAt: true,
        respondedAt: true,
        updatedAt: true,
      },
    });
    if (!document) return null;
    const id = randomUUID();
    const createdAt = new Date();
    const payload = {
      id,
      type: eventType,
      createdAt: createdAt.toISOString(),
      data: {
        document: {
          id: document.id,
          externalId: document.externalId,
          environment: document.environment,
          documentType: document.documentType,
          status: document.status,
          series: document.series,
          number: document.number,
          currency: document.currency,
          total: document.totalAmount.toFixed(2),
          note: ['CREDIT_NOTE', 'DEBIT_NOTE'].includes(document.documentType)
            ? {
                reasonCode: document.reasonCode,
                reasonDescription: document.reasonDescription,
                referencedDocument: document.references[0]
                  ? {
                      id: document.references[0].referencedDocumentId,
                      documentType: document.references[0].referencedType,
                      series: document.references[0].referencedSeries,
                      number: document.references[0].referencedNumber,
                    }
                  : null,
              }
            : null,
          sunat: {
            code: document.sunatCode,
            message: document.sunatMessage,
            observations: document.sunatObservations,
            submittedAt: document.submittedAt?.toISOString() ?? null,
            respondedAt: document.respondedAt?.toISOString() ?? null,
          },
          updatedAt: document.updatedAt.toISOString(),
        },
      },
    };
    const event = await tx.webhookEvent.create({
      data: {
        id,
        applicationId: document.applicationId,
        documentId,
        eventType,
        payload,
        createdAt,
      },
    });
    const endpoints = await tx.webhookEndpoint.findMany({
      where: {
        applicationId: document.applicationId,
        environment: document.environment,
        active: true,
        eventTypes: { has: eventType },
      },
      select: { id: true },
    });
    if (endpoints.length) {
      await tx.webhookDelivery.createMany({
        data: endpoints.map((endpoint) => ({
          eventId: event.id,
          endpointId: endpoint.id,
        })),
        skipDuplicates: true,
      });
    }
    return event;
  }

  async publishDespatchGuide(
    tx: Prisma.TransactionClient,
    guideId: string,
    eventType: WebhookEventType,
  ) {
    const guide = await tx.despatchGuide.findUnique({
      where: { id: guideId },
      select: {
        id: true,
        applicationId: true,
        externalId: true,
        environment: true,
        status: true,
        series: true,
        number: true,
        transferStartDate: true,
        transferReasonCode: true,
        transferReasonDescription: true,
        transportMode: true,
        grossWeight: true,
        weightUnit: true,
        packageCount: true,
        departureUbigeo: true,
        departureAddress: true,
        arrivalUbigeo: true,
        arrivalAddress: true,
        recipient: {
          select: {
            documentType: true,
            documentNumber: true,
            name: true,
          },
        },
        sunatCode: true,
        sunatMessage: true,
        sunatObservations: true,
        submittedAt: true,
        respondedAt: true,
        updatedAt: true,
      },
    });
    if (!guide) return null;

    const id = randomUUID();
    const createdAt = new Date();
    const payload = {
      id,
      type: eventType,
      createdAt: createdAt.toISOString(),
      data: {
        despatchGuide: {
          id: guide.id,
          externalId: guide.externalId,
          environment: guide.environment,
          documentType: 'DESPATCH_GUIDE',
          status: guide.status,
          series: guide.series,
          number: guide.number,
          transfer: {
            startDate: guide.transferStartDate.toISOString().slice(0, 10),
            reasonCode: guide.transferReasonCode,
            reasonDescription: guide.transferReasonDescription,
            transportMode: guide.transportMode,
            grossWeight: guide.grossWeight.toFixed(3),
            weightUnit: guide.weightUnit,
            packageCount: guide.packageCount,
            departure: {
              ubigeo: guide.departureUbigeo,
              address: guide.departureAddress,
            },
            arrival:
              guide.arrivalUbigeo && guide.arrivalAddress
                ? {
                    ubigeo: guide.arrivalUbigeo,
                    address: guide.arrivalAddress,
                  }
                : null,
          },
          recipient: guide.recipient,
          sunat: {
            code: guide.sunatCode,
            message: guide.sunatMessage,
            observations: guide.sunatObservations,
            submittedAt: guide.submittedAt?.toISOString() ?? null,
            respondedAt: guide.respondedAt?.toISOString() ?? null,
          },
          updatedAt: guide.updatedAt.toISOString(),
        },
      },
    };
    const event = await tx.webhookEvent.create({
      data: {
        id,
        applicationId: guide.applicationId,
        despatchGuideId: guide.id,
        eventType,
        payload,
        createdAt,
      },
    });
    const endpoints = await tx.webhookEndpoint.findMany({
      where: {
        applicationId: guide.applicationId,
        environment: guide.environment,
        active: true,
        eventTypes: { has: eventType },
      },
      select: { id: true },
    });
    if (endpoints.length) {
      await tx.webhookDelivery.createMany({
        data: endpoints.map((endpoint) => ({
          eventId: event.id,
          endpointId: endpoint.id,
        })),
        skipDuplicates: true,
      });
    }
    return event;
  }

  async publishVoidRequest(
    tx: Prisma.TransactionClient,
    requestId: string,
    eventType: WebhookEventType,
  ) {
    const request = await tx.sunatVoidRequest.findUnique({
      where: { id: requestId },
      include: {
        taxDocument: { select: { id: true, externalId: true } },
        despatchGuide: { select: { id: true, externalId: true } },
      },
    });
    if (!request) return null;

    const id = randomUUID();
    const createdAt = new Date();
    const resource = request.taxDocument ?? request.despatchGuide;
    const payload = {
      id,
      type: eventType,
      createdAt: createdAt.toISOString(),
      data: {
        voidRequest: {
          id: request.id,
          environment: request.environment,
          procedure: request.procedure,
          status: request.status,
          reason: request.reason,
          documentType: request.documentType,
          series: request.series,
          number: request.number,
          resource: resource
            ? { id: resource.id, externalId: resource.externalId }
            : null,
          ticket: request.ticket,
          sunat: {
            code: request.sunatCode,
            message: request.sunatMessage,
            submittedAt: request.submittedAt?.toISOString() ?? null,
            respondedAt: request.respondedAt?.toISOString() ?? null,
          },
          manualConfirmation: request.manualConfirmedAt
            ? {
                reference: request.manualReference,
                evidence: request.manualEvidence,
                confirmedAt: request.manualConfirmedAt.toISOString(),
              }
            : null,
          completedAt: request.completedAt?.toISOString() ?? null,
          updatedAt: request.updatedAt.toISOString(),
        },
      },
    };
    const event = await tx.webhookEvent.create({
      data: {
        id,
        applicationId: request.applicationId,
        documentId: request.taxDocumentId,
        despatchGuideId: request.despatchGuideId,
        sunatVoidRequestId: request.id,
        eventType,
        payload,
        createdAt,
      },
    });
    const endpoints = await tx.webhookEndpoint.findMany({
      where: {
        applicationId: request.applicationId,
        environment: request.environment,
        active: true,
        eventTypes: { has: eventType },
      },
      select: { id: true },
    });
    if (endpoints.length) {
      await tx.webhookDelivery.createMany({
        data: endpoints.map((endpoint) => ({
          eventId: event.id,
          endpointId: endpoint.id,
        })),
        skipDuplicates: true,
      });
    }
    return event;
  }
}
