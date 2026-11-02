import { Injectable, NotFoundException } from '@nestjs/common';
import { ArtifactType } from '@prisma/client';
import { PrismaService } from '../../../../libs/database/src/prisma.service';
import { PrivateObjectStorageService } from '../../../../libs/storage/src/private-object-storage.service';
import { ApplicationPrincipal } from '../auth/auth.types';

@Injectable()
export class ArtifactDownloadService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: PrivateObjectStorageService,
  ) {}

  async list(documentId: string, principal: ApplicationPrincipal) {
    const document = await this.prisma.taxDocument.findFirst({
      where: {
        id: documentId,
        applicationId: principal.applicationId,
        environment: principal.environment,
      },
      select: {
        artifacts: {
          orderBy: { createdAt: 'asc' },
          select: {
            type: true,
            fileName: true,
            contentType: true,
            sizeBytes: true,
            sha256: true,
            createdAt: true,
          },
        },
      },
    });
    if (!document) throw new NotFoundException('Documento no encontrado');
    return document.artifacts.map((artifact) => ({
      type: artifact.type,
      fileName: artifact.fileName,
      contentType: artifact.contentType,
      sizeBytes: artifact.sizeBytes,
      sha256: artifact.sha256,
      createdAt: artifact.createdAt.toISOString(),
    }));
  }

  async get(
    documentId: string,
    type: ArtifactType,
    principal: ApplicationPrincipal,
  ) {
    const artifact = await this.prisma.artifact.findFirst({
      where: {
        documentId,
        type,
        document: {
          applicationId: principal.applicationId,
          environment: principal.environment,
        },
      },
    });
    if (!artifact) throw new NotFoundException('Artefacto no encontrado');
    const expiresIn = this.storage.signedUrlTtlSeconds();
    const url = await this.storage.temporaryDownloadUrl(
      artifact.objectKey,
      artifact.fileName,
      expiresIn,
    );
    return {
      type: artifact.type,
      fileName: artifact.fileName,
      contentType: artifact.contentType,
      sizeBytes: artifact.sizeBytes,
      sha256: artifact.sha256,
      createdAt: artifact.createdAt.toISOString(),
      url,
      expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
    };
  }
}
