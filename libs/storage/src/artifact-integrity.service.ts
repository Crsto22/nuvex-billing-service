import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { createHash, timingSafeEqual } from 'node:crypto';

export interface StoredArtifactIntegrity {
  sizeBytes: number;
  sha256: string;
}

@Injectable()
export class ArtifactIntegrityService {
  assert(
    body: Buffer,
    expected: StoredArtifactIntegrity,
    label = 'archivo tributario',
  ): void {
    const actualHash = createHash('sha256').update(body).digest();
    const validExpectedHash = /^[a-f0-9]{64}$/i.test(expected.sha256);
    const expectedHash = validExpectedHash
      ? Buffer.from(expected.sha256, 'hex')
      : Buffer.alloc(0);
    const hashMatches =
      expectedHash.length === actualHash.length &&
      timingSafeEqual(actualHash, expectedHash);

    if (body.length !== expected.sizeBytes || !hashMatches) {
      throw new ServiceUnavailableException(
        `La integridad del ${label} no pudo ser verificada`,
      );
    }
  }
}
