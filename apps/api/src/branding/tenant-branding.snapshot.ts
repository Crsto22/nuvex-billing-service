import { Prisma, type TenantBranding } from '@prisma/client';

type BrandingForSnapshot = Pick<
  TenantBranding,
  | 'version'
  | 'pdfObjectKey'
  | 'pdfSizeBytes'
  | 'pdfSha256'
  | 'pdfWidth'
  | 'pdfHeight'
>;

export function toTenantBrandingSnapshot(
  branding: BrandingForSnapshot | null | undefined,
): Prisma.InputJsonValue | undefined {
  if (!branding) return undefined;
  return {
    version: branding.version,
    logo: {
      objectKey: branding.pdfObjectKey,
      contentType: 'image/png',
      sizeBytes: branding.pdfSizeBytes,
      sha256: branding.pdfSha256,
      width: branding.pdfWidth,
      height: branding.pdfHeight,
    },
  };
}
