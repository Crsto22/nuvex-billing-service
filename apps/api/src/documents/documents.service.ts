import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DocumentStatus, PaymentMethod, Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import { PrismaService } from '../../../../libs/database/src/prisma.service';
import type { ApplicationPrincipal } from '../auth/auth.types';
import type { RequestWithId } from '../common/request-id.middleware';
import { toTenantBrandingSnapshot } from '../branding/tenant-branding.snapshot';
import {
  CreateDocumentDto,
  CustomerDocumentType,
  ListDocumentsQueryDto,
} from './dto/create-document.dto';
import {
  CreateEstablishmentDto,
  CreateFiscalSeriesDto,
} from './dto/fiscal-setup.dto';
import { Calculation, TaxCalculatorService } from './tax-calculator.service';

type StoredDocument = Prisma.TaxDocumentGetPayload<{
  include: {
    lines: true;
    installments: true;
    artifacts: true;
    references: true;
    noteAdjustments: true;
  };
}>;

@Injectable()
export class DocumentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly calculator: TaxCalculatorService,
  ) {}

  async create(
    dto: CreateDocumentDto,
    idempotencyKey: string,
    principal: ApplicationPrincipal,
    request: RequestWithId,
  ) {
    this.validateIdempotencyKey(idempotencyKey);
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

    const calculation = this.calculator.calculate(dto);
    this.validateCustomer(dto, calculation.total);
    this.calculator.assertExpectedTotals(dto.expectedTotals, calculation);
    this.validatePayment(dto, calculation);
    this.validateMetadata(dto.metadata);

    const credential = await this.prisma.taxCredential.findUnique({
      where: {
        tenantId_environment: {
          tenantId: principal.tenantId,
          environment: principal.environment,
        },
      },
    });
    const now = new Date();
    if (
      !credential?.active ||
      !credential.certificateExpiresAt ||
      credential.certificateExpiresAt <= now ||
      (credential.certificateValidFrom && credential.certificateValidFrom > now)
    ) {
      throw new ConflictException(
        'La empresa no tiene credenciales SUNAT activas y vigentes para este ambiente',
      );
    }

    const fiscalSeries = await this.prisma.fiscalSeries.findFirst({
      where: {
        tenantId: principal.tenantId,
        applicationId: principal.applicationId,
        environment: principal.environment,
        documentType: dto.documentType,
        series: dto.series,
        active: true,
        establishment: { code: dto.establishmentCode, active: true },
      },
      include: {
        tenant: { include: { branding: true } },
        establishment: true,
      },
    });
    if (!fiscalSeries) {
      throw new BadRequestException(
        'La serie no estÃ¡ asignada a esta aplicaciÃ³n, ambiente y establecimiento',
      );
    }
    if (!fiscalSeries.tenant.address || !fiscalSeries.tenant.ubigeo) {
      throw new ConflictException(
        'La empresa debe tener direcciÃ³n y ubigeo antes de emitir',
      );
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        const advancedSeries = await tx.fiscalSeries.update({
          where: { id: fiscalSeries.id },
          data: { currentNumber: { increment: 1 } },
        });
        const document = await tx.taxDocument.create({
          data: {
            tenantId: principal.tenantId,
            applicationId: principal.applicationId,
            fiscalSeriesId: fiscalSeries.id,
            externalId: dto.externalId,
            environment: principal.environment,
            documentType: dto.documentType,
            status: 'QUEUED',
            series: dto.series,
            number: advancedSeries.currentNumber,
            issueDate: dateOnly(dto.issueDate),
            issueTime: dto.issueTime,
            currency: dto.currency,
            paymentMethod: dto.paymentTerms.method,
            amountDue:
              dto.paymentTerms.method === PaymentMethod.CREDIT
                ? new Prisma.Decimal(dto.paymentTerms.amountDue ?? '0')
                : null,
            calculationVersion: calculation.calculationVersion,
            issuerSnapshot: {
              ruc: fiscalSeries.tenant.ruc,
              legalName: fiscalSeries.tenant.legalName,
              tradeName: fiscalSeries.tenant.tradeName,
              address: fiscalSeries.establishment.address,
              ubigeo: fiscalSeries.establishment.ubigeo,
              establishmentCode: fiscalSeries.establishment.code,
            },
            brandingSnapshot: toTenantBrandingSnapshot(
              fiscalSeries.tenant.branding,
            ),
            customerSnapshot: dto.customer as unknown as Prisma.InputJsonValue,
            requestPayload: dto as unknown as Prisma.InputJsonValue,
            normalizedPayload: {
              ...dto,
              calculation: this.calculator.toResponse(calculation),
            } as unknown as Prisma.InputJsonValue,
            metadata: dto.metadata,
            taxableAmount: calculation.taxable,
            exemptAmount: calculation.exempt,
            unaffectedAmount: calculation.unaffected,
            discountAmount: calculation.discount,
            taxAmount: calculation.tax,
            totalAmount: calculation.total,
            lines: {
              create: calculation.lines.map((line, index) => ({
                lineNumber: index + 1,
                externalId: line.input.externalId,
                sku: clean(line.input.sku),
                description: line.input.description.trim(),
                unitCode: line.input.unitCode,
                quantity: new Prisma.Decimal(line.input.quantity),
                unitPrice: new Prisma.Decimal(line.input.unitPrice),
                unitPriceIncludesTax: line.input.unitPriceIncludesTax,
                taxAffectationCode: line.input.taxAffectationCode,
                unitValue: line.unitValue,
                discountAmount: line.discountAmount,
                lineValue: line.lineValue,
                taxAmount: line.taxAmount,
                totalAmount: line.totalAmount,
              })),
            },
            installments: {
              create: (dto.paymentTerms.installments ?? []).map(
                (installment) => ({
                  number: installment.number,
                  amount: new Prisma.Decimal(installment.amount),
                  dueDate: dateOnly(installment.dueDate),
                }),
              ),
            },
            emissionJobs: { create: { operation: 'ISSUE', status: 'PENDING' } },
          },
          include: {
            lines: true,
            installments: true,
            artifacts: true,
            references: true,
            noteAdjustments: true,
          },
        });
        const response = this.toResponse(document);
        await tx.idempotencyRecord.create({
          data: {
            applicationId: principal.applicationId,
            key: idempotencyKey,
            requestHash,
            resourceType: 'tax_document',
            resourceId: document.id,
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
            action: 'tax_document.created',
            resourceType: 'tax_document',
            resourceId: document.id,
            requestId: request.requestId,
            ip: request.ip,
            data: {
              externalId: dto.externalId,
              fullNumber: response.fullNumber,
              environment: principal.environment,
              total: response.totals.total,
              calculationVersion: calculation.calculationVersion,
            },
          },
        });
        return response;
      });
    } catch (error) {
      if (isUniqueConflict(error)) {
        const concurrentReplay = await this.findReplay(
          principal.applicationId,
          idempotencyKey,
          requestHash,
        );
        if (concurrentReplay) return concurrentReplay;
        throw new ConflictException(
          'Ya existe un documento con el mismo externalId',
        );
      }
      throw error;
    }
  }

  async list(principal: ApplicationPrincipal, query: ListDocumentsQueryDto) {
    const take = query.limit + 1;
    const documents = await this.prisma.taxDocument.findMany({
      where: {
        applicationId: principal.applicationId,
        environment: principal.environment,
        externalId: query.externalId,
        status: query.status as DocumentStatus | undefined,
      },
      include: {
        lines: true,
        installments: true,
        artifacts: true,
        references: true,
        noteAdjustments: true,
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });
    const hasMore = documents.length === take;
    if (hasMore) documents.pop();
    return {
      items: documents.map((document) => this.toResponse(document)),
      nextCursor: hasMore ? (documents.at(-1)?.id ?? null) : null,
    };
  }

  async get(id: string, principal: ApplicationPrincipal) {
    const document = await this.prisma.taxDocument.findFirst({
      where: {
        id,
        applicationId: principal.applicationId,
        environment: principal.environment,
      },
      include: {
        lines: true,
        installments: true,
        artifacts: true,
        references: true,
        noteAdjustments: true,
      },
    });
    if (!document) throw new NotFoundException('Documento no encontrado');
    return this.toResponse(document);
  }

  async retry(
    id: string,
    idempotencyKey: string,
    principal: ApplicationPrincipal,
    request: RequestWithId,
  ) {
    this.validateIdempotencyKey(idempotencyKey);
    const requestHash = hashCanonical({
      operation: 'retry',
      documentId: id,
      environment: principal.environment,
    });
    const replay = await this.findReplay(
      principal.applicationId,
      idempotencyKey,
      requestHash,
    );
    if (replay) return replay;
    const current = await this.prisma.taxDocument.findFirst({
      where: {
        id,
        applicationId: principal.applicationId,
        environment: principal.environment,
      },
    });
    if (!current) throw new NotFoundException('Documento no encontrado');
    if (!['FAILED', 'RETRY_SCHEDULED'].includes(current.status)) {
      throw new ConflictException('El estado actual no permite reintentar');
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        const document = await tx.taxDocument.update({
          where: { id },
          data: {
            status: 'QUEUED',
            sunatCode: null,
            sunatMessage: null,
            sunatObservations: [],
            respondedAt: null,
          },
          include: {
            lines: true,
            installments: true,
            artifacts: true,
            references: true,
            noteAdjustments: true,
          },
        });
        const resumed =
          current.status === 'RETRY_SCHEDULED'
            ? await tx.emissionJob.updateMany({
                where: { documentId: id, status: 'PENDING' },
                data: { nextAttemptAt: new Date() },
              })
            : { count: 0 };
        if (resumed.count === 0) {
          await tx.emissionJob.create({
            data: { documentId: id, operation: 'ISSUE', status: 'PENDING' },
          });
        }
        const response = this.toResponse(document);
        await tx.idempotencyRecord.create({
          data: {
            applicationId: principal.applicationId,
            key: idempotencyKey,
            requestHash,
            resourceType: 'tax_document_retry',
            resourceId: id,
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
            action: 'tax_document.retry_requested',
            resourceType: 'tax_document',
            resourceId: id,
            requestId: request.requestId,
            ip: request.ip,
          },
        });
        return response;
      });
    } catch (error) {
      if (isUniqueConflict(error)) {
        const concurrentReplay = await this.findReplay(
          principal.applicationId,
          idempotencyKey,
          requestHash,
        );
        if (concurrentReplay) return concurrentReplay;
        throw new ConflictException(
          'El documento ya tiene un trabajo de emision activo',
        );
      }
      throw error;
    }
  }

  async createEstablishment(
    tenantId: string,
    dto: CreateEstablishmentDto,
    request: RequestWithId,
  ) {
    await this.ensureTenant(tenantId);
    try {
      return await this.prisma.$transaction(async (tx) => {
        const establishment = await tx.establishment.create({
          data: { tenantId, ...dto },
        });
        await this.adminAudit(
          tx,
          tenantId,
          establishment.id,
          'establishment.created',
          request,
        );
        return establishment;
      });
    } catch (error) {
      if (isUniqueConflict(error)) {
        throw new ConflictException('Ya existe ese establecimiento');
      }
      throw error;
    }
  }

  async listEstablishments(tenantId: string) {
    await this.ensureTenant(tenantId);
    return this.prisma.establishment.findMany({
      where: { tenantId },
      orderBy: { code: 'asc' },
    });
  }

  async createFiscalSeries(
    tenantId: string,
    dto: CreateFiscalSeriesDto,
    request: RequestWithId,
  ) {
    if (
      (dto.documentType === 'INVOICE' && !dto.series.startsWith('F')) ||
      (dto.documentType === 'RECEIPT' && !dto.series.startsWith('B')) ||
      (dto.documentType === 'DESPATCH_GUIDE' &&
        !/^T[A-Z0-9]{3}$/.test(dto.series))
    ) {
      throw new BadRequestException(
        'La serie debe iniciar con F para factura, B para boleta o T para guía de remisión',
      );
    }
    const [application, establishment] = await Promise.all([
      this.prisma.application.findFirst({
        where: { id: dto.applicationId, tenantId },
      }),
      this.prisma.establishment.findFirst({
        where: { id: dto.establishmentId, tenantId },
      }),
    ]);
    if (!application || !establishment) {
      throw new BadRequestException(
        'AplicaciÃ³n o establecimiento no pertenece a la empresa',
      );
    }
    try {
      return await this.prisma.$transaction(async (tx) => {
        const series = await tx.fiscalSeries.create({
          data: {
            tenantId,
            applicationId: dto.applicationId,
            establishmentId: dto.establishmentId,
            environment: dto.environment,
            documentType: dto.documentType,
            series: dto.series,
            currentNumber: dto.initialNumber,
          },
        });
        await this.adminAudit(
          tx,
          tenantId,
          series.id,
          'fiscal_series.created',
          request,
        );
        return series;
      });
    } catch (error) {
      if (isUniqueConflict(error))
        throw new ConflictException('La serie ya existe');
      throw error;
    }
  }

  async listFiscalSeries(tenantId: string) {
    await this.ensureTenant(tenantId);
    return this.prisma.fiscalSeries.findMany({
      where: { tenantId },
      include: { establishment: true, application: true },
      orderBy: [
        { environment: 'asc' },
        { documentType: 'asc' },
        { series: 'asc' },
      ],
    });
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

  private validateIdempotencyKey(value: string) {
    if (!value || value.length < 16 || value.length > 100 || /\s/.test(value)) {
      throw new BadRequestException(
        'Idempotency-Key debe tener entre 16 y 100 caracteres sin espacios',
      );
    }
  }

  private validateCustomer(dto: CreateDocumentDto, total: Prisma.Decimal) {
    const number = dto.customer.documentNumber?.trim();
    if (dto.customer.documentType === CustomerDocumentType.NONE && number) {
      throw new BadRequestException(
        'Un cliente sin documento no debe tener nÃºmero',
      );
    }
    if (dto.customer.documentType !== CustomerDocumentType.NONE && !number) {
      throw new BadRequestException(
        'El nÃºmero de documento del cliente es obligatorio',
      );
    }
    if (
      dto.customer.documentType === CustomerDocumentType.DNI &&
      !/^\d{8}$/.test(number ?? '')
    ) {
      throw new BadRequestException('El DNI debe tener 8 dÃ­gitos');
    }
    if (
      dto.customer.documentType === CustomerDocumentType.RUC &&
      !/^\d{11}$/.test(number ?? '')
    ) {
      throw new BadRequestException('El RUC debe tener 11 dÃ­gitos');
    }
    if (
      dto.documentType === 'INVOICE' &&
      dto.customer.documentType !== CustomerDocumentType.RUC
    ) {
      throw new BadRequestException(
        'Una factura v1 requiere un cliente con RUC',
      );
    }
    if (
      dto.documentType === 'RECEIPT' &&
      total.gt(700) &&
      ![CustomerDocumentType.DNI, CustomerDocumentType.RUC].includes(
        dto.customer.documentType,
      )
    ) {
      throw new BadRequestException(
        'Una boleta mayor a S/700 requiere DNI o RUC en esta version',
      );
    }
  }

  private validatePayment(dto: CreateDocumentDto, calculation: Calculation) {
    const installments = dto.paymentTerms.installments ?? [];
    if (dto.paymentTerms.method === PaymentMethod.CASH && installments.length) {
      throw new BadRequestException(
        'Una venta al contado no debe tener cuotas',
      );
    }
    if (dto.paymentTerms.method === PaymentMethod.CREDIT) {
      if (!installments.length) {
        throw new BadRequestException('Una venta al crÃ©dito requiere cuotas');
      }
      const numbers = new Set(installments.map((item) => item.number));
      if (numbers.size !== installments.length) {
        throw new BadRequestException(
          'Los nÃºmeros de cuota no pueden repetirse',
        );
      }
      const sum = installments.reduce(
        (total, item) => total.plus(item.amount),
        new Prisma.Decimal(0),
      );
      const amountDue = new Prisma.Decimal(dto.paymentTerms.amountDue ?? '0');
      if (amountDue.lte(0) || amountDue.gt(calculation.total)) {
        throw new BadRequestException(
          'El saldo pendiente debe ser mayor a cero y no superar el total',
        );
      }
      if (!sum.eq(amountDue)) {
        throw new BadRequestException(
          'La suma de cuotas debe coincidir con el saldo pendiente',
        );
      }
      const issueDate = dateOnly(dto.issueDate);
      if (installments.some((item) => dateOnly(item.dueDate) < issueDate)) {
        throw new BadRequestException(
          'Una cuota no puede vencer antes de la emisiÃ³n',
        );
      }
    }
  }

  private validateMetadata(metadata?: Record<string, unknown>) {
    if (!metadata) return;
    if (Object.keys(metadata).length > 20) {
      throw new BadRequestException('metadata permite como mÃ¡ximo 20 campos');
    }
    if (
      Object.values(metadata).some(
        (value) =>
          value !== null &&
          !['string', 'number', 'boolean'].includes(typeof value),
      )
    ) {
      throw new BadRequestException('metadata solo permite valores escalares');
    }
  }

  private async ensureTenant(tenantId: string) {
    if (!(await this.prisma.tenant.findUnique({ where: { id: tenantId } }))) {
      throw new NotFoundException('Empresa no encontrada');
    }
  }

  private adminAudit(
    tx: Prisma.TransactionClient,
    tenantId: string,
    resourceId: string,
    action: string,
    request: RequestWithId,
  ) {
    return tx.auditEvent.create({
      data: {
        tenantId,
        actorType: 'PLATFORM_ADMIN',
        actorId: 'platform-admin',
        action,
        resourceType: action.startsWith('establishment')
          ? 'establishment'
          : 'fiscal_series',
        resourceId,
        requestId: request.requestId,
        ip: request.ip,
      },
    });
  }

  private toResponse(document: StoredDocument) {
    return {
      id: document.id,
      externalId: document.externalId,
      type: document.documentType,
      status: document.status,
      series: document.series,
      number: document.number,
      fullNumber: `${document.series}-${String(document.number).padStart(8, '0')}`,
      environment: document.environment,
      currency: document.currency,
      issueDate: document.issueDate.toISOString().slice(0, 10),
      paymentMethod: document.paymentMethod,
      amountDue: document.amountDue?.toFixed(2) ?? null,
      calculationVersion: document.calculationVersion,
      customer: document.customerSnapshot,
      reason: document.reasonCode
        ? {
            code: document.reasonCode,
            description: document.reasonDescription,
          }
        : null,
      references: document.references.map((reference) => ({
        documentId: reference.referencedDocumentId,
        type: reference.referencedType,
        series: reference.referencedSeries,
        number: reference.referencedNumber,
        fullNumber: `${reference.referencedSeries}-${String(reference.referencedNumber).padStart(8, '0')}`,
      })),
      noteAdjustments: document.noteAdjustments.map((adjustment) => ({
        referenceLineNumber: adjustment.referenceLineNumber,
        quantity: adjustment.quantity?.toFixed() ?? null,
        amount: adjustment.amount.toFixed(2),
        description: adjustment.description,
      })),
      totals: {
        taxable: document.taxableAmount.toFixed(2),
        exempt: document.exemptAmount.toFixed(2),
        unaffected: document.unaffectedAmount.toFixed(2),
        discount: document.discountAmount.toFixed(2),
        tax: document.taxAmount.toFixed(2),
        total: document.totalAmount.toFixed(2),
      },
      lines: document.lines.map((line) => ({
        lineNumber: line.lineNumber,
        externalId: line.externalId,
        description: line.description,
        quantity: line.quantity.toFixed(),
        unitValue: line.unitValue.toFixed(10),
        discount: line.discountAmount.toFixed(2),
        lineValue: line.lineValue.toFixed(2),
        tax: line.taxAmount.toFixed(2),
        total: line.totalAmount.toFixed(2),
      })),
      installments: document.installments.map((item) => ({
        number: item.number,
        amount: item.amount.toFixed(2),
        dueDate: item.dueDate.toISOString().slice(0, 10),
      })),
      sunat:
        document.submittedAt || document.respondedAt
          ? {
              code: document.sunatCode,
              message: document.sunatMessage,
              observations: document.sunatObservations,
              submittedAt: document.submittedAt?.toISOString() ?? null,
              respondedAt: document.respondedAt?.toISOString() ?? null,
            }
          : null,
      artifacts: document.artifacts.map((artifact) => ({
        type: artifact.type,
        fileName: artifact.fileName,
        contentType: artifact.contentType,
        sizeBytes: artifact.sizeBytes,
        sha256: artifact.sha256,
        createdAt: artifact.createdAt.toISOString(),
      })),
      createdAt: document.createdAt.toISOString(),
      updatedAt: document.updatedAt.toISOString(),
    };
  }
}

function dateOnly(value: string) {
  return new Date(`${value}T00:00:00.000Z`);
}

function clean(value?: string | null) {
  return value?.trim() || null;
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
