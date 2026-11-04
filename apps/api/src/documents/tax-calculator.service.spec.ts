import { BadRequestException } from '@nestjs/common';
import { DocumentType } from '@prisma/client';
import { DiscountKind } from './dto/calculation.dto';
import { TaxCalculatorService } from './tax-calculator.service';

describe('TaxCalculatorService', () => {
  const calculator = new TaxCalculatorService();

  it('calculates taxable, exempt and unaffected lines exactly', () => {
    const result = calculator.toResponse(
      calculator.calculate({
        documentType: DocumentType.INVOICE,
        currency: 'PEN',
        taxRate: '18',
        lines: [
          line('taxed', '2', '118', true, '10'),
          line('exempt', '1', '50', false, '20'),
          line('unaffected', '1', '20', false, '30'),
        ],
      }),
    );

    expect(result).toMatchObject({
      calculationVersion: 'PE-SUNAT-UBL21-2026.1',
      roundingMode: 'HALF_UP',
      subtotal: '270.00',
      taxable: '200.00',
      exempt: '50.00',
      unaffected: '20.00',
      tax: '36.00',
      total: '306.00',
    });
    expect(result.lines[0]).toMatchObject({
      taxAffectationCode: '10',
      taxCategory: 'TAXABLE',
      taxRate: '18.00',
      baseAmount: '200.00',
    });
  });

  it('allocates a global discount and recalculates IGV', () => {
    const result = calculator.toResponse(
      calculator.calculate({
        documentType: DocumentType.RECEIPT,
        currency: 'PEN',
        globalDiscount: { kind: DiscountKind.PERCENTAGE, value: '10' },
        lines: [line('one', '1', '100', false, '10')],
      }),
    );

    expect(result).toMatchObject({
      taxable: '90.00',
      discount: '10.00',
      tax: '16.20',
      total: '106.20',
    });
  });

  it('rejects duplicate line identifiers', () => {
    expect(() =>
      calculator.calculate({
        documentType: DocumentType.RECEIPT,
        currency: 'PEN',
        lines: [
          line('duplicate', '1', '10', false, '10'),
          line('duplicate', '1', '10', false, '10'),
        ],
      }),
    ).toThrow(BadRequestException);
  });

  it('rejects a tax rate outside the versioned policy', () => {
    expect(() =>
      calculator.calculate({
        documentType: DocumentType.INVOICE,
        currency: 'PEN',
        taxRate: '17',
        lines: [line('one', '1', '100', false, '10')],
      }),
    ).toThrow('taxRate debe ser 18');
  });

  it('rejects tax-inclusive prices on non-taxable lines', () => {
    expect(() =>
      calculator.calculate({
        documentType: DocumentType.RECEIPT,
        currency: 'PEN',
        lines: [line('exempt', '1', '100', true, '20')],
      }),
    ).toThrow('unitPriceIncludesTax solo aplica');
  });

  it('preserves accounting invariants with fractional prices', () => {
    const value = calculator.calculate({
      documentType: DocumentType.RECEIPT,
      currency: 'PEN',
      lines: [line('fractional', '3', '0.10', true, '10')],
    });

    expect(
      value.subtotal.minus(value.discount).plus(value.tax).eq(value.total),
    ).toBe(true);
    expect(
      value.lines
        .reduce(
          (sum, item) => sum.plus(item.totalAmount),
          value.total.minus(value.total),
        )
        .eq(value.total),
    ).toBe(true);
  });

  it('preserves tax-inclusive line totals after monetary rounding', () => {
    const result = calculator.toResponse(
      calculator.calculate({
        documentType: DocumentType.RECEIPT,
        currency: 'PEN',
        lines: [
          line('shirt', '1', '45.00', true, '10'),
          line('jacket', '1', '50.00', true, '10'),
        ],
      }),
    );

    expect(result).toMatchObject({
      taxable: '80.51',
      tax: '14.49',
      total: '95.00',
    });
    expect(result.lines[0]).toMatchObject({
      lineValue: '38.14',
      tax: '6.86',
      total: '45.00',
    });
  });

  it('validates expected totals inside the tax engine', () => {
    const value = calculator.calculate({
      documentType: DocumentType.RECEIPT,
      currency: 'PEN',
      lines: [line('one', '1', '100', false, '10')],
    });

    expect(() =>
      calculator.assertExpectedTotals(
        {
          taxable: '100.00',
          exempt: '0.00',
          unaffected: '0.00',
          tax: '18.00',
          total: '999.00',
        },
        value,
      ),
    ).toThrow('expectedTotals.total');
  });
});

function line(
  externalId: string,
  quantity: string,
  unitPrice: string,
  unitPriceIncludesTax: boolean,
  taxAffectationCode: string,
) {
  return {
    externalId,
    description: 'Producto',
    quantity,
    unitCode: 'NIU',
    unitPrice,
    unitPriceIncludesTax,
    taxAffectationCode,
  };
}
