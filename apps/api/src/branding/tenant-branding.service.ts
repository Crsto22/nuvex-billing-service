import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type TenantBranding } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../../../libs/database/src/prisma.service';
import { PrivateObjectStorageService } from '../../../../libs/storage/src/private-object-storage.service';
import type { AdminContext } from '../admin/admin-context';
import {
  LogoImageOptimizerService,
  type OptimizedLogoVariant,
  type OptimizedTenantLogo,
} from './logo-image-optimizer.service';

@Injectable()
export class TenantBrandingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: PrivateObjectStorageService,
    private readonly optimizer: LogoImageOptimizerService,
  ) {}

  async get(tenantId: string) {
    await this.ensureTenant(tenantId);
    const branding = await this.prisma.tenantBranding.findUnique({
      where: { tenantId },
    });
    return this.response(tenantId, branding);
  }

  async uploadLogo(
    tenantId: string,
    file: Express.Multer.File,
    context: AdminContext,
  ) {
    await this.ensureTenant(tenantId);
    const logo = await this.optimizer.optimize(file);
    const prefix = `tenants/${tenantId}/branding/logos/${randomUUID()}`;
    const keys = {
      master: `${prefix}/logo-master.png`,
      pdf: `${prefix}/logo-pdf.png`,
      preview: `${prefix}/logo-preview.webp`,
    };
    const uploaded: string[] = [];

    try {
      await this.put(keys.master, logo.master, uploaded);
      await this.put(keys.pdf, logo.pdf, uploaded);
      await this.put(keys.preview, logo.preview, uploaded);

      const branding = await this.prisma.$transaction(async (tx) => {
        const current = await tx.tenantBranding.findUnique({
          where: { tenantId },
          select: { version: true },
        });
        const data = this.data(logo, keys);
        const stored = await tx.tenantBranding.upsert({
          where: { tenantId },
          create: { tenantId, version: 1, ...data },
          update: { version: (current?.version ?? 0) + 1, ...data },
        });
        await tx.auditEvent.create({
          data: {
            tenantId,
            actorType: 'PLATFORM_ADMIN',
            actorId: 'platform-admin',
            action: 'tenant_branding.logo_uploaded',
            resourceType: 'tenant_branding',
            resourceId: stored.id,
            requestId: context.requestId,
            ip: context.ip,
            data: {
              version: stored.version,
              sourceMimeType: stored.sourceMimeType,
              sourceSizeBytes: stored.sourceSizeBytes,
              pdfSha256: stored.pdfSha256,
            },
          },
        });
        return stored;
      });
      return this.response(tenantId, branding);
    } catch (error) {
      await Promise.allSettled(uploaded.map((key) => this.storage.delete(key)));
      throw error;
    }
  }

  private async put(
    key: string,
    variant: OptimizedLogoVariant,
    uploaded: string[],
  ) {
    await this.storage.put(key, variant.body, variant.contentType);
    uploaded.push(key);
  }

  private data(
    logo: OptimizedTenantLogo,
    keys: { master: string; pdf: string; preview: string },
  ): Prisma.TenantBrandingUncheckedCreateWithoutTenantInput {
    return {
      sourceFileName: logo.source.fileName,
      sourceMimeType: logo.source.contentType,
      sourceSizeBytes: logo.source.sizeBytes,
      sourceWidth: logo.source.width,
      sourceHeight: logo.source.height,
      masterObjectKey: keys.master,
      masterSizeBytes: logo.master.sizeBytes,
      masterSha256: logo.master.sha256,
      masterWidth: logo.master.width,
      masterHeight: logo.master.height,
      pdfObjectKey: keys.pdf,
      pdfSizeBytes: logo.pdf.sizeBytes,
      pdfSha256: logo.pdf.sha256,
      pdfWidth: logo.pdf.width,
      pdfHeight: logo.pdf.height,
      previewObjectKey: keys.preview,
      previewSizeBytes: logo.preview.sizeBytes,
      previewSha256: logo.preview.sha256,
      previewWidth: logo.preview.width,
      previewHeight: logo.preview.height,
      uploadedAt: new Date(),
    };
  }

  private async ensureTenant(tenantId: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true },
    });
    if (!tenant) throw new NotFoundException('Empresa no encontrada');
  }

  private response(tenantId: string, branding: TenantBranding | null) {
    if (!branding) return { tenantId, logoConfigured: false, logo: null };
    return {
      tenantId,
      logoConfigured: true,
      logo: {
        version: branding.version,
        sourceFileName: branding.sourceFileName,
        sourceMimeType: branding.sourceMimeType,
        sourceSizeBytes: branding.sourceSizeBytes,
        sourceWidth: branding.sourceWidth,
        sourceHeight: branding.sourceHeight,
        pdf: {
          mimeType: 'image/png',
          sizeBytes: branding.pdfSizeBytes,
          width: branding.pdfWidth,
          height: branding.pdfHeight,
          sha256: branding.pdfSha256,
        },
        preview: {
          mimeType: 'image/webp',
          sizeBytes: branding.previewSizeBytes,
          width: branding.previewWidth,
          height: branding.previewHeight,
          sha256: branding.previewSha256,
        },
        uploadedAt: branding.uploadedAt,
        updatedAt: branding.updatedAt,
      },
    };
  }
}
