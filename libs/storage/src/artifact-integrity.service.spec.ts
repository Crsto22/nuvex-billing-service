import { ServiceUnavailableException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { ArtifactIntegrityService } from './artifact-integrity.service';

describe('ArtifactIntegrityService', () => {
  const service = new ArtifactIntegrityService();
  const body = Buffer.from('signed-document');

  it('acepta bytes que coinciden con tamaño y SHA-256', () => {
    expect(() =>
      service.assert(body, {
        sizeBytes: body.length,
        sha256: createHash('sha256').update(body).digest('hex'),
      }),
    ).not.toThrow();
  });

  it.each([
    { sizeBytes: body.length + 1, sha256: hash(body) },
    { sizeBytes: body.length, sha256: '0'.repeat(64) },
    { sizeBytes: body.length, sha256: 'invalid' },
  ])('rechaza metadatos o bytes corruptos', (expected) => {
    expect(() => service.assert(body, expected)).toThrow(
      ServiceUnavailableException,
    );
  });
});

function hash(body: Buffer) {
  return createHash('sha256').update(body).digest('hex');
}
