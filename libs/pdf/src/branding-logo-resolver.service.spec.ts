import { ServiceUnavailableException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { ArtifactIntegrityService } from '../../storage/src/artifact-integrity.service';
import { PrivateObjectStorageService } from '../../storage/src/private-object-storage.service';
import { BrandingLogoResolverService } from './branding-logo-resolver.service';

describe('BrandingLogoResolverService', () => {
  const body = Buffer.from('png-logo-bytes');
  const storage = { get: jest.fn().mockResolvedValue(body) };
  const service = new BrandingLogoResolverService(
    storage as unknown as PrivateObjectStorageService,
    new ArtifactIntegrityService(),
  );

  beforeEach(() => jest.clearAllMocks());

  it('carga desde R2 y verifica el logo fijado en el snapshot', async () => {
    await expect(service.load(snapshot())).resolves.toEqual({
      body,
      version: 3,
      width: 800,
      height: 320,
    });
    expect(storage.get).toHaveBeenCalledWith('tenant/logo-v3.png');
  });

  it('no consulta R2 cuando el documento no tiene logo historico', async () => {
    await expect(service.load(null)).resolves.toBeUndefined();
    expect(storage.get).not.toHaveBeenCalled();
  });

  it('rechaza snapshots alterados o incompletos', async () => {
    await expect(
      service.load({ version: 1, logo: { objectKey: 'x' } }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('rechaza bytes de R2 que no coinciden con el hash historico', async () => {
    const value = snapshot();
    await expect(
      service.load({
        ...value,
        logo: { ...value.logo, sha256: '0'.repeat(64) },
      }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});

function snapshot() {
  const body = Buffer.from('png-logo-bytes');
  return {
    version: 3,
    logo: {
      objectKey: 'tenant/logo-v3.png',
      contentType: 'image/png',
      sizeBytes: body.length,
      sha256: createHash('sha256').update(body).digest('hex'),
      width: 800,
      height: 320,
    },
  };
}
