import { amountInWords } from './amount-in-words';

describe('amountInWords', () => {
  it.each([
    ['0.00', 'PEN', 'SON: CERO Y 00/100 SOLES'],
    ['1.00', 'PEN', 'SON: UN Y 00/100 SOL'],
    ['21.50', 'PEN', 'SON: VEINTIÚN Y 50/100 SOLES'],
    ['305.00', 'PEN', 'SON: TRESCIENTOS CINCO Y 00/100 SOLES'],
    ['1000000.99', 'USD', 'SON: UN MILLÓN Y 99/100 DÓLARES AMERICANOS'],
  ])('convierte %s %s', (value, currency, expected) => {
    expect(amountInWords(value, currency)).toBe(expected);
  });
});
