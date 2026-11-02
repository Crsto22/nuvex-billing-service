import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ApplicationStatus, Environment } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '../../../../libs/database/src/prisma.service';
import { TokenHashService } from '../../../../libs/security/src/token-hash.service';
import type { AdminContext } from '../admin/admin-context';
import { isUniqueConflict } from '../tenants/tenants.service';
import { CreateApiKeyDto } from './dto/create-api-key.dto';
import { CreateApplicationDto } from './dto/create-application.dto';

@Injectable()
export class ApplicationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokenHash: TokenHashService,
  ) {}

  async list(tenantId: string) {
    await this.assertTenant(tenantId);
    return this.prisma.application.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'asc' },
      include: { _count: { select: { apiKeys: true } } },
    });
  }

  async create(
    tenantId: string,
    dto: CreateApplicationDto,
    context: AdminContext,
  ) {
    const tenant = await this.assertTenant(tenantId);
    if (tenant.status !== 'ACTIVE') {
      throw new BadRequestException('La empresa está suspendida');
    }
    try {
      return await this.prisma.$transaction(async (tx) => {
        const application = await tx.application.create({
          data: { tenantId, name: dto.name.trim(), code: dto.code },
        });
        await tx.auditEvent.create({
          data: {
            tenantId,
            applicationId: application.id,
            actorType: 'PLATFORM_ADMIN',
            actorId: 'platform-admin',
            action: 'application.created',
            resourceType: 'application',
            resourceId: application.id,
            requestId: context.requestId,
            ip: context.ip,
            data: { name: application.name, code: application.code },
          },
        });
        return application;
      });
    } catch (error) {
      if (isUniqueConflict(error)) {
        throw new ConflictException(
          'Ya existe una aplicación con ese código en la empresa',
        );
      }
      throw error;
    }
  }

  async updateStatus(
    id: string,
    status: ApplicationStatus,
    context: AdminContext,
  ) {
    const application = await this.getApplication(id);
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.application.update({
        where: { id },
        data: { status },
      });
      await tx.auditEvent.create({
        data: {
          tenantId: application.tenantId,
          applicationId: id,
          actorType: 'PLATFORM_ADMIN',
          actorId: 'platform-admin',
          action: 'application.status_updated',
          resourceType: 'application',
          resourceId: id,
          requestId: context.requestId,
          ip: context.ip,
          data: { status },
        },
      });
      return updated;
    });
  }

  async listApiKeys(applicationId: string) {
    await this.getApplication(applicationId);
    return this.prisma.apiKey.findMany({
      where: { applicationId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        prefix: true,
        environment: true,
        scopes: true,
        lastUsedAt: true,
        expiresAt: true,
        revokedAt: true,
        createdAt: true,
      },
    });
  }

  async createApiKey(
    applicationId: string,
    dto: CreateApiKeyDto,
    context: AdminContext,
  ) {
    const application = await this.getApplication(applicationId);
    if (
      application.status !== 'ACTIVE' ||
      application.tenant.status !== 'ACTIVE'
    ) {
      throw new BadRequestException('La empresa o aplicación está inactiva');
    }
    const expiresAt = dto.expiresAt ? new Date(dto.expiresAt) : null;
    if (expiresAt && expiresAt <= new Date()) {
      throw new BadRequestException('La expiración debe estar en el futuro');
    }

    const marker = dto.environment === Environment.BETA ? 'test' : 'live';
    const prefix = `nb_${marker}_${randomBytes(8).toString('base64url')}`;
    const apiKey = `${prefix}.${randomBytes(32).toString('base64url')}`;
    const secretHash = this.tokenHash.hash(apiKey);

    const record = await this.prisma.$transaction(async (tx) => {
      const created = await tx.apiKey.create({
        data: {
          applicationId,
          name: dto.name.trim(),
          environment: dto.environment,
          prefix,
          secretHash,
          scopes: [...new Set(dto.scopes)].sort(),
          expiresAt,
        },
      });
      await tx.auditEvent.create({
        data: {
          tenantId: application.tenantId,
          applicationId,
          actorType: 'PLATFORM_ADMIN',
          actorId: 'platform-admin',
          action: 'api_key.created',
          resourceType: 'api_key',
          resourceId: created.id,
          requestId: context.requestId,
          ip: context.ip,
          data: {
            prefix,
            environment: dto.environment,
            scopes: created.scopes,
          },
        },
      });
      return created;
    });

    return {
      id: record.id,
      name: record.name,
      prefix: record.prefix,
      environment: record.environment,
      scopes: record.scopes,
      expiresAt: record.expiresAt,
      createdAt: record.createdAt,
      apiKey,
    };
  }

  async revokeApiKey(id: string, context: AdminContext) {
    const key = await this.prisma.apiKey.findUnique({
      where: { id },
      include: { application: true },
    });
    if (!key) throw new NotFoundException('API key no encontrada');
    if (key.revokedAt) return { id: key.id, revokedAt: key.revokedAt };

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.apiKey.update({
        where: { id },
        data: { revokedAt: new Date() },
      });
      await tx.auditEvent.create({
        data: {
          tenantId: key.application.tenantId,
          applicationId: key.applicationId,
          actorType: 'PLATFORM_ADMIN',
          actorId: 'platform-admin',
          action: 'api_key.revoked',
          resourceType: 'api_key',
          resourceId: id,
          requestId: context.requestId,
          ip: context.ip,
          data: { prefix: key.prefix },
        },
      });
      return { id: updated.id, revokedAt: updated.revokedAt };
    });
  }

  private async assertTenant(id: string) {
    const tenant = await this.prisma.tenant.findUnique({ where: { id } });
    if (!tenant) throw new NotFoundException('Empresa no encontrada');
    return tenant;
  }

  private async getApplication(id: string) {
    const application = await this.prisma.application.findUnique({
      where: { id },
      include: { tenant: true },
    });
    if (!application) throw new NotFoundException('Aplicación no encontrada');
    return application;
  }
}
