import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  DocumentStatus,
  DocumentType,
  Prisma,
  SunatVoidProcedure,
  SunatVoidRequestStatus,
} from '@prisma/client';
import { createHash } from 'node:crypto';
import { PrismaService } from '../../../../libs/database/src/prisma.service';
import { SunatDailySummaryService } from '../../../../libs/sunat/src/sunat-daily-summary.service';
import { WebhookEventPublisherService } from '../../../../libs/webhooks/src/webhook-event-publisher.service';
import type { ApplicationPrincipal } from '../auth/auth.types';
import type { RequestWithId } from '../common/request-id.middleware';
import {
  CreateGreVoidRequestDto,
  CreateTaxDocumentVoidRequestDto,
  ConfirmGreVoidRequestDto,
} from './dto/create-void-request.dto';

const VOID_REQUEST_INCLUDE = {
  taxDocument: {
    select: { id: true, externalId: true },
  },
  despatchGuide: {
    select: { id: true, externalId: true },
  },
  summaryItem: {
    select: {
      conditionCode: true,
      summary: {
        select: {
          id: true,
          fileName: true,
          cdrObjectKey: true,
          status: true,
        },
      },
    },
  },
  job: {
    select: {
      id: true,
      status: true,
      attempts: true,
      maxAttempts: true,
      nextAttemptAt: true,
      lastErrorCode: true,
      lastErrorMessage: true,
    },
  },
} satisfies Prisma.SunatVoidRequestInclude;

type StoredVoidRequest = Prisma.SunatVoidRequestGetPayload<{
  include: typeof VOID_REQUEST_INCLUDE;
}>;

type VoidRequestResponse = ReturnType<typeof voidRequestResponse>;

@Injectable()
export class VoidRequestsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly dailySummaries: SunatDailySummaryService,
    private readonly webhooks: WebhookEventPublisherService,
  ) {}

  generateDailySummaryArtifacts(
    requestId: string,
    principal: ApplicationPrincipal,
  ) {
    return this.dailySummaries.generateVoidRequestArtifacts(
      requestId,
      principal,
    );
  }

  async enqueue(
    requestId: string,
    principal: ApplicationPrincipal,
  ): Promise<VoidRequestResponse> {
    const current = await this.prisma.sunatVoidRequest.findFirst({
      where: {
        id: requestId,
        tenantId: principal.tenantId,
        applicationId: principal.applicationId,
        environment: principal.environment,
      },
      include: VOID_REQUEST_INCLUDE,
    });
    if (!current)
      throw new NotFoundException('Solicitud de baja no encontrada');
    if (current.procedure === SunatVoidProcedure.GRE_SOL) {
      throw new ConflictException(
        'La baja de GRE se confirma manualmente mediante SUNAT SOL',
      );
    }
    if (
      current.status === SunatVoidRequestStatus.ACCEPTED ||
      current.status === SunatVoidRequestStatus.REJECTED
    ) {
      return voidRequestResponse(current);
    }
    const updated = await this.prisma.sunatVoidRequest.update({
      where: { id: current.id },
      data: {
        status:
          current.status === SunatVoidRequestStatus.FAILED
            ? SunatVoidRequestStatus.PENDING
            : undefined,
        job: {
          upsert: {
            create: {},
            update:
              current.job?.status === 'DEAD'
                ? {
                    status: 'PENDING',
                    attempts: 0,
                    nextAttemptAt: new Date(),
                    lockedAt: null,
                    lockedBy: null,
                    lastErrorCode: null,
                    lastErrorMessage: null,
                    processedAt: null,
                  }
                : {},
          },
        },
      },
      include: VOID_REQUEST_INCLUDE,
    });
    return voidRequestResponse(updated);
  }

  getCdr(requestId: string, principal: ApplicationPrincipal) {
    return this.dailySummaries.getVoidRequestCdr(requestId, principal);
  }

  async createForDocument(
    documentId: string,
    dto: CreateTaxDocumentVoidRequestDto,
    idempotencyKey: string,
    principal: ApplicationPrincipal,
    request: RequestWithId,
  ): Promise<VoidRequestResponse> {
    validateIdempotencyKey(idempotencyKey);
    const requestHash = hashCanonical({
      operation: 'void-tax-document',
      documentId,
      environment: principal.environment,
      payload: dto,
    });
    const replay = await this.findReplay(
      principal.applicationId,
      idempotencyKey,
      requestHash,
    );
    if (replay) return replay;

    const document = await this.prisma.taxDocument.findFirst({
      where: {
        id: documentId,
        tenantId: principal.tenantId,
        applicationId: principal.applicationId,
        environment: principal.environment,
      },
      include: {
        voidRequest: { select: { id: true } },
        references: { select: { referencedType: true } },
      },
    });
    if (!document) throw new NotFoundException('Documento no encontrado');
    if (document.voidRequest) {
      throw new ConflictException(
        `El documento ya tiene la solicitud de baja ${document.voidRequest.id}`,
      );
    }
    if (
      document.status !== DocumentStatus.ACCEPTED &&
      document.status !== DocumentStatus.ACCEPTED_WITH_OBSERVATIONS
    ) {
      throw new ConflictException(
        'Solo se puede dar de baja un comprobante aceptado por SUNAT',
      );
    }
    if (dto.documentDelivered) {
      throw new ConflictException(
        'La Comunicacion de Baja solo procede para comprobantes no otorgados al cliente',
      );
    }

    const procedure = procedureForDocument(
      document.documentType,
      document.references[0]?.referencedType,
    );
    if (
      (procedure === SunatVoidProcedure.VOIDED_DOCUMENTS ||
        procedure === SunatVoidProcedure.DAILY_SUMMARY) &&
      document.respondedAt &&
      daysBetweenUtc(document.respondedAt, new Date()) > 7
    ) {
      throw new ConflictException(
        'Vencio el plazo de siete dias calendario desde la CDR aceptada para comunicar la baja',
      );
    }
    return this.prisma.$transaction(async (tx) => {
      const created = await tx.sunatVoidRequest.create({
        data: {
          tenantId: principal.tenantId,
          applicationId: principal.applicationId,
          environment: principal.environment,
          taxDocumentId: document.id,
          documentType: document.documentType,
          procedure,
          status: SunatVoidRequestStatus.PENDING,
          referenceDate: document.issueDate,
          series: document.series,
          number: document.number,
          reason: dto.reason.trim(),
          requestPayload: dto as unknown as Prisma.InputJsonValue,
        },
        include: VOID_REQUEST_INCLUDE,
      });
      const response = voidRequestResponse(created);
      await this.persistRequestMetadata(
        tx,
        created,
        response,
        idempotencyKey,
        requestHash,
        principal,
        request,
      );
      return response;
    });
  }

  async createForGuide(
    guideId: string,
    dto: CreateGreVoidRequestDto,
    idempotencyKey: string,
    principal: ApplicationPrincipal,
    request: RequestWithId,
  ): Promise<VoidRequestResponse> {
    validateIdempotencyKey(idempotencyKey);
    const requestHash = hashCanonical({
      operation: 'void-despatch-guide',
      guideId,
      environment: principal.environment,
      payload: dto,
    });
    const replay = await this.findReplay(
      principal.applicationId,
      idempotencyKey,
      requestHash,
    );
    if (replay) return replay;

    const guide = await this.prisma.despatchGuide.findFirst({
      where: {
        id: guideId,
        tenantId: principal.tenantId,
        applicationId: principal.applicationId,
        environment: principal.environment,
      },
      include: { voidRequest: { select: { id: true } } },
    });
    if (!guide) {
      throw new NotFoundException('Guía de remisión no encontrada');
    }
    if (guide.voidRequest) {
      throw new ConflictException(
        `La GRE ya tiene la solicitud de baja ${guide.voidRequest.id}`,
      );
    }
    if (
      !guide.submittedAt ||
      !['ACCEPTED', 'ACCEPTED_WITH_OBSERVATIONS'].includes(String(guide.status))
    ) {
      throw new ConflictException(
        'La baja mediante SUNAT SOL solo corresponde a una GRE aceptada',
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const created = await tx.sunatVoidRequest.create({
        data: {
          tenantId: principal.tenantId,
          applicationId: principal.applicationId,
          environment: principal.environment,
          despatchGuideId: guide.id,
          documentType: DocumentType.DESPATCH_GUIDE,
          procedure: SunatVoidProcedure.GRE_SOL,
          status: SunatVoidRequestStatus.MANUAL_ACTION_REQUIRED,
          referenceDate: guide.issueDate,
          series: guide.series,
          number: guide.number,
          reason: dto.reason.trim(),
          requestPayload: {
            ...dto,
            previousGuideStatus: guide.status,
          },
        },
        include: VOID_REQUEST_INCLUDE,
      });
      await tx.despatchGuide.update({
        where: { id: guide.id },
        data: {
          status: 'CANCELLATION_REQUESTED',
          cancellationReason: dto.reason.trim(),
          cancellationRequestedAt: new Date(),
        },
      });
      const response = voidRequestResponse(created);
      await this.persistRequestMetadata(
        tx,
        created,
        response,
        idempotencyKey,
        requestHash,
        principal,
        request,
      );
      await this.webhooks.publishVoidRequest(
        tx,
        created.id,
        'sunat_void.manual_action_required',
      );
      return response;
    });
  }

  async confirmGreManualResult(
    requestId: string,
    dto: ConfirmGreVoidRequestDto,
    idempotencyKey: string,
    principal: ApplicationPrincipal,
    request: RequestWithId,
  ): Promise<VoidRequestResponse> {
    validateIdempotencyKey(idempotencyKey);
    const requestHash = hashCanonical({
      operation: 'confirm-gre-void-in-sol',
      requestId,
      environment: principal.environment,
      payload: dto,
    });
    const replay = await this.findReplay(
      principal.applicationId,
      idempotencyKey,
      requestHash,
    );
    if (replay) return replay;

    return this.prisma.$transaction(async (tx) => {
      const current = await tx.sunatVoidRequest.findFirst({
        where: {
          id: requestId,
          tenantId: principal.tenantId,
          applicationId: principal.applicationId,
          environment: principal.environment,
        },
        include: VOID_REQUEST_INCLUDE,
      });
      if (!current) {
        throw new NotFoundException('Solicitud de baja no encontrada');
      }
      if (
        current.procedure !== SunatVoidProcedure.GRE_SOL ||
        !current.despatchGuideId
      ) {
        throw new ConflictException(
          'La solicitud no corresponde a una baja manual de GRE en SUNAT SOL',
        );
      }
      if (
        current.status === SunatVoidRequestStatus.ACCEPTED ||
        current.status === SunatVoidRequestStatus.REJECTED
      ) {
        return voidRequestResponse(current);
      }
      if (current.status !== SunatVoidRequestStatus.MANUAL_ACTION_REQUIRED) {
        throw new ConflictException(
          'La solicitud no esta pendiente de confirmacion manual',
        );
      }

      const accepted = dto.result === 'ACCEPTED';
      const now = new Date();
      const evidence = {
        result: dto.result,
        notes: dto.notes?.trim() || null,
        confirmedByApiKeyId: principal.apiKeyId,
      } satisfies Prisma.InputJsonObject;
      await tx.despatchGuide.update({
        where: { id: current.despatchGuideId },
        data: accepted
          ? { status: 'CANCELLED', cancelledAt: now }
          : {
              status: previousGuideStatus(current.requestPayload),
              cancellationReason: null,
              cancellationRequestedAt: null,
              cancelledAt: null,
            },
      });
      const updated = await tx.sunatVoidRequest.update({
        where: { id: current.id },
        data: {
          status: accepted ? 'ACCEPTED' : 'REJECTED',
          manualReference: dto.solReference.trim(),
          manualEvidence: evidence,
          manualConfirmedAt: now,
          sunatCode: accepted ? '0' : 'MANUAL_REJECTED',
          sunatMessage: accepted
            ? 'Baja de GRE confirmada en SUNAT SOL'
            : dto.notes?.trim() || 'Baja de GRE rechazada en SUNAT SOL',
          respondedAt: now,
          completedAt: now,
        },
        include: VOID_REQUEST_INCLUDE,
      });
      const response = voidRequestResponse(updated);
      await this.persistRequestMetadata(
        tx,
        updated,
        response,
        idempotencyKey,
        requestHash,
        principal,
        request,
        'sunat_void_request.gre_manual_confirmed',
      );
      await this.webhooks.publishVoidRequest(
        tx,
        updated.id,
        accepted ? 'sunat_void.accepted' : 'sunat_void.rejected',
      );
      return response;
    });
  }

  async get(
    requestId: string,
    principal: ApplicationPrincipal,
  ): Promise<VoidRequestResponse> {
    const request = await this.prisma.sunatVoidRequest.findFirst({
      where: {
        id: requestId,
        tenantId: principal.tenantId,
        applicationId: principal.applicationId,
        environment: principal.environment,
      },
      include: VOID_REQUEST_INCLUDE,
    });
    if (!request) {
      throw new NotFoundException('Solicitud de baja no encontrada');
    }
    return voidRequestResponse(request);
  }

  async retry(
    requestId: string,
    idempotencyKey: string,
    principal: ApplicationPrincipal,
    request: RequestWithId,
  ): Promise<VoidRequestResponse> {
    validateIdempotencyKey(idempotencyKey);
    const requestHash = hashCanonical({
      operation: 'retry-void-request',
      requestId,
      environment: principal.environment,
    });
    const replay = await this.findReplay(
      principal.applicationId,
      idempotencyKey,
      requestHash,
    );
    if (replay) return replay;

    return this.prisma.$transaction(async (tx) => {
      const current = await tx.sunatVoidRequest.findFirst({
        where: {
          id: requestId,
          tenantId: principal.tenantId,
          applicationId: principal.applicationId,
          environment: principal.environment,
        },
        include: VOID_REQUEST_INCLUDE,
      });
      if (!current) {
        throw new NotFoundException('Solicitud de baja no encontrada');
      }
      if (current.status !== SunatVoidRequestStatus.FAILED) {
        throw new ConflictException(
          'Solo una solicitud de baja fallida puede reintentarse',
        );
      }
      const updated = await tx.sunatVoidRequest.update({
        where: { id: requestId },
        data: {
          status: SunatVoidRequestStatus.PENDING,
          sunatCode: null,
          sunatMessage: null,
          respondedAt: null,
          completedAt: null,
          job: {
            upsert: {
              create: {},
              update: {
                status: 'PENDING',
                attempts: 0,
                nextAttemptAt: new Date(),
                lockedAt: null,
                lockedBy: null,
                lastErrorCode: null,
                lastErrorMessage: null,
                processedAt: null,
              },
            },
          },
        },
        include: VOID_REQUEST_INCLUDE,
      });
      const response = voidRequestResponse(updated);
      await this.persistRequestMetadata(
        tx,
        updated,
        response,
        idempotencyKey,
        requestHash,
        principal,
        request,
        'sunat_void_request.retry_requested',
      );
      return response;
    });
  }

  private async persistRequestMetadata(
    tx: Prisma.TransactionClient,
    stored: StoredVoidRequest,
    response: VoidRequestResponse,
    idempotencyKey: string,
    requestHash: string,
    principal: ApplicationPrincipal,
    request: RequestWithId,
    action = 'sunat_void_request.created',
  ) {
    await tx.idempotencyRecord.create({
      data: {
        applicationId: principal.applicationId,
        key: idempotencyKey,
        requestHash,
        resourceType: 'sunat_void_request',
        resourceId: stored.id,
        responseStatus: 202,
        responseBody: response,
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
    });
    await tx.auditEvent.create({
      data: {
        tenantId: principal.tenantId,
        applicationId: principal.applicationId,
        actorType: 'API_KEY',
        actorId: principal.apiKeyId,
        action,
        resourceType: 'sunat_void_request',
        resourceId: stored.id,
        requestId: request.requestId,
        ip: request.ip,
        data: {
          documentType: stored.documentType,
          procedure: stored.procedure,
          fullNumber: `${stored.series}-${stored.number}`,
        },
      },
    });
  }

  private async findReplay(
    applicationId: string,
    key: string,
    requestHash: string,
  ): Promise<VoidRequestResponse | null> {
    const existing = await this.prisma.idempotencyRecord.findUnique({
      where: { applicationId_key: { applicationId, key } },
    });
    if (!existing) return null;
    if (existing.requestHash !== requestHash) {
      throw new ConflictException(
        'Idempotency-Key ya fue usada con una solicitud diferente',
      );
    }
    return existing.responseBody as unknown as VoidRequestResponse;
  }
}

function procedureForDocument(
  documentType: DocumentType,
  referencedType?: DocumentType,
) {
  if (documentType === DocumentType.RECEIPT) {
    return SunatVoidProcedure.DAILY_SUMMARY;
  }
  if (
    (documentType === DocumentType.CREDIT_NOTE ||
      documentType === DocumentType.DEBIT_NOTE) &&
    referencedType === DocumentType.RECEIPT
  ) {
    return SunatVoidProcedure.DAILY_SUMMARY;
  }
  return SunatVoidProcedure.VOIDED_DOCUMENTS;
}

function daysBetweenUtc(from: Date, to: Date) {
  const fromDay = Date.UTC(
    from.getUTCFullYear(),
    from.getUTCMonth(),
    from.getUTCDate(),
  );
  const toDay = Date.UTC(
    to.getUTCFullYear(),
    to.getUTCMonth(),
    to.getUTCDate(),
  );
  return Math.floor((toDay - fromDay) / 86_400_000);
}

function voidRequestResponse(request: StoredVoidRequest) {
  const resource = request.taxDocument ?? request.despatchGuide;
  return {
    id: request.id,
    status: request.status,
    procedure: request.procedure,
    environment: request.environment,
    resource: {
      id: resource?.id ?? null,
      externalId: resource?.externalId ?? null,
      documentType: request.documentType,
      series: request.series,
      number: request.number,
      fullNumber: `${request.series}-${String(request.number).padStart(8, '0')}`,
    },
    referenceDate: request.referenceDate.toISOString().slice(0, 10),
    reason: request.reason,
    requestPayload: request.requestPayload,
    attempts: request.attempts,
    ticket: request.ticket,
    sunat: {
      code: request.sunatCode,
      message: request.sunatMessage,
      submittedAt: request.submittedAt?.toISOString() ?? null,
      respondedAt: request.respondedAt?.toISOString() ?? null,
    },
    manualAction:
      request.procedure === SunatVoidProcedure.GRE_SOL &&
      request.status === SunatVoidRequestStatus.MANUAL_ACTION_REQUIRED
        ? {
            required: true,
            channel: 'SUNAT_SOL',
            message: 'Registrar la baja de la GRE mediante SUNAT SOL',
          }
        : null,
    manualConfirmation: request.manualConfirmedAt
      ? {
          reference: request.manualReference,
          evidence: request.manualEvidence,
          confirmedAt: request.manualConfirmedAt.toISOString(),
        }
      : null,
    dailySummary: request.summaryItem
      ? {
          id: request.summaryItem.summary.id,
          conditionCode: request.summaryItem.conditionCode,
          status: request.summaryItem.summary.status,
          fileName: request.summaryItem.summary.fileName,
          cdrAvailable: Boolean(request.summaryItem.summary.cdrObjectKey),
        }
      : null,
    job: request.job
      ? {
          id: request.job.id,
          status: request.job.status,
          attempts: request.job.attempts,
          maxAttempts: request.job.maxAttempts,
          nextAttemptAt: request.job.nextAttemptAt.toISOString(),
          lastError: request.job.lastErrorCode
            ? {
                code: request.job.lastErrorCode,
                message: request.job.lastErrorMessage,
              }
            : null,
        }
      : null,
    completedAt: request.completedAt?.toISOString() ?? null,
    createdAt: request.createdAt.toISOString(),
    updatedAt: request.updatedAt.toISOString(),
  };
}

function previousGuideStatus(payload: Prisma.JsonValue) {
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    const value = payload.previousGuideStatus;
    if (value === 'ACCEPTED_WITH_OBSERVATIONS') {
      return 'ACCEPTED_WITH_OBSERVATIONS' as const;
    }
  }
  return 'ACCEPTED' as const;
}

function validateIdempotencyKey(value: string) {
  if (!value || value.length < 16 || value.length > 100 || /\s/.test(value)) {
    throw new BadRequestException(
      'Idempotency-Key debe tener entre 16 y 100 caracteres sin espacios',
    );
  }
}

function hashCanonical(value: unknown) {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}
