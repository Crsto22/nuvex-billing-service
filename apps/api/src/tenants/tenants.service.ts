import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, TenantStatus } from '@prisma/client';
import { PrismaService } from '../../../../libs/database/src/prisma.service';
import type { AdminContext } from '../admin/admin-context';
import { CreateTenantDto } from './dto/create-tenant.dto';

@Injectable()
export class TenantsService {
  constructor(private readonly prisma: PrismaService) {}

  list() {
    return this.prisma.tenant.findMany({
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { applications: true } } },
    });
  }

  async get(id: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id },
      include: {
        applications: {
          orderBy: { createdAt: 'asc' },
          include: { _count: { select: { apiKeys: true } } },
        },
      },
    });
    if (!tenant) throw new NotFoundException('Empresa no encontrada');
    return tenant;
  }

  async create(dto: CreateTenantDto, context: AdminContext) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const tenant = await tx.tenant.create({
          data: {
            ruc: dto.ruc,
            legalName: dto.legalName.trim(),
            tradeName: clean(dto.tradeName),
            address: clean(dto.address),
            ubigeo: dto.ubigeo,
          },
        });
        await tx.auditEvent.create({
          data: {
            tenantId: tenant.id,
            actorType: 'PLATFORM_ADMIN',
            actorId: 'platform-admin',
            action: 'tenant.created',
            resourceType: 'tenant',
            resourceId: tenant.id,
            requestId: context.requestId,
            ip: context.ip,
            data: { ruc: tenant.ruc, legalName: tenant.legalName },
          },
        });
        return tenant;
      });
    } catch (error) {
      if (isUniqueConflict(error)) {
        throw new ConflictException('Ya existe una empresa con ese RUC');
      }
      throw error;
    }
  }

  async updateStatus(id: string, status: TenantStatus, context: AdminContext) {
    await this.get(id);
    return this.prisma.$transaction(async (tx) => {
      const tenant = await tx.tenant.update({
        where: { id },
        data: { status },
      });
      await tx.auditEvent.create({
        data: {
          tenantId: id,
          actorType: 'PLATFORM_ADMIN',
          actorId: 'platform-admin',
          action: 'tenant.status_updated',
          resourceType: 'tenant',
          resourceId: id,
          requestId: context.requestId,
          ip: context.ip,
          data: { status },
        },
      });
      return tenant;
    });
  }
}

export function isUniqueConflict(error: unknown) {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  );
}

function clean(value?: string) {
  const result = value?.trim();
  return result || null;
}
