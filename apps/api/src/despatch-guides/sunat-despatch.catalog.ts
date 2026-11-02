import { DespatchTransportMode } from '@prisma/client';
import { SUNAT_UBIGEOS } from './sunat-ubigeos.generated';

/** Catálogo SUNAT 20 vigente para GRE remitente. */
export const SUNAT_TRANSFER_REASONS = new Map<string, string>([
  ['01', 'Venta'],
  ['02', 'Compra'],
  ['03', 'Venta con entrega a terceros'],
  ['04', 'Traslado entre establecimientos de la misma empresa'],
  ['05', 'Consignación'],
  ['06', 'Devolución'],
  ['07', 'Recojo de bienes transformados'],
  ['08', 'Importación'],
  ['09', 'Exportación'],
  ['13', 'Otros'],
  ['14', 'Venta sujeta a confirmación del comprador'],
  ['17', 'Traslado de bienes para transformación'],
  ['18', 'Traslado por emisor itinerante de comprobantes de pago'],
  ['19', 'Traslado de mercancía extranjera'],
]);

/** Catálogo SUNAT 18. */
export const SUNAT_TRANSPORT_MODE_CODE: Record<DespatchTransportMode, string> =
  {
    [DespatchTransportMode.PUBLIC]: '01',
    [DespatchTransportMode.PRIVATE]: '02',
  };

/** Catálogo SUNAT 61: documentos admitidos para GRE remitente. */
export const SUNAT_REMITTENT_DOCUMENT_TYPES = new Set([
  '01',
  '03',
  '04',
  '09',
  '12',
  '48',
  '49',
  '50',
  '52',
  '71',
  '72',
  '73',
  '74',
  '75',
  '76',
  '77',
  '78',
  '80',
  '81',
  '91',
  '92',
]);

export function isSunatUbigeo(value: string) {
  return SUNAT_UBIGEOS.has(value);
}

export function isValidRelatedDocumentNumber(
  type: string,
  number: string,
  reason: string,
) {
  const value = number.trim().toUpperCase();
  if (type === '01')
    return /^(?:F[A-Z0-9]{3}|E001|[0-9]{1,4})-[1-9][0-9]{0,7}$/.test(value);
  if (type === '03')
    return /^(?:B[A-Z0-9]{3}|EB01|[0-9]{1,4})-[1-9][0-9]{0,7}$/.test(value);
  if (type === '04')
    return /^(?:L[A-Z0-9]{3}|E001|[0-9]{1,4})-[1-9][0-9]{0,7}$/.test(value);
  if (type === '09')
    return /^(?:T[A-Z0-9]{3}|EG07|EG02)-[1-9][0-9]{0,7}$/.test(value);
  if (type === '12') return /^[A-Z0-9-]{1,20}-[A-Z0-9-]{1,20}$/.test(value);
  if (type === '48') return /^[0-9]{1,4}-[1-9][0-9]{0,6}$/.test(value);
  if (type === '49' || type === '80') return /^[1-9][0-9]{0,14}$/.test(value);
  if (type === '81') return /^[A-Z0-9]{1,20}$/.test(value);
  if (type === '71' || (type >= '72' && type <= '78'))
    return /^[A-Z0-9-]{1,100}$/.test(value);
  if (type === '91')
    return /^01-[0-9]{3}-[0-9]-[0-9]{4}-[1-9][0-9]{0,5}$/.test(value);
  if (type === '92') return /^[0-9]{1,50}$/.test(value);
  if (type === '50' || type === '52') {
    const regimes: Record<string, string> = {
      '08': type === '50' ? '10' : '18',
      '09': type === '50' ? '40' : '48',
      '19': type === '50' ? '(?:10|20|21|30|36|70|80)' : '18',
    };
    const regime = regimes[reason] ?? '[A-Z0-9]{2}';
    return new RegExp(`^[0-9]{3}-[0-9]{4}-${regime}-[1-9][0-9]{0,7}$`).test(
      value,
    );
  }
  return false;
}
