import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  CalculationDto,
  DiscountDto,
  DiscountKind,
  DocumentLineDto,
} from './dto/calculation.dto';
import {
  DEFAULT_IGV_PERCENT,
  ROUNDING_MODE,
  TAX_AFFECTATIONS,
  TAX_ENGINE_VERSION,
  type TaxAffectationCode,
  type TaxCategory,
} from './tax-engine.policy';

const Decimal = Prisma.Decimal;
const ZERO = new Decimal(0);

export type CalculatedLine = {
  input: DocumentLineDto;
  taxCategory: TaxCategory;
  taxRate: Prisma.Decimal;
  unitValue: Prisma.Decimal;
  baseAmount: Prisma.Decimal;
  lineDiscountAmount: Prisma.Decimal;
  globalDiscountAmount: Prisma.Decimal;
  discountAmount: Prisma.Decimal;
  lineValue: Prisma.Decimal;
  taxAmount: Prisma.Decimal;
  totalAmount: Prisma.Decimal;
};

export type Calculation = {
  calculationVersion: string;
  roundingMode: string;
  currency: string;
  taxRate: Prisma.Decimal;
  subtotal: Prisma.Decimal;
  taxable: Prisma.Decimal;
  exempt: Prisma.Decimal;
  unaffected: Prisma.Decimal;
  discount: Prisma.Decimal;
  tax: Prisma.Decimal;
  total: Prisma.Decimal;
  lines: CalculatedLine[];
};

@Injectable()
export class TaxCalculatorService {
  getPolicy() {
    return {
      version: TAX_ENGINE_VERSION,
      defaultIgvPercent: DEFAULT_IGV_PERCENT,
      roundingMode: ROUNDING_MODE,
      monetaryScale: 2,
      unitScale: 10,
      supportedTaxAffectations: Object.entries(TAX_AFFECTATIONS).map(
        ([code, rule]) => ({ code, ...rule }),
      ),
    };
  }

  calculate(dto: CalculationDto): Calculation {
    const taxRate = decimal(dto.taxRate ?? DEFAULT_IGV_PERCENT, 'taxRate');
    if (!taxRate.eq(DEFAULT_IGV_PERCENT)) {
      throw new BadRequestException(
        `taxRate debe ser ${DEFAULT_IGV_PERCENT} para la polÃ­tica ${TAX_ENGINE_VERSION}`,
      );
    }
    const rate = taxRate.div(100);
    const externalIds = new Set<string>();
    const lines = dto.lines.map((input) => {
      if (externalIds.has(input.externalId)) {
        throw new BadRequestException(
          `externalId de lÃ­nea duplicado: ${input.externalId}`,
        );
      }
      externalIds.add(input.externalId);
      return this.calculateLine(input, rate);
    });
    this.applyGlobalDiscount(lines, dto.globalDiscount, rate);
    const result = this.total(dto.currency, taxRate, lines);
    this.assertInvariants(result);
    return result;
  }

  toResponse(calculation: Calculation) {
    return {
      calculationVersion: calculation.calculationVersion,
      roundingMode: calculation.roundingMode,
      currency: calculation.currency,
      taxRate: calculation.taxRate.toFixed(2),
      subtotal: calculation.subtotal.toFixed(2),
      taxable: calculation.taxable.toFixed(2),
      exempt: calculation.exempt.toFixed(2),
      unaffected: calculation.unaffected.toFixed(2),
      discount: calculation.discount.toFixed(2),
      tax: calculation.tax.toFixed(2),
      total: calculation.total.toFixed(2),
      lines: calculation.lines.map((line) => ({
        externalId: line.input.externalId,
        taxAffectationCode: line.input.taxAffectationCode,
        taxCategory: line.taxCategory,
        taxRate: line.taxRate.toFixed(2),
        unitValue: line.unitValue.toFixed(10),
        baseAmount: line.baseAmount.toFixed(2),
        lineDiscount: line.lineDiscountAmount.toFixed(2),
        globalDiscount: line.globalDiscountAmount.toFixed(2),
        discount: line.discountAmount.toFixed(2),
        lineValue: line.lineValue.toFixed(2),
        tax: line.taxAmount.toFixed(2),
        total: line.totalAmount.toFixed(2),
      })),
    };
  }

  assertExpectedTotals(
    expected:
      | {
          taxable: string;
          exempt: string;
          unaffected: string;
          tax: string;
          total: string;
        }
      | null
      | undefined,
    calculation: Calculation,
  ) {
    if (!expected) return;
    const actual = {
      taxable: calculation.taxable,
      exempt: calculation.exempt,
      unaffected: calculation.unaffected,
      tax: calculation.tax,
      total: calculation.total,
    };
    for (const [field, amount] of Object.entries(actual)) {
      if (!amount.eq(expected[field as keyof typeof actual])) {
        throw new BadRequestException(
          `expectedTotals.${field} no coincide con el cÃ¡lculo`,
        );
      }
    }
  }

  private calculateLine(input: DocumentLineDto, rate: Prisma.Decimal) {
    const quantity = decimal(input.quantity, `quantity de ${input.externalId}`);
    const unitPrice = decimal(
      input.unitPrice,
      `unitPrice de ${input.externalId}`,
    );
    if (quantity.lte(0))
      throw new BadRequestException('quantity debe ser mayor que 0');
    if (unitPrice.lt(0))
      throw new BadRequestException('unitPrice no puede ser negativo');
    assertInputRange(quantity, `quantity de ${input.externalId}`);
    assertInputRange(unitPrice, `unitPrice de ${input.externalId}`);
    const affectation =
      TAX_AFFECTATIONS[input.taxAffectationCode as TaxAffectationCode];
    if (!affectation) {
      throw new BadRequestException(
        `Tipo de afectaciÃ³n IGV no soportado: ${input.taxAffectationCode}`,
      );
    }
    if (!affectation.appliesIgv && input.unitPriceIncludesTax) {
      throw new BadRequestException(
        `unitPriceIncludesTax solo aplica a lÃ­neas gravadas: ${input.externalId}`,
      );
    }
    const unitValue = (
      affectation.appliesIgv && input.unitPriceIncludesTax
        ? unitPrice.div(new Decimal(1).plus(rate))
        : unitPrice
    ).toDecimalPlaces(10, Decimal.ROUND_HALF_UP);
    const grossBase = money(unitValue.mul(quantity));
    const lineDiscount = money(
      discountValue(input.discount, grossBase, input.externalId),
    );
    const lineValue = money(grossBase.minus(lineDiscount));
    if (lineValue.lt(0)) {
      throw new BadRequestException(
        `El descuento excede la lÃ­nea ${input.externalId}`,
      );
    }
    const taxAmount = affectation.appliesIgv
      ? money(lineValue.mul(rate))
      : ZERO;
    return {
      input,
      taxCategory: affectation.category,
      taxRate: affectation.appliesIgv ? rate.mul(100) : ZERO,
      unitValue,
      baseAmount: grossBase,
      lineDiscountAmount: lineDiscount,
      globalDiscountAmount: ZERO,
      discountAmount: lineDiscount,
      lineValue,
      taxAmount,
      totalAmount: money(lineValue.plus(taxAmount)),
    };
  }

  private applyGlobalDiscount(
    lines: CalculatedLine[],
    discount: DiscountDto | null | undefined,
    rate: Prisma.Decimal,
  ) {
    if (!discount) return;
    const subtotal = lines.reduce(
      (sum, line) => sum.plus(line.lineValue),
      ZERO,
    );
    const totalDiscount = money(discountValue(discount, subtotal, 'global'));
    if (subtotal.eq(0)) {
      if (totalDiscount.eq(0)) return;
      throw new BadRequestException(
        'No se puede descontar un subtotal de cero',
      );
    }
    if (totalDiscount.gt(subtotal)) {
      throw new BadRequestException('El descuento global excede el subtotal');
    }
    let allocated = ZERO;
    lines.forEach((line, index) => {
      const allocation =
        index === lines.length - 1
          ? totalDiscount.minus(allocated)
          : Prisma.Decimal.min(
              money(totalDiscount.mul(line.lineValue).div(subtotal)),
              totalDiscount.minus(allocated),
              line.lineValue,
            );
      allocated = allocated.plus(allocation);
      line.lineValue = money(line.lineValue.minus(allocation));
      line.globalDiscountAmount = money(allocation);
      line.discountAmount = money(line.discountAmount.plus(allocation));
      line.taxAmount =
        line.taxCategory === 'TAXABLE' ? money(line.lineValue.mul(rate)) : ZERO;
      line.totalAmount = money(line.lineValue.plus(line.taxAmount));
    });
  }

  private total(
    currency: string,
    taxRate: Prisma.Decimal,
    lines: CalculatedLine[],
  ): Calculation {
    const sumFor = (code: string) =>
      money(
        lines
          .filter((line) => line.input.taxAffectationCode === code)
          .reduce((sum, line) => sum.plus(line.lineValue), ZERO),
      );
    const tax = money(
      lines.reduce((sum, line) => sum.plus(line.taxAmount), ZERO),
    );
    const total = money(
      lines.reduce((sum, line) => sum.plus(line.totalAmount), ZERO),
    );
    return {
      calculationVersion: TAX_ENGINE_VERSION,
      roundingMode: ROUNDING_MODE,
      currency,
      taxRate,
      subtotal: money(
        lines.reduce((sum, line) => sum.plus(line.baseAmount), ZERO),
      ),
      taxable: sumFor('10'),
      exempt: sumFor('20'),
      unaffected: sumFor('30'),
      discount: money(
        lines.reduce((sum, line) => sum.plus(line.discountAmount), ZERO),
      ),
      tax,
      total,
      lines,
    };
  }

  private assertInvariants(calculation: Calculation) {
    const net = money(
      calculation.taxable.plus(calculation.exempt).plus(calculation.unaffected),
    );
    const linesNet = money(
      calculation.lines.reduce((sum, line) => sum.plus(line.lineValue), ZERO),
    );
    const linesTotal = money(
      calculation.lines.reduce((sum, line) => sum.plus(line.totalAmount), ZERO),
    );
    if (!net.eq(linesNet) || !net.plus(calculation.tax).eq(calculation.total)) {
      throw new Error('Invariante tributaria inconsistente');
    }
    if (!calculation.subtotal.minus(calculation.discount).eq(net)) {
      throw new Error('La base menos descuentos no coincide con el valor neto');
    }
    if (!linesTotal.eq(calculation.total)) {
      throw new Error('La suma de lÃ­neas no coincide con el total');
    }
    if (calculation.total.gt('9999999999999999.99')) {
      throw new BadRequestException('El total excede DECIMAL(18,2)');
    }
  }
}

function assertInputRange(value: Prisma.Decimal, field: string) {
  if (value.abs().gt('99999999.9999999999')) {
    throw new BadRequestException(
      `${field} excede el mÃ¡ximo de 8 enteros y 10 decimales`,
    );
  }
}

function decimal(value: string, field: string) {
  try {
    return new Decimal(value);
  } catch {
    throw new BadRequestException(`${field} no es un decimal vÃ¡lido`);
  }
}

function money(value: Prisma.Decimal) {
  return value.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}

function discountValue(
  discount: DiscountDto | null | undefined,
  base: Prisma.Decimal,
  field: string,
) {
  if (!discount) return ZERO;
  const value = decimal(discount.value, `descuento ${field}`);
  if (value.lt(0))
    throw new BadRequestException('El descuento no puede ser negativo');
  if (discount.kind === DiscountKind.PERCENTAGE) {
    if (value.gt(100))
      throw new BadRequestException(
        'El descuento porcentual no puede superar 100',
      );
    return base.mul(value).div(100);
  }
  return value;
}
