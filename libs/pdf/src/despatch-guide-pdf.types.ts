import { Prisma } from '@prisma/client';

export type PdfDespatchGuide = Prisma.DespatchGuideGetPayload<{
  include: {
    recipient: true;
    carrier: true;
    vehicles: true;
    drivers: true;
    items: true;
    artifacts: true;
  };
}>;

export interface PdfDespatchIssuer {
  ruc: string;
  legalName: string;
  tradeName?: string | null;
  address: string;
  ubigeo: string;
  establishmentCode: string;
}
