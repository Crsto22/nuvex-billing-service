import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { ArtifactIntegrityService } from '../../storage/src/artifact-integrity.service';
import { PrivateObjectStorageService } from '../../storage/src/private-object-storage.service';

export interface ResolvedBrandingLogo {
  body: Buffer;
  version: number;
  width: number;
  height: number;
}

interface BrandingSnapshot {
  version: number;
  logo: {
    objectKey: string;
    contentType: string;
    sizeBytes: number;
    sha256: string;
    width: number;
    height: number;
  };
}

@Injectable()
export class BrandingLogoResolverService {
  constructor(
    private readonly storage: PrivateObjectStorageService,
    private readonly integrity: ArtifactIntegrityService,
  ) {}

  async load(
    value: Prisma.JsonValue | null,
  ): Promise<ResolvedBrandingLogo | undefined> {
    if (value === null) return undefined;
    const snapshot = this.parse(value);
    const body = await this.storage.get(snapshot.logo.objectKey);
    this.integrity.assert(
      body,
      {
        sizeBytes: snapshot.logo.sizeBytes,
        sha256: snapshot.logo.sha256,
      },
      'logo historico de la empresa',
    );
    return {
      body,
      version: snapshot.version,
      width: snapshot.logo.width,
      height: snapshot.logo.height,
    };
  }

  private parse(value: Prisma.JsonValue): BrandingSnapshot {
    if (!isRecord(value) || !isPositiveInteger(value.version)) {
      throw this.invalidSnapshot();
    }
    const logo = value.logo;
    if (
      !isRecord(logo) ||
      typeof logo.objectKey !== 'string' ||
      !logo.objectKey ||
      logo.contentType !== 'image/png' ||
      !isPositiveInteger(logo.sizeBytes) ||
      typeof logo.sha256 !== 'string' ||
      !/^[a-f0-9]{64}$/i.test(logo.sha256) ||
      !isPositiveInteger(logo.width) ||
      !isPositiveInteger(logo.height)
    ) {
      throw this.invalidSnapshot();
    }
    return value as unknown as BrandingSnapshot;
  }

  private invalidSnapshot() {
    return new ServiceUnavailableException(
      'El snapshot historico del logo no es valido',
    );
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}
