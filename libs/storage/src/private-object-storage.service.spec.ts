import { ConfigService } from '@nestjs/config';
import { PrivateObjectStorageService } from './private-object-storage.service';

describe('PrivateObjectStorageService', () => {
  it('uses the normalized signed URL TTL shared with Nuvex', () => {
    const service = new PrivateObjectStorageService(
      new ConfigService({ PRIVATE_STORAGE_SIGNED_URL_TTL_SECONDS: 600 }),
    );

    expect(service.signedUrlTtlSeconds()).toBe(600);
  });

  it('defaults signed URLs to five minutes', () => {
    const service = new PrivateObjectStorageService(new ConfigService({}));

    expect(service.signedUrlTtlSeconds()).toBe(300);
  });
});
