import { Prisma } from '@prisma/client';
import { NoteTaxCalculatorService } from './note-tax-calculator.service';

describe('NoteTaxCalculatorService', () => {
  const calculator = new NoteTaxCalculatorService();
  const source = [
    {
      lineNumber: 1,
      externalId: 'ITEM-1',
      sku: 'SKU-1',
      description: 'Servicio original',
      unitCode: 'ZZ',
      quantity: new Prisma.Decimal(2),
      taxAffectationCode: '10',
      lineValue: new Prisma.Decimal(100),
      taxAmount: new Prisma.Decimal(18),
      totalAmount: new Prisma.Decimal(118),
    },
  ];

  it('calcula proporcionalmente base e IGV de una disminución', () => {
    const result = calculator.calculate(
      'CREDIT_NOTE',
      '07',
      [{ referenceLineNumber: 1, quantity: '1', amount: '59.00' }],
      source,
    );
    expect(result.taxable.toFixed(2)).toBe('50.00');
    expect(result.tax.toFixed(2)).toBe('9.00');
    expect(result.total.toFixed(2)).toBe('59.00');
    expect(result.lines[0].unitValue.toFixed(10)).toBe('50.0000000000');
  });

  it('calcula un aumento de débito con cantidad de servicio uno', () => {
    const result = calculator.calculate(
      'DEBIT_NOTE',
      '01',
      [{ referenceLineNumber: 1, amount: '23.60' }],
      source,
    );
    expect(result.taxable.toFixed(2)).toBe('20.00');
    expect(result.tax.toFixed(2)).toBe('3.60');
    expect(result.lines[0].quantity.toFixed()).toBe('1');
  });

  it('mantiene en cero una corrección de descripción', () => {
    const result = calculator.calculate(
      'CREDIT_NOTE',
      '03',
      [
        {
          referenceLineNumber: 1,
          amount: '0.00',
          description: 'Descripción corregida',
        },
      ],
      source,
    );
    expect(result.total.toFixed(2)).toBe('0.00');
    expect(result.lines[0].description).toBe('Descripción corregida');
    expect(result.lines[0].quantity.toFixed()).toBe('1');
  });
});
