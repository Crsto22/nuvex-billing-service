import { toTenantBrandingSnapshot } from './tenant-branding.snapshot';

describe('toTenantBrandingSnapshot', () => {
  it('fija la version y el objeto PDF privado vigente', () => {
    expect(
      toTenantBrandingSnapshot({
        version: 4,
        pdfObjectKey: 'tenants/t-1/branding/logos/v4/logo-pdf.png',
        pdfSizeBytes: 12345,
        pdfSha256: 'a'.repeat(64),
        pdfWidth: 800,
        pdfHeight: 240,
      }),
    ).toEqual({
      version: 4,
      logo: {
        objectKey: 'tenants/t-1/branding/logos/v4/logo-pdf.png',
        contentType: 'image/png',
        sizeBytes: 12345,
        sha256: 'a'.repeat(64),
        width: 800,
        height: 240,
      },
    });
  });

  it('permite emitir sin logo configurado', () => {
    expect(toTenantBrandingSnapshot(null)).toBeUndefined();
  });
});
