import { Prisma } from '@prisma/client';

export type UblDocument = Prisma.TaxDocumentGetPayload<{
  include: { lines: true; installments: true; references: true };
}>;

export interface IssuerSnapshot {
  ruc: string;
  legalName: string;
  tradeName?: string | null;
  address: string;
  ubigeo: string;
  establishmentCode: string;
}

export interface CustomerSnapshot {
  documentType: string;
  documentNumber?: string | null;
  name: string;
  address?: string | null;
}
