const units = [
  '',
  'UNO',
  'DOS',
  'TRES',
  'CUATRO',
  'CINCO',
  'SEIS',
  'SIETE',
  'OCHO',
  'NUEVE',
];
const special = [
  'DIEZ',
  'ONCE',
  'DOCE',
  'TRECE',
  'CATORCE',
  'QUINCE',
  'DIECISEIS',
  'DIECISIETE',
  'DIECIOCHO',
  'DIECINUEVE',
];
const tens = [
  '',
  '',
  'VEINTE',
  'TREINTA',
  'CUARENTA',
  'CINCUENTA',
  'SESENTA',
  'SETENTA',
  'OCHENTA',
  'NOVENTA',
];
const hundreds = [
  '',
  'CIENTO',
  'DOSCIENTOS',
  'TRESCIENTOS',
  'CUATROCIENTOS',
  'QUINIENTOS',
  'SEISCIENTOS',
  'SETECIENTOS',
  'OCHOCIENTOS',
  'NOVECIENTOS',
];

export function amountInWords(value: string, currency: string): string {
  const [integerText, decimalText = '0'] = value.split('.');
  const integer = Math.max(0, Number.parseInt(integerText || '0', 10));
  const cents = decimalText.padEnd(2, '0').slice(0, 2);
  const currencyName =
    currency === 'PEN'
      ? integer === 1
        ? 'SOL'
        : 'SOLES'
      : currency === 'USD'
        ? integer === 1
          ? 'DÓLAR AMERICANO'
          : 'DÓLARES AMERICANOS'
        : currency;
  return `SON: ${beforeNoun(integerWords(integer))} Y ${cents}/100 ${currencyName}`;
}

function beforeNoun(value: string) {
  if (value === 'UNO') return 'UN';
  return value
    .replace(/VEINTIUNO$/, 'VEINTIÚN')
    .replace(/ Y UNO$/, ' Y UN')
    .replace(/ UNO$/, ' UN');
}

function integerWords(value: number): string {
  if (value === 0) return 'CERO';
  if (value > 999_999_999) return String(value);
  const millions = Math.floor(value / 1_000_000);
  const thousands = Math.floor((value % 1_000_000) / 1_000);
  const remainder = value % 1_000;
  return [
    millions
      ? millions === 1
        ? 'UN MILLÓN'
        : `${underThousand(millions)} MILLONES`
      : '',
    thousands
      ? thousands === 1
        ? 'MIL'
        : `${underThousand(thousands)} MIL`
      : '',
    remainder ? underThousand(remainder) : '',
  ]
    .filter(Boolean)
    .join(' ');
}

function underThousand(value: number): string {
  if (value === 100) return 'CIEN';
  const hundred = Math.floor(value / 100);
  const remainder = value % 100;
  return [hundreds[hundred], underHundred(remainder)].filter(Boolean).join(' ');
}

function underHundred(value: number): string {
  if (value < 10) return units[value] ?? '';
  if (value < 20) return special[value - 10] ?? '';
  if (value < 30)
    return value === 20
      ? 'VEINTE'
      : `VEINTI${(units[value - 20] ?? '').toLowerCase()}`.toUpperCase();
  const ten = Math.floor(value / 10);
  const unit = value % 10;
  return unit ? `${tens[ten]} Y ${units[unit]}` : (tens[ten] ?? '');
}
