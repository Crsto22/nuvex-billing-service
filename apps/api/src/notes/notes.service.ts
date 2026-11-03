import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DocumentType, Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import { PrismaService } from '../../../../libs/database/src/prisma.service';
import type { ApplicationPrincipal } from '../auth/auth.types';
import type { RequestWithId } from '../common/request-id.middleware';
import { toTenantBrandingSnapshot } from '../branding/tenant-branding.snapshot';
import { CreateTaxNoteDto } from './dto/create-tax-note.dto';
import { NoteTaxCalculatorService } from './note-tax-calculator.service';

const CREDIT_REASONS: Record<string, string> = {
  '01': 'Anulación de la operación',
  '02': 'Anulación por error en el RUC',
  '03': 'Corrección por error en la descripción',
  '04': 'Descuento global',
  '05': 'Descuento por ítem',
  '06': 'Devolución total',
  '07': 'Devolución por ítem',
  '08': 'Bonificación',
  '09': 'Disminución en el valor',
  '10': 'Otros conceptos',
  '11': 'Ajustes de operaciones de exportación',
  '12': 'Ajustes afectos al IVAP',
  '13': 'Corrección de pago o cuotas',
};

const DEBIT_REASONS: Record<string, string> = {
  '01': 'Intereses por mora',
  '02': 'Aumento en el valor',
  '03': 'Otros conceptos',
  '11': 'Ajustes de operaciones de exportación',
  '12': 'Ajustes afectos al IVAP',
  '13': 'Penalidades',
};

const NON_CONSUMING_CREDIT_REASONS = new Set(['03', '13']);
const FULL_CREDIT_REASONS = new Set(['01', '02', '06']);
const FINAL_FAILURE_STATUSES = new Set(['REJECTED', 'FAILED']);

type NoteType = 'CREDIT_NOTE' | 'DEBIT_NOTE';

@Injectable()
export class NotesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly calculator: NoteTaxCalculatorService,
  ) {}

  async create(
    type: NoteType,
    dto: CreateTaxNoteDto,
    idempotencyKey: string,
    principal: ApplicationPrincipal,
    request: RequestWithId,
  ): Promise<NoteCreationResponse> {
    validateIdempotencyKey(idempotencyKey);
    const requestHash = hashCanonical({
      type,
      environment: principal.environment,
      payload: dto,
    });
    const replay = await this.findReplay(
      principal.applicationId,
      idempotencyKey,
      requestHash,
    );
    if (replay) return replay as NoteCreationResponse;

    for (let attempt = 1; attempt <= 3; attempt += 1) {
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
              return transactionReplay.responseBody as NoteCreationResponse;
            }

            const source = await tx.taxDocument.findFirst({
              where: {
                id: dto.referenceDocumentId,
                tenantId: principal.tenantId,
                applicationId: principal.applicationId,
                environment: principal.environment,
              },
              include: {
                lines: true,
                tenant: { include: { branding: true } },
                referencedBy: {
                  include: {
                    document: { include: { noteAdjustments: true } },
                  },
                },
              },
            });
            if (!source) {
              throw new NotFoundException(
                'El comprobante original no existe en esta aplicación y ambiente',
              );
            }

            this.validateSource(type, dto, source);
            const validation = this.validateAdjustments(type, dto, source);
            const calculation = this.calculator.calculate(
              type,
              dto.reasonCode,
              dto.adjustments,
              source.lines,
            );

            const expectedPrefix =
              source.documentType === 'INVOICE' ? 'F' : 'B';
            if (!dto.series.startsWith(expectedPrefix)) {
              throw new BadRequestException(
                `La serie de la nota debe iniciar con ${expectedPrefix} porque modifica una ${source.documentType === 'INVOICE' ? 'factura' : 'boleta'}`,
              );
            }
            const fiscalSeries = await tx.fiscalSeries.findFirst({
              where: {
                tenantId: principal.tenantId,
                applicationId: principal.applicationId,
                environment: principal.environment,
                documentType: type,
                series: dto.series,
                active: true,
              },
            });
            if (!fiscalSeries) {
              throw new BadRequestException(
                'La serie de la nota no está activa para esta aplicación y ambiente',
              );
            }

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
                documentType: type,
                status: 'QUEUED',
                series: dto.series,
                number: advancedSeries.currentNumber,
                issueDate: dateOnly(dto.issueDate),
                currency: dto.currency,
                paymentMethod: source.paymentMethod,
                calculationVersion: calculation.calculationVersion,
                issuerSnapshot: source.issuerSnapshot as Prisma.InputJsonValue,
                brandingSnapshot: toTenantBrandingSnapshot(
                  source.tenant.branding,
                ),
                customerSnapshot:
                  source.customerSnapshot as Prisma.InputJsonValue,
                requestPayload: dto as unknown as Prisma.InputJsonValue,
                normalizedPayload: {
                  ...dto,
                  noteType: type,
                  source: {
                    id: source.id,
                    type: source.documentType,
                    series: source.series,
                    number: source.number,
                  },
                  validation,
                  calculation: this.calculator.toResponse(calculation),
                } as unknown as Prisma.InputJsonValue,
                taxableAmount: calculation.taxable,
                exemptAmount: calculation.exempt,
                unaffectedAmount: calculation.unaffected,
                discountAmount: calculation.discount,
                taxAmount: calculation.tax,
                totalAmount: calculation.total,
                reasonCode: dto.reasonCode,
                reasonDescription: dto.reasonDescription.trim(),
                references: {
                  create: {
                    referencedDocumentId: source.id,
                    referencedType: source.documentType,
                    referencedSeries: source.series,
                    referencedNumber: source.number,
                  },
                },
                noteAdjustments: {
                  create: dto.adjustments.map((adjustment) => ({
                    referenceLineNumber: adjustment.referenceLineNumber,
                    quantity: adjustment.quantity
                      ? new Prisma.Decimal(adjustment.quantity)
                      : null,
                    amount: new Prisma.Decimal(adjustment.amount),
                    description: adjustment.description?.trim() || null,
                  })),
                },
                lines: {
                  create: calculation.lines.map((line) => ({
                    lineNumber: line.lineNumber,
                    externalId: line.externalId,
                    sku: line.sku,
                    description: line.description,
                    unitCode: line.unitCode,
                    quantity: line.quantity,
                    unitPrice: line.unitPrice,
                    unitPriceIncludesTax: line.unitPriceIncludesTax,
                    taxAffectationCode: line.taxAffectationCode,
                    unitValue: line.unitValue,
                    discountAmount: line.discountAmount,
                    lineValue: line.lineValue,
                    taxAmount: line.taxAmount,
                    totalAmount: line.totalAmount,
                  })),
                },
                emissionJobs: { create: { operation: 'ISSUE' } },
              },
            });

            const response: NoteCreationResponse = {
              id: document.id,
              externalId: document.externalId,
              type,
              status: 'QUEUED',
              series: document.series,
              number: document.number,
              fullNumber: `${document.series}-${String(document.number).padStart(8, '0')}`,
              environment: document.environment,
              issueDate: dto.issueDate,
              currency: document.currency,
              reference: {
                id: source.id,
                type: source.documentType,
                series: source.series,
                number: source.number,
                fullNumber: `${source.series}-${String(source.number).padStart(8, '0')}`,
              },
              reason: {
                code: dto.reasonCode,
                description: dto.reasonDescription.trim(),
                catalogDescription:
                  (type === 'CREDIT_NOTE' ? CREDIT_REASONS : DEBIT_REASONS)[
                    dto.reasonCode
                  ] ?? '',
              },
              validation,
              calculation: this.calculator.toResponse(calculation),
              message: 'Nota calculada y encolada para generar XML y enviar',
            };
            await tx.idempotencyRecord.create({
              data: {
                applicationId: principal.applicationId,
                key: idempotencyKey,
                requestHash,
                resourceType:
                  type === 'CREDIT_NOTE' ? 'credit_note' : 'debit_note',
                resourceId: document.id,
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
                action:
                  type === 'CREDIT_NOTE'
                    ? 'credit_note.validated'
                    : 'debit_note.validated',
                resourceType: 'tax_document',
                resourceId: document.id,
                requestId: request.requestId,
                ip: request.ip,
                data: {
                  referenceDocumentId: source.id,
                  reasonCode: dto.reasonCode,
                  requestedAmount: validation.requestedAmount,
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
        if (isSerializationConflict(error) && attempt < 3) continue;
        if (isUniqueConflict(error)) {
          const concurrentReplay = await this.findReplay(
            principal.applicationId,
            idempotencyKey,
            requestHash,
          );
          if (concurrentReplay) return concurrentReplay as NoteCreationResponse;
          throw new ConflictException(
            'Ya existe una nota con el mismo externalId',
          );
        }
        throw error;
      }
    }
    throw new ConflictException(
      'No se pudo reservar el saldo; vuelva a intentar con la misma Idempotency-Key',
    );
  }

  private validateSource(
    type: NoteType,
    dto: CreateTaxNoteDto,
    source: SourceDocument,
  ) {
    if (!['INVOICE', 'RECEIPT'].includes(source.documentType)) {
      throw new BadRequestException(
        'En esta versión la nota solo puede modificar una factura o boleta',
      );
    }
    if (!['ACCEPTED', 'ACCEPTED_WITH_OBSERVATIONS'].includes(source.status)) {
      throw new ConflictException(
        'El comprobante original debe estar aceptado por SUNAT',
      );
    }
    if (dto.currency !== source.currency) {
      throw new BadRequestException(
        'La moneda de la nota debe ser igual a la del comprobante original',
      );
    }
    const sourceCustomer = source.customerSnapshot as CustomerSnapshot;
    const expectedType = String(sourceCustomer.documentType ?? '');
    const expectedNumber = normalizeIdentity(sourceCustomer.documentNumber);
    if (
      String(dto.customer.documentType) !== expectedType ||
      normalizeIdentity(dto.customer.documentNumber) !== expectedNumber
    ) {
      throw new BadRequestException(
        'El cliente de la nota debe ser el mismo del comprobante original',
      );
    }
    const reasons = type === 'CREDIT_NOTE' ? CREDIT_REASONS : DEBIT_REASONS;
    if (!reasons[dto.reasonCode]) {
      throw new BadRequestException(
        `El motivo ${dto.reasonCode} no pertenece al catálogo SUNAT para ${type === 'CREDIT_NOTE' ? 'notas de crédito' : 'notas de débito'}`,
      );
    }
    if (
      type === 'CREDIT_NOTE' &&
      source.documentType === 'RECEIPT' &&
      ['02', '04', '05', '08'].includes(dto.reasonCode)
    ) {
      throw new BadRequestException(
        `El motivo ${dto.reasonCode} no es aplicable a una boleta`,
      );
    }
    const sourceDate = source.issueDate.toISOString().slice(0, 10);
    const today = new Date().toISOString().slice(0, 10);
    if (dto.issueDate < sourceDate) {
      throw new BadRequestException(
        'La fecha de la nota no puede ser anterior al comprobante original',
      );
    }
    if (dto.issueDate > today) {
      throw new BadRequestException('La fecha de la nota no puede ser futura');
    }
  }

  private validateAdjustments(
    type: NoteType,
    dto: CreateTaxNoteDto,
    source: SourceDocument,
  ): NoteValidation {
    const duplicatedLines = dto.adjustments
      .map((item) => item.referenceLineNumber)
      .filter((line, index, all) => all.indexOf(line) !== index);
    if (duplicatedLines.length) {
      throw new BadRequestException(
        'Cada línea del comprobante original solo puede aparecer una vez',
      );
    }

    const activeCreditNotes = source.referencedBy
      .map((reference) => reference.document)
      .filter(
        (document) =>
          document.documentType === 'CREDIT_NOTE' &&
          !FINAL_FAILURE_STATUSES.has(document.status) &&
          !NON_CONSUMING_CREDIT_REASONS.has(document.reasonCode ?? ''),
      );
    const usedTotal = activeCreditNotes.reduce(
      (sum, note) =>
        sum.plus(
          note.noteAdjustments.reduce(
            (subtotal, item) => subtotal.plus(item.amount),
            new Prisma.Decimal(0),
          ),
        ),
      new Prisma.Decimal(0),
    );
    const remainingBefore = Prisma.Decimal.max(
      new Prisma.Decimal(0),
      source.totalAmount.minus(usedTotal),
    );
    const requested = dto.adjustments.reduce(
      (sum, item) => sum.plus(item.amount),
      new Prisma.Decimal(0),
    );
    const nonConsuming =
      type === 'CREDIT_NOTE' &&
      NON_CONSUMING_CREDIT_REASONS.has(dto.reasonCode);

    if (nonConsuming && !requested.isZero()) {
      throw new BadRequestException(
        `El motivo ${dto.reasonCode} no puede modificar el importe`,
      );
    }
    if (type === 'DEBIT_NOTE' && !requested.isPositive()) {
      throw new BadRequestException(
        'Una nota de débito debe aumentar el importe en más de cero',
      );
    }
    if (type === 'CREDIT_NOTE' && !nonConsuming && !requested.isPositive()) {
      throw new BadRequestException(
        'La nota de crédito debe disminuir el importe en más de cero',
      );
    }
    if (type === 'CREDIT_NOTE' && requested.greaterThan(remainingBefore)) {
      throw new ConflictException(
        `El importe solicitado excede el saldo disponible de ${remainingBefore.toFixed(2)} ${source.currency}`,
      );
    }

    const validatedAdjustments = dto.adjustments.map((adjustment) => {
      const sourceLine = source.lines.find(
        (line) => line.lineNumber === adjustment.referenceLineNumber,
      );
      if (!sourceLine) {
        throw new BadRequestException(
          `La línea ${adjustment.referenceLineNumber} no existe en el comprobante original`,
        );
      }
      const priorAdjustments = activeCreditNotes.flatMap((note) =>
        note.noteAdjustments.filter(
          (item) => item.referenceLineNumber === adjustment.referenceLineNumber,
        ),
      );
      const usedAmount = priorAdjustments.reduce(
        (sum, item) => sum.plus(item.amount),
        new Prisma.Decimal(0),
      );
      const usedQuantity = priorAdjustments.reduce(
        (sum, item) => sum.plus(item.quantity ?? 0),
        new Prisma.Decimal(0),
      );
      const remainingAmount = Prisma.Decimal.max(
        new Prisma.Decimal(0),
        sourceLine.totalAmount.minus(usedAmount),
      );
      const remainingQuantity = Prisma.Decimal.max(
        new Prisma.Decimal(0),
        sourceLine.quantity.minus(usedQuantity),
      );
      const amount = new Prisma.Decimal(adjustment.amount);
      const quantity = adjustment.quantity
        ? new Prisma.Decimal(adjustment.quantity)
        : null;

      if (
        type === 'CREDIT_NOTE' &&
        !nonConsuming &&
        amount.greaterThan(remainingAmount)
      ) {
        throw new ConflictException(
          `El importe de la línea ${sourceLine.lineNumber} excede su saldo disponible de ${remainingAmount.toFixed(2)}`,
        );
      }
      if (quantity && quantity.greaterThan(remainingQuantity)) {
        throw new ConflictException(
          `La cantidad de la línea ${sourceLine.lineNumber} excede el saldo disponible de ${remainingQuantity.toFixed()}`,
        );
      }
      if (nonConsuming && quantity) {
        throw new BadRequestException(
          `El motivo ${dto.reasonCode} no puede modificar cantidades`,
        );
      }
      if (dto.reasonCode === '03' && !adjustment.description?.trim()) {
        throw new BadRequestException(
          'La corrección de descripción requiere la nueva descripción de la línea',
        );
      }
      return {
        referenceLineNumber: sourceLine.lineNumber,
        amount: amount.toFixed(2),
        quantity: quantity?.toFixed() ?? null,
        remainingAmountBefore: remainingAmount.toFixed(2),
        remainingQuantityBefore: remainingQuantity.toFixed(),
      };
    });

    if (type === 'CREDIT_NOTE' && FULL_CREDIT_REASONS.has(dto.reasonCode)) {
      if (!requested.equals(remainingBefore)) {
        throw new BadRequestException(
          `El motivo ${dto.reasonCode} requiere afectar todo el saldo disponible`,
        );
      }
      const adjustedLines = new Set(
        dto.adjustments.map((item) => item.referenceLineNumber),
      );
      const pendingLines = source.lines.filter((line) => {
        const used = activeCreditNotes
          .flatMap((note) => note.noteAdjustments)
          .filter((item) => item.referenceLineNumber === line.lineNumber)
          .reduce((sum, item) => sum.plus(item.amount), new Prisma.Decimal(0));
        return line.totalAmount.minus(used).isPositive();
      });
      if (pendingLines.some((line) => !adjustedLines.has(line.lineNumber))) {
        throw new BadRequestException(
          `El motivo ${dto.reasonCode} debe incluir todas las líneas con saldo`,
        );
      }
      const incompleteQuantity = validatedAdjustments.some(
        (adjustment) =>
          adjustment.quantity === null ||
          !new Prisma.Decimal(adjustment.quantity).equals(
            adjustment.remainingQuantityBefore,
          ),
      );
      if (incompleteQuantity) {
        throw new BadRequestException(
          `El motivo ${dto.reasonCode} debe afectar toda la cantidad pendiente de cada línea`,
        );
      }
    }

    return {
      customerVerified: true,
      currencyVerified: true,
      sourceAccepted: true,
      requestedAmount: requested.toFixed(2),
      remainingTotalBefore:
        type === 'CREDIT_NOTE' ? remainingBefore.toFixed(2) : null,
      remainingTotalAfter:
        type === 'CREDIT_NOTE'
          ? (nonConsuming
              ? remainingBefore
              : remainingBefore.minus(requested)
            ).toFixed(2)
          : null,
      adjustments: validatedAdjustments,
    };
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
}

type SourceDocument = Prisma.TaxDocumentGetPayload<{
  include: {
    lines: true;
    referencedBy: {
      include: { document: { include: { noteAdjustments: true } } };
    };
  };
}>;

type CustomerSnapshot = {
  documentType?: string;
  documentNumber?: string | null;
};

type NoteValidation = {
  customerVerified: boolean;
  currencyVerified: boolean;
  sourceAccepted: boolean;
  requestedAmount: string;
  remainingTotalBefore: string | null;
  remainingTotalAfter: string | null;
  adjustments: Array<{
    referenceLineNumber: number;
    amount: string;
    quantity: string | null;
    remainingAmountBefore: string;
    remainingQuantityBefore: string;
  }>;
};

type NoteCreationResponse = {
  id: string;
  externalId: string;
  type: NoteType;
  status: 'QUEUED';
  series: string;
  number: number;
  fullNumber: string;
  environment: string;
  issueDate: string;
  currency: string;
  reference: {
    id: string;
    type: DocumentType;
    series: string;
    number: number;
    fullNumber: string;
  };
  reason: {
    code: string;
    description: string;
    catalogDescription: string;
  };
  validation: NoteValidation;
  calculation: ReturnType<NoteTaxCalculatorService['toResponse']>;
  message: string;
};

function validateIdempotencyKey(value: string) {
  if (!value || value.length < 16 || value.length > 100 || /\s/.test(value)) {
    throw new BadRequestException(
      'Idempotency-Key debe tener entre 16 y 100 caracteres sin espacios',
    );
  }
}

function normalizeIdentity(value?: string | null) {
  return (value ?? '').trim().toUpperCase();
}

function dateOnly(value: string) {
  return new Date(`${value}T00:00:00.000Z`);
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

function isSerializationConflict(error: unknown) {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2034'
  );
}
