import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  DespatchGuideStatus,
  DespatchTransportMode,
  Prisma,
} from '@prisma/client';
import { createHash } from 'node:crypto';
import { PrismaService } from '../../../../libs/database/src/prisma.service';
import { DespatchGuideArtifactService } from '../../../../libs/ubl/src/despatch-guide-artifact.service';
import { PrivateObjectStorageService } from '../../../../libs/storage/src/private-object-storage.service';
import { DespatchGuideCdrService } from '../../../../libs/sunat/src/despatch-guide-cdr.service';
import { DespatchGuidePdfArtifactService } from '../../../../libs/pdf/src/despatch-guide-pdf-artifact.service';
import type { ApplicationPrincipal } from '../auth/auth.types';
import type { RequestWithId } from '../common/request-id.middleware';
import { toTenantBrandingSnapshot } from '../branding/tenant-branding.snapshot';
import {
  CancelDespatchGuideDto,
  CreateDespatchGuideDto,
  DespatchPartyDocumentType,
  ListDespatchGuidesQueryDto,
} from './dto/create-despatch-guide.dto';
import {
  isSunatUbigeo,
  isValidRelatedDocumentNumber,
  SUNAT_REMITTENT_DOCUMENT_TYPES,
  SUNAT_TRANSFER_REASONS,
  SUNAT_TRANSPORT_MODE_CODE,
} from './sunat-despatch.catalog';

const MAX_GUIDE_NUMBER = 99_999_999;

const GUIDE_INCLUDE = {
  recipient: true,
  carrier: true,
  vehicles: { orderBy: [{ primary: 'desc' }, { plate: 'asc' }] },
  drivers: {
    orderBy: [{ primary: 'desc' }, { documentNumber: 'asc' }],
  },
  items: { orderBy: { lineNumber: 'asc' } },
  relatedDocuments: { orderBy: { createdAt: 'asc' } },
  artifacts: { orderBy: { createdAt: 'asc' } },
} satisfies Prisma.DespatchGuideInclude;

type StoredGuide = Prisma.DespatchGuideGetPayload<{
  include: typeof GUIDE_INCLUDE;
}>;

@Injectable()
export class DespatchGuidesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly artifactService: DespatchGuideArtifactService,
    private readonly storage: PrivateObjectStorageService,
    private readonly cdrService: DespatchGuideCdrService,
    private readonly pdfService: DespatchGuidePdfArtifactService,
  ) {}

  async create(
    dto: CreateDespatchGuideDto,
    idempotencyKey: string,
    principal: ApplicationPrincipal,
    request: RequestWithId,
  ) {
    validateIdempotencyKey(idempotencyKey);
    this.validate(dto);
    const requestHash = hashCanonical({
      environment: principal.environment,
      payload: dto,
    });
    const replay = await this.findReplay(
      principal.applicationId,
      idempotencyKey,
      requestHash,
    );
    if (replay) return replay;

    try {
      return await this.prisma.$transaction(
        async (tx) => {
          const transactionReplay = await tx.idempotencyRecord.findUnique({
            where: {
              applicationId_key: {
                applicationId: principal.applicationId,
                key: idempotencyKey,
              },
            },
          });
          if (transactionReplay) {
            if (transactionReplay.requestHash !== requestHash) {
              throw new ConflictException(
                'Idempotency-Key ya fue usada con una solicitud diferente',
              );
            }
            return transactionReplay.responseBody;
          }

          const series = await tx.fiscalSeries.findFirst({
            where: {
              tenantId: principal.tenantId,
              applicationId: principal.applicationId,
              environment: principal.environment,
              documentType: 'DESPATCH_GUIDE',
              series: dto.series,
              active: true,
              establishment: { active: true },
            },
            include: {
              tenant: { include: { branding: true } },
              establishment: true,
            },
          });
          if (!series) {
            throw new BadRequestException(
              'La serie T no está activa para esta aplicación, ambiente y establecimiento',
            );
          }
          if (!series.tenant.address || !series.tenant.ubigeo) {
            throw new ConflictException(
              'La empresa debe tener dirección y ubigeo antes de registrar una guía',
            );
          }
          if (!isSunatUbigeo(series.tenant.ubigeo)) {
            throw new ConflictException(
              'El ubigeo fiscal de la empresa no pertenece al Catálogo SUNAT 13',
            );
          }
          if (dto.transferReasonCode === '18') {
            if (
              dto.recipient.documentType !== DespatchPartyDocumentType.RUC ||
              dto.recipient.documentNumber.trim() !== series.tenant.ruc
            ) {
              throw new BadRequestException(
                'Para traslado itinerante el destinatario debe ser el propio remitente',
              );
            }
          }
          if (series.currentNumber >= MAX_GUIDE_NUMBER) {
            throw new ConflictException(
              'La serie alcanzó el máximo SUNAT de 99999999 correlativos',
            );
          }

          const advancedSeries = await tx.fiscalSeries.update({
            where: { id: series.id },
            data: { currentNumber: { increment: 1 } },
          });
          const relatedDocuments = this.relatedDocuments(dto);
          const guide = await tx.despatchGuide.create({
            data: {
              tenantId: principal.tenantId,
              applicationId: principal.applicationId,
              fiscalSeriesId: series.id,
              externalId: dto.externalId.trim(),
              environment: principal.environment,
              status: 'REGISTERED',
              series: dto.series,
              number: advancedSeries.currentNumber,
              issueDate: dateOnly(dto.issueDate),
              issueTime: currentTimeInPeru(),
              transferStartDate: dateOnly(dto.transferStartDate),
              carrierDeliveryDate: dto.carrierDeliveryDate
                ? dateOnly(dto.carrierDeliveryDate)
                : null,
              transferReasonCode: dto.transferReasonCode,
              transferReasonDescription: clean(dto.transferReasonDescription),
              transportMode: dto.transportMode,
              grossWeight: new Prisma.Decimal(dto.grossWeight),
              weightUnit: dto.weightUnit,
              packageCount: dto.packageCount,
              departureUbigeo: dto.departure.ubigeo,
              departureAddress: dto.departure.address.trim(),
              arrivalUbigeo: dto.arrival?.ubigeo,
              arrivalAddress: dto.arrival?.address.trim(),
              relatedDocumentType: relatedDocuments[0]?.documentType,
              relatedDocumentNumber: clean(relatedDocuments[0]?.number),
              issuerSnapshot: {
                ruc: series.tenant.ruc,
                legalName: series.tenant.legalName,
                tradeName: series.tenant.tradeName,
                address: series.establishment.address,
                ubigeo: series.establishment.ubigeo,
                establishmentCode: series.establishment.code,
              },
              brandingSnapshot: toTenantBrandingSnapshot(
                series.tenant.branding,
              ),
              requestPayload: dto as unknown as Prisma.InputJsonValue,
              metadata: dto.metadata,
              recipient: {
                create: {
                  documentType: dto.recipient.documentType,
                  documentNumber: dto.recipient.documentNumber.trim(),
                  name: dto.recipient.name.trim(),
                  address: clean(dto.recipient.address),
                  ubigeo: dto.recipient.ubigeo,
                },
              },
              carrier: dto.carrier
                ? {
                    create: {
                      ruc: dto.carrier.ruc,
                      legalName: dto.carrier.legalName.trim(),
                      mtcRegistrationNumber: clean(
                        dto.carrier.mtcRegistrationNumber,
                      ),
                    },
                  }
                : undefined,
              vehicles: {
                create: (dto.vehicles ?? []).map((vehicle) => ({
                  plate: normalize(vehicle.plate),
                  brand: clean(vehicle.brand),
                  authorizationNumber: clean(vehicle.authorizationNumber),
                  primary: vehicle.primary,
                })),
              },
              drivers: {
                create: (dto.drivers ?? []).map((driver) => ({
                  documentType: driver.documentType,
                  documentNumber: driver.documentNumber.trim(),
                  firstNames: driver.firstNames.trim(),
                  lastNames: driver.lastNames.trim(),
                  licenseNumber: normalize(driver.licenseNumber),
                  primary: driver.primary,
                })),
              },
              items: {
                create: dto.items.map((item, index) => ({
                  lineNumber: index + 1,
                  externalId: item.externalId.trim(),
                  sku: clean(item.sku),
                  description: item.description.trim(),
                  quantity: new Prisma.Decimal(item.quantity),
                  unitCode: normalize(item.unitCode),
                })),
              },
              relatedDocuments: {
                create: relatedDocuments.map((document) => ({
                  documentType: document.documentType,
                  number: document.number,
                })),
              },
            },
            include: GUIDE_INCLUDE,
          });
          const response = this.toResponse(guide);
          await tx.idempotencyRecord.create({
            data: {
              applicationId: principal.applicationId,
              key: idempotencyKey,
              requestHash,
              resourceType: 'despatch_guide',
              resourceId: guide.id,
              responseStatus: 201,
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
              action: 'despatch_guide.registered',
              resourceType: 'despatch_guide',
              resourceId: guide.id,
              requestId: request.requestId,
              ip: request.ip,
              data: {
                series: guide.series,
                number: guide.number,
                transferReasonCode: guide.transferReasonCode,
                transportMode: guide.transportMode,
              },
            },
          });
          return response;
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          timeout: 10_000,
        },
      );
    } catch (error) {
      if (isUniqueConflict(error)) {
        const concurrentReplay = await this.findReplay(
          principal.applicationId,
          idempotencyKey,
          requestHash,
        );
        if (concurrentReplay) return concurrentReplay;
        throw new ConflictException(
          'Ya existe una guía con el mismo externalId',
        );
      }
      throw error;
    }
  }

  async get(id: string, principal: ApplicationPrincipal) {
    const guide = await this.prisma.despatchGuide.findFirst({
      where: {
        id,
        tenantId: principal.tenantId,
        applicationId: principal.applicationId,
        environment: principal.environment,
      },
      include: GUIDE_INCLUDE,
    });
    if (!guide) throw new NotFoundException('Guía de remisión no encontrada');
    return this.toResponse(guide);
  }

  async submit(
    id: string,
    idempotencyKey: string,
    principal: ApplicationPrincipal,
    request: RequestWithId,
  ) {
    validateIdempotencyKey(idempotencyKey);
    return this.prisma.$transaction(async (tx) => {
      const guide = await tx.despatchGuide.findFirst({
        where: {
          id,
          tenantId: principal.tenantId,
          applicationId: principal.applicationId,
          environment: principal.environment,
        },
        include: GUIDE_INCLUDE,
      });
      if (!guide) throw new NotFoundException('Guía de remisión no encontrada');
      if (
        ['ACCEPTED', 'ACCEPTED_WITH_OBSERVATIONS', 'VALIDATED_BETA'].includes(
          guide.status,
        )
      ) {
        return this.toResponse(guide);
      }
      if (['CANCELLED', 'CANCELLATION_REQUESTED'].includes(guide.status)) {
        throw new ConflictException('No se puede enviar una guía anulada');
      }
      await tx.despatchGuideEmissionJob.upsert({
        where: { guideId: guide.id },
        create: { guideId: guide.id },
        update: {
          status: 'PENDING',
          nextAttemptAt: new Date(),
          lockedAt: null,
          lockedBy: null,
          lastErrorCode: null,
          lastErrorMessage: null,
          processedAt: null,
        },
      });
      await tx.auditEvent.create({
        data: {
          tenantId: guide.tenantId,
          applicationId: guide.applicationId,
          actorType: 'API_KEY',
          actorId: principal.apiKeyId,
          action: 'despatch_guide.submission_queued',
          resourceType: 'despatch_guide',
          resourceId: guide.id,
          requestId: request.requestId,
          ip: request.ip,
          data: { idempotencyKey },
        },
      });
      return this.toResponse(guide);
    });
  }

  async list(
    principal: ApplicationPrincipal,
    query: ListDespatchGuidesQueryDto,
  ) {
    const guides = await this.prisma.despatchGuide.findMany({
      where: {
        tenantId: principal.tenantId,
        applicationId: principal.applicationId,
        environment: principal.environment,
        externalId: query.externalId,
        status: query.status,
      },
      include: GUIDE_INCLUDE,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });
    const hasMore = guides.length > query.limit;
    const page = hasMore ? guides.slice(0, query.limit) : guides;
    return {
      data: page.map((guide) => this.toResponse(guide)),
      nextCursor: hasMore ? (page.at(-1)?.id ?? null) : null,
    };
  }

  async generateArtifacts(
    id: string,
    principal: ApplicationPrincipal,
    request: RequestWithId,
  ) {
    const generated = await this.artifactService.generate(id, {
      tenantId: principal.tenantId,
      applicationId: principal.applicationId,
      environment: principal.environment,
    });
    await this.prisma.auditEvent.create({
      data: {
        tenantId: principal.tenantId,
        applicationId: principal.applicationId,
        actorType: 'API_KEY',
        actorId: principal.apiKeyId,
        action: 'despatch_guide.artifacts_generated',
        resourceType: 'despatch_guide',
        resourceId: id,
        requestId: request.requestId,
        ip: request.ip,
        data: {
          xmlSha256: generated.xml.sha256,
          zipSha256: generated.zip.sha256,
        },
      },
    });
    return {
      digestValue: generated.digestValue,
      artifacts: [generated.xml, generated.zip].map(artifactResponse),
    };
  }

  async listArtifacts(id: string, principal: ApplicationPrincipal) {
    await this.assertOwned(id, principal);
    const artifacts = await this.prisma.despatchGuideArtifact.findMany({
      where: { guideId: id },
      orderBy: { createdAt: 'asc' },
    });
    return { data: artifacts.map(artifactResponse) };
  }

  async processCdr(
    id: string,
    cdrZip: Buffer,
    principal: ApplicationPrincipal,
  ) {
    await this.assertOwned(id, principal);
    return this.cdrService.process(id, cdrZip);
  }

  async generatePdfA4(id: string, principal: ApplicationPrincipal) {
    await this.assertOwned(id, principal);
    return artifactResponse(await this.pdfService.generate(id));
  }

  async downloadArtifact(
    id: string,
    artifactType: string,
    principal: ApplicationPrincipal,
  ) {
    const type = artifactType.toUpperCase();
    if (!['XML', 'ZIP', 'CDR', 'PDF_A4'].includes(type)) {
      throw new BadRequestException(
        'El artefacto debe ser XML, ZIP, CDR o PDF_A4',
      );
    }
    await this.assertOwned(id, principal);
    const artifact = await this.prisma.despatchGuideArtifact.findUnique({
      where: {
        guideId_type: {
          guideId: id,
          type: type as 'XML' | 'ZIP' | 'CDR' | 'PDF_A4',
        },
      },
    });
    if (!artifact)
      throw new NotFoundException('Archivo de la guía no encontrado');
    const expiresIn = this.storage.signedUrlTtlSeconds();
    return {
      ...artifactResponse(artifact),
      downloadUrl: await this.storage.temporaryDownloadUrl(
        artifact.objectKey,
        artifact.fileName,
        expiresIn,
      ),
      expiresIn,
    };
  }

  private async assertOwned(id: string, principal: ApplicationPrincipal) {
    const guide = await this.prisma.despatchGuide.findFirst({
      where: {
        id,
        tenantId: principal.tenantId,
        applicationId: principal.applicationId,
        environment: principal.environment,
      },
      select: { id: true },
    });
    if (!guide) throw new NotFoundException('Guía de remisión no encontrada');
  }

  async cancel(
    id: string,
    dto: CancelDespatchGuideDto,
    idempotencyKey: string,
    principal: ApplicationPrincipal,
    request: RequestWithId,
  ) {
    validateIdempotencyKey(idempotencyKey);
    const requestHash = hashCanonical({
      operation: 'cancel',
      guideId: id,
      reason: dto.reason.trim(),
    });
    const replay = await this.findReplay(
      principal.applicationId,
      idempotencyKey,
      requestHash,
    );
    if (replay) return replay;

    return this.prisma.$transaction(async (tx) => {
      const guide = await tx.despatchGuide.findFirst({
        where: {
          id,
          tenantId: principal.tenantId,
          applicationId: principal.applicationId,
          environment: principal.environment,
        },
        include: GUIDE_INCLUDE,
      });
      if (!guide) {
        throw new NotFoundException('Guía de remisión no encontrada');
      }
      if (['CANCELLED', 'CANCELLATION_REQUESTED'].includes(guide.status)) {
        return this.toResponse(guide);
      }
      const localCancellation =
        !guide.submittedAt &&
        ['REGISTERED', 'REJECTED', 'FAILED'].includes(guide.status);
      const status: DespatchGuideStatus = localCancellation
        ? 'CANCELLED'
        : 'CANCELLATION_REQUESTED';
      const now = new Date();
      const updated = await tx.despatchGuide.update({
        where: { id },
        data: {
          status,
          cancellationReason: dto.reason.trim(),
          cancellationRequestedAt: now,
          cancelledAt: localCancellation ? now : null,
        },
        include: GUIDE_INCLUDE,
      });
      const response = this.toResponse(updated);
      await tx.idempotencyRecord.create({
        data: {
          applicationId: principal.applicationId,
          key: idempotencyKey,
          requestHash,
          resourceType: 'despatch_guide_cancellation',
          resourceId: id,
          responseStatus: 200,
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
          action: localCancellation
            ? 'despatch_guide.cancelled'
            : 'despatch_guide.cancellation_requested',
          resourceType: 'despatch_guide',
          resourceId: id,
          requestId: request.requestId,
          ip: request.ip,
          data: { reason: dto.reason.trim() },
        },
      });
      return response;
    });
  }

  private validate(dto: CreateDespatchGuideDto) {
    if (!SUNAT_TRANSFER_REASONS.has(dto.transferReasonCode)) {
      throw new BadRequestException(
        'El motivo de traslado no pertenece al Catálogo SUNAT 20',
      );
    }
    if (!/^T[A-Z0-9]{3}$/.test(dto.series)) {
      throw new BadRequestException(
        'La serie de una GRE remitente debe tener el formato T###',
      );
    }

    const issueDate = dateOnly(dto.issueDate);
    const transferDate = dateOnly(dto.transferStartDate);
    const today = todayInPeru();
    const yesterday = new Date(today);
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    if (issueDate > today) {
      throw new BadRequestException(
        'La fecha de emisión no puede ser posterior a la fecha actual de Perú',
      );
    }
    if (issueDate < yesterday) {
      throw new BadRequestException(
        'SUNAT solo admite la GRE el día de emisión o hasta un día después',
      );
    }
    if (transferDate < issueDate) {
      throw new BadRequestException(
        'La fecha de inicio del traslado no puede ser anterior a la emisión',
      );
    }
    if (dto.transportMode === DespatchTransportMode.PUBLIC) {
      if (!dto.carrierDeliveryDate) {
        throw new BadRequestException(
          'El transporte público requiere la fecha de entrega de bienes al transportista',
        );
      }
      const deliveryDate = dateOnly(dto.carrierDeliveryDate);
      if (deliveryDate < issueDate) {
        throw new BadRequestException(
          'La fecha de entrega al transportista no puede ser anterior a la emisión',
        );
      }
      if (transferDate < deliveryDate) {
        throw new BadRequestException(
          'La fecha de inicio no puede ser anterior a la entrega al transportista',
        );
      }
    } else if (dto.carrierDeliveryDate) {
      throw new BadRequestException(
        'La fecha de entrega al transportista solo corresponde al transporte público',
      );
    }

    if (!isSunatUbigeo(dto.departure.ubigeo)) {
      throw new BadRequestException(
        'El ubigeo de partida no pertenece al Catálogo SUNAT 13',
      );
    }
    if (dto.transferReasonCode === '18') {
      if (dto.arrival) {
        throw new BadRequestException(
          'El traslado itinerante no debe informar punto de llegada',
        );
      }
    } else if (!dto.arrival) {
      throw new BadRequestException('El punto de llegada es obligatorio');
    } else if (!isSunatUbigeo(dto.arrival.ubigeo)) {
      throw new BadRequestException(
        'El ubigeo de llegada no pertenece al Catálogo SUNAT 13',
      );
    }
    if (dto.recipient.ubigeo && !isSunatUbigeo(dto.recipient.ubigeo)) {
      throw new BadRequestException(
        'El ubigeo del destinatario no pertenece al Catálogo SUNAT 13',
      );
    }

    const description = dto.transferReasonDescription?.trim() ?? '';
    if (
      dto.transferReasonCode === '13' &&
      (description.length < 3 ||
        description.length > 100 ||
        (description.match(/\p{L}/gu)?.length ?? 0) < 3)
    ) {
      throw new BadRequestException(
        'El motivo Otros requiere una descripción de 3 a 100 caracteres con al menos 3 letras',
      );
    }
    if (new Prisma.Decimal(dto.grossWeight).lte(0)) {
      throw new BadRequestException('El peso bruto debe ser mayor a cero');
    }
    if (!['KGM', 'TNE'].includes(dto.weightUnit)) {
      throw new BadRequestException(
        'La unidad del peso bruto solo puede ser KGM o TNE',
      );
    }
    if (dto.items.some((item) => new Prisma.Decimal(item.quantity).lte(0))) {
      throw new BadRequestException(
        'Todas las cantidades deben ser mayores a cero',
      );
    }
    assertUnique(
      dto.items.map((item) => normalize(item.externalId)),
      'Los externalId de los bienes no pueden repetirse',
    );
    assertUnique(
      (dto.vehicles ?? []).map((vehicle) => normalize(vehicle.plate)),
      'Las placas no pueden repetirse',
    );
    assertUnique(
      (dto.drivers ?? []).map(
        (driver) =>
          `${driver.documentType}:${normalize(driver.documentNumber)}`,
      ),
      'Los conductores no pueden repetirse',
    );
    this.validateIdentity(
      dto.recipient.documentType,
      dto.recipient.documentNumber,
      'destinatario',
    );
    this.validateRelatedDocument(dto);
    if (dto.transportMode === DespatchTransportMode.PUBLIC) {
      if (!dto.carrier) {
        throw new BadRequestException(
          'El transporte público requiere los datos del transportista',
        );
      }
      if (dto.vehicles?.length || dto.drivers?.length) {
        throw new BadRequestException(
          'El transporte público no debe registrar vehículos ni conductores del remitente',
        );
      }
    } else {
      if (dto.carrier) {
        throw new BadRequestException(
          'El transporte privado no debe registrar un transportista tercero',
        );
      }
      if (!(dto.vehicles?.length && dto.drivers?.length)) {
        throw new BadRequestException(
          'El transporte privado requiere al menos un vehículo y un conductor',
        );
      }
    }
    this.assertOnePrimary(dto.vehicles ?? [], 'vehículo');
    this.assertOnePrimary(dto.drivers ?? [], 'conductor');
    for (const driver of dto.drivers ?? []) {
      this.validateIdentity(
        driver.documentType,
        driver.documentNumber,
        'conductor',
      );
    }
  }

  private validateRelatedDocument(dto: CreateDespatchGuideDto) {
    const documents = this.relatedDocuments(dto);
    const reason = dto.transferReasonCode;
    if (['08', '09', '19'].includes(reason) && documents.length === 0) {
      throw new BadRequestException(
        'El motivo seleccionado requiere un documento aduanero relacionado',
      );
    }
    for (const related of documents)
      this.validateRelatedDocumentItem(related, reason);
  }

  private validateRelatedDocumentItem(
    related: { documentType: string; number: string },
    reason: string,
  ) {
    if (!SUNAT_REMITTENT_DOCUMENT_TYPES.has(related.documentType)) {
      throw new BadRequestException(
        'El tipo de documento no pertenece al Catálogo SUNAT 61 para GRE remitente',
      );
    }
    if (
      !isValidRelatedDocumentNumber(
        related.documentType,
        related.number,
        reason,
      )
    ) {
      throw new BadRequestException(
        'El número del documento relacionado no cumple el formato SUNAT',
      );
    }
    if (
      ['08', '09'].includes(reason) &&
      !['50', '52'].includes(related.documentType)
    ) {
      throw new BadRequestException(
        'Importación y exportación requieren una DAM (50) o DS (52)',
      );
    }
    if (
      reason === '19' &&
      !['50', '52', '91', '92'].includes(related.documentType)
    ) {
      throw new BadRequestException(
        'Mercancía extranjera requiere documento 50, 52, 91 o 92',
      );
    }
    if (reason === '13' && related.documentType === '52') {
      throw new BadRequestException(
        'La Declaración Simplificada (52) no corresponde al motivo Otros',
      );
    }
    if (
      !['08', '09', '13', '19'].includes(reason) &&
      ['50', '52'].includes(related.documentType)
    ) {
      throw new BadRequestException(
        'La DAM o DS no corresponde al motivo de traslado seleccionado',
      );
    }
    if (reason !== '19' && ['91', '92'].includes(related.documentType)) {
      throw new BadRequestException(
        'Los documentos 91 y 92 solo corresponden a mercancía extranjera',
      );
    }
  }

  private relatedDocuments(dto: CreateDespatchGuideDto) {
    const source = dto.relatedDocuments?.length
      ? dto.relatedDocuments
      : dto.relatedDocument
        ? [dto.relatedDocument]
        : [];
    const unique = new Map<string, { documentType: string; number: string }>();
    for (const document of source) {
      const normalized = {
        documentType: document.documentType.trim(),
        number: document.number.trim(),
      };
      unique.set(`${normalized.documentType}:${normalized.number}`, normalized);
    }
    return [...unique.values()];
  }

  private assertOnePrimary(items: Array<{ primary: boolean }>, label: string) {
    if (items.length && items.filter((item) => item.primary).length !== 1) {
      throw new BadRequestException(
        `Debe existir exactamente un ${label} principal`,
      );
    }
  }

  private validateIdentity(
    type: DespatchPartyDocumentType,
    number: string,
    role: string,
  ) {
    const value = number.trim();
    if (type === DespatchPartyDocumentType.RUC && !/^\d{11}$/.test(value)) {
      throw new BadRequestException(`El RUC del ${role} debe tener 11 dígitos`);
    }
    if (type === DespatchPartyDocumentType.DNI && !/^\d{8}$/.test(value)) {
      throw new BadRequestException(`El DNI del ${role} debe tener 8 dígitos`);
    }
  }

  private async findReplay(
    applicationId: string,
    key: string,
    requestHash: string,
  ) {
    const existing = await this.prisma.idempotencyRecord.findUnique({
      where: { applicationId_key: { applicationId, key } },
    });
    if (!existing) return null;
    if (existing.requestHash !== requestHash) {
      throw new ConflictException(
        'Idempotency-Key ya fue usada con una solicitud diferente',
      );
    }
    return existing.responseBody;
  }

  private toResponse(guide: StoredGuide) {
    return {
      id: guide.id,
      externalId: guide.externalId,
      type: 'DESPATCH_GUIDE',
      status: guide.status,
      series: guide.series,
      number: guide.number,
      fullNumber: `${guide.series}-${String(guide.number).padStart(8, '0')}`,
      environment: guide.environment,
      issueDate: guide.issueDate.toISOString().slice(0, 10),
      issueTime: guide.issueTime,
      transfer: {
        startDate: guide.transferStartDate.toISOString().slice(0, 10),
        deliveryDateToCarrier:
          guide.carrierDeliveryDate?.toISOString().slice(0, 10) ?? null,
        reasonCode: guide.transferReasonCode,
        reasonName:
          SUNAT_TRANSFER_REASONS.get(guide.transferReasonCode) ?? null,
        reasonDescription: guide.transferReasonDescription,
        transportMode: guide.transportMode,
        transportModeCode: SUNAT_TRANSPORT_MODE_CODE[guide.transportMode],
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
      recipient: guide.recipient
        ? {
            documentType: guide.recipient.documentType,
            documentNumber: guide.recipient.documentNumber,
            name: guide.recipient.name,
            address: guide.recipient.address,
            ubigeo: guide.recipient.ubigeo,
          }
        : null,
      carrier: guide.carrier
        ? {
            ruc: guide.carrier.ruc,
            legalName: guide.carrier.legalName,
            mtcRegistrationNumber: guide.carrier.mtcRegistrationNumber,
          }
        : null,
      vehicles: guide.vehicles.map((vehicle) => ({
        plate: vehicle.plate,
        brand: vehicle.brand,
        authorizationNumber: vehicle.authorizationNumber,
        primary: vehicle.primary,
      })),
      drivers: guide.drivers.map((driver) => ({
        documentType: driver.documentType,
        documentNumber: driver.documentNumber,
        firstNames: driver.firstNames,
        lastNames: driver.lastNames,
        licenseNumber: driver.licenseNumber,
        primary: driver.primary,
      })),
      items: guide.items.map((item) => ({
        lineNumber: item.lineNumber,
        externalId: item.externalId,
        sku: item.sku,
        description: item.description,
        quantity: item.quantity.toFixed(),
        unitCode: item.unitCode,
      })),
      relatedDocument:
        guide.relatedDocuments?.[0] ??
        (guide.relatedDocumentType && guide.relatedDocumentNumber
          ? {
              documentType: guide.relatedDocumentType,
              number: guide.relatedDocumentNumber,
            }
          : null),
      relatedDocuments: (guide.relatedDocuments ?? []).map((document) => ({
        documentType: document.documentType,
        number: document.number,
      })),
      artifacts: guide.artifacts.map(artifactResponse),
      sunatHash: guide.sunatHash,
      sunatTicket: guide.sunatTicket,
      cancellation: guide.cancellationReason
        ? {
            reason: guide.cancellationReason,
            requestedAt: guide.cancellationRequestedAt?.toISOString() ?? null,
            cancelledAt: guide.cancelledAt?.toISOString() ?? null,
          }
        : null,
      sunat:
        guide.submittedAt || guide.respondedAt
          ? {
              code: guide.sunatCode,
              message: guide.sunatMessage,
              observations: guide.sunatObservations,
              submittedAt: guide.submittedAt?.toISOString() ?? null,
              respondedAt: guide.respondedAt?.toISOString() ?? null,
            }
          : null,
      createdAt: guide.createdAt.toISOString(),
      updatedAt: guide.updatedAt.toISOString(),
    };
  }
}

function validateIdempotencyKey(value: string) {
  if (!value || value.length < 16 || value.length > 100 || /\s/.test(value)) {
    throw new BadRequestException(
      'Idempotency-Key debe tener entre 16 y 100 caracteres sin espacios',
    );
  }
}

function assertUnique(values: string[], message: string) {
  if (new Set(values).size !== values.length) {
    throw new BadRequestException(message);
  }
}

function dateOnly(value: string) {
  return new Date(`${value}T00:00:00.000Z`);
}

function todayInPeru() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Lima',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const values = Object.fromEntries(
    parts.map((part) => [part.type, part.value]),
  );
  return dateOnly(`${values.year}-${values.month}-${values.day}`);
}

function currentTimeInPeru() {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'America/Lima',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).format(new Date());
}

function artifactResponse(artifact: {
  id: string;
  type: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  sha256: string;
  createdAt: Date;
}) {
  return {
    id: artifact.id,
    type: artifact.type,
    fileName: artifact.fileName,
    contentType: artifact.contentType,
    sizeBytes: artifact.sizeBytes,
    sha256: artifact.sha256,
    createdAt: artifact.createdAt.toISOString(),
  };
}

function clean(value?: string | null) {
  return value?.trim() || null;
}

function normalize(value: string) {
  return value.trim().toUpperCase();
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

function isUniqueConflict(error: unknown) {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  );
}
