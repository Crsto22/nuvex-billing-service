import { Prisma } from '@prisma/client';

export type PdfTaxDocument = Prisma.TaxDocumentGetPayload<{
  include: {
    lines: true;
    installments: true;
    artifacts: true;
    references: true;
  };
}>;

export type PdfFormat = 'A4' | 'TICKET';

export interface PdfIssuer {
  ruc: string;
  legalName: string;
  tradeName?: string | null;
  address: string;
  ubigeo: string;
  establishmentCode: string;
}

export interface PdfCustomer {
  documentType: string;
  documentNumber?: string | null;
  name: string;
  address?: string | null;
}
