export const TAX_ENGINE_VERSION = 'PE-SUNAT-UBL21-2026.1';
export const DEFAULT_IGV_PERCENT = '18';
export const ROUNDING_MODE = 'HALF_UP';

export const TAX_AFFECTATIONS = {
  '10': { category: 'TAXABLE', appliesIgv: true },
  '20': { category: 'EXEMPT', appliesIgv: false },
  '30': { category: 'UNAFFECTED', appliesIgv: false },
} as const;

export type TaxAffectationCode = keyof typeof TAX_AFFECTATIONS;
export type TaxCategory =
  (typeof TAX_AFFECTATIONS)[TaxAffectationCode]['category'];
