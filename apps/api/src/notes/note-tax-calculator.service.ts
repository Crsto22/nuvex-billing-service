import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { TaxNoteAdjustmentDto } from './dto/create-tax-note.dto';

export type NoteCalculationSourceLine = {
  lineNumber: number;
  externalId: string;
  sku: string | null;
  description: string;
  unitCode: string;
  quantity: Prisma.Decimal;
  taxAffectationCode: string;
  lineValue: Prisma.Decimal;
  taxAmount: Prisma.Decimal;
  totalAmount: Prisma.Decimal;
};

export type NoteCalculationLine = {
  lineNumber: number;
  externalId: string;
  sku: string | null;
  description: string;
  unitCode: string;
  quantity: Prisma.Decimal;
  unitPrice: Prisma.Decimal;
  unitPriceIncludesTax: true;
  taxAffectationCode: string;
  unitValue: Prisma.Decimal;
  discountAmount: Prisma.Decimal;
  lineValue: Prisma.Decimal;
  taxAmount: Prisma.Decimal;
  totalAmount: Prisma.Decimal;
};

export type NoteCalculation = {
  calculationVersion: 'NOTE-TAX-v1';
  taxable: Prisma.Decimal;
  exempt: Prisma.Decimal;
  unaffected: Prisma.Decimal;
  discount: Prisma.Decimal;
  tax: Prisma.Decimal;
  total: Prisma.Decimal;
  lines: NoteCalculationLine[];
};

@Injectable()
export class NoteTaxCalculatorService {
  calculate(
    type: 'CREDIT_NOTE' | 'DEBIT_NOTE',
    reasonCode: string,
    adjustments: TaxNoteAdjustmentDto[],
    sourceLines: NoteCalculationSourceLine[],
  ): NoteCalculation {
    const nonFinancialCredit =
      type === 'CREDIT_NOTE' && ['03', '13'].includes(reasonCode);
    const lines = adjustments.map((adjustment, index) => {
      const source = sourceLines.find(
        (line) => line.lineNumber === adjustment.referenceLineNumber,
      );
      if (!source) {
        throw new BadRequestException(
          `La línea ${adjustment.referenceLineNumber} no existe en el comprobante original`,
        );
      }
      const total = new Prisma.Decimal(adjustment.amount).toDecimalPlaces(2);
      const quantity = adjustment.quantity
        ? new Prisma.Decimal(adjustment.quantity)
        : type === 'DEBIT_NOTE' || nonFinancialCredit
          ? new Prisma.Decimal(1)
          : source.quantity;
      if (!quantity.isPositive()) {
        throw new BadRequestException(
          'La cantidad calculada debe ser positiva',
        );
      }

      const lineValue = this.baseAmount(total, source);
      const taxAmount = total.minus(lineValue).toDecimalPlaces(2);
      const unitValue = lineValue.div(quantity).toDecimalPlaces(10);
      const unitPrice = total.div(quantity).toDecimalPlaces(10);
      return {
        lineNumber: index + 1,
        externalId: `NOTE-${source.externalId}`.slice(0, 100),
        sku: source.sku,
        description:
          reasonCode === '03' && adjustment.description?.trim()
            ? adjustment.description.trim()
            : adjustment.description?.trim() || source.description,
        unitCode: source.unitCode,
        quantity,
        unitPrice,
        unitPriceIncludesTax: true as const,
        taxAffectationCode: source.taxAffectationCode,
        unitValue,
        discountAmount: new Prisma.Decimal(0),
        lineValue,
        taxAmount,
        totalAmount: total,
      };
    });

    const sum = (selector: (line: NoteCalculationLine) => Prisma.Decimal) =>
      lines.reduce(
        (total, line) => total.plus(selector(line)),
        new Prisma.Decimal(0),
      );
    return {
      calculationVersion: 'NOTE-TAX-v1',
      taxable: sum((line) =>
        line.taxAffectationCode === '10'
          ? line.lineValue
          : new Prisma.Decimal(0),
      ).toDecimalPlaces(2),
      exempt: sum((line) =>
        line.taxAffectationCode === '20'
          ? line.lineValue
          : new Prisma.Decimal(0),
      ).toDecimalPlaces(2),
      unaffected: sum((line) =>
        line.taxAffectationCode === '30'
          ? line.lineValue
          : new Prisma.Decimal(0),
      ).toDecimalPlaces(2),
      discount: new Prisma.Decimal(0),
      tax: sum((line) => line.taxAmount).toDecimalPlaces(2),
      total: sum((line) => line.totalAmount).toDecimalPlaces(2),
      lines,
    };
  }

  toResponse(calculation: NoteCalculation) {
    return {
      version: calculation.calculationVersion,
      taxable: calculation.taxable.toFixed(2),
      exempt: calculation.exempt.toFixed(2),
      unaffected: calculation.unaffected.toFixed(2),
      tax: calculation.tax.toFixed(2),
      total: calculation.total.toFixed(2),
      lines: calculation.lines.map((line) => ({
        lineNumber: line.lineNumber,
        quantity: line.quantity.toFixed(),
        unitValue: line.unitValue.toFixed(10),
        lineValue: line.lineValue.toFixed(2),
        tax: line.taxAmount.toFixed(2),
        total: line.totalAmount.toFixed(2),
      })),
    };
  }

  private baseAmount(
    requestedTotal: Prisma.Decimal,
    source: NoteCalculationSourceLine,
  ) {
    if (source.taxAffectationCode !== '10' || requestedTotal.isZero()) {
      return requestedTotal.toDecimalPlaces(2);
    }
    if (source.totalAmount.isPositive()) {
      return requestedTotal
        .mul(source.lineValue)
        .div(source.totalAmount)
        .toDecimalPlaces(2);
    }
    return requestedTotal.div('1.18').toDecimalPlaces(2);
  }
}
