import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomBytes, randomUUID } from 'node:crypto';
import { PrismaService } from '../../../../libs/database/src/prisma.service';
import { SecretCryptoService } from '../../../../libs/security/src/secret-crypto.service';
import { WebhookUrlPolicyService } from '../../../../libs/webhooks/src/webhook-url-policy.service';
import type { ApplicationPrincipal } from '../auth/auth.types';
import {
  CreateWebhookEndpointDto,
  UpdateWebhookEndpointDto,
} from './dto/webhook-endpoint.dto';

@Injectable()
export class WebhookEndpointsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: SecretCryptoService,
    private readonly urlPolicy: WebhookUrlPolicyService,
  ) {}

  async list(principal: ApplicationPrincipal) {
    const endpoints = await this.prisma.webhookEndpoint.findMany({
      where: {
        applicationId: principal.applicationId,
        environment: principal.environment,
      },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        url: true,
        environment: true,
        eventTypes: true,
        active: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    return endpoints.map((endpoint) => this.response(endpoint));
  }

  async create(dto: CreateWebhookEndpointDto, principal: ApplicationPrincipal) {
    const url = (await this.urlPolicy.assertSafe(dto.url)).toString();
    const id = randomUUID();
    const signingSecret = this.secret();
    const events = [...new Set(dto.events)].sort();
    const endpoint = await this.prisma.$transaction(async (tx) => {
      const created = await tx.webhookEndpoint.create({
        data: {
          id,
          applicationId: principal.applicationId,
          environment: principal.environment,
          url,
          eventTypes: events,
          signingSecretEncrypted: this.crypto.encrypt(
            signingSecret,
            this.context(principal.applicationId, id),
          ),
        },
      });
      await this.audit(tx, principal, id, 'webhook_endpoint.created', {
        url,
        events,
      });
      return created;
    });
    return this.response(endpoint, signingSecret);
  }

  async update(
    id: string,
    dto: UpdateWebhookEndpointDto,
    principal: ApplicationPrincipal,
  ) {
    if (
      dto.url === undefined &&
      dto.events === undefined &&
      dto.active === undefined
    ) {
      throw new BadRequestException(
        'Debe indicar al menos un campo para actualizar',
      );
    }
    await this.find(id, principal.applicationId, principal.environment);
    const url = dto.url
      ? (await this.urlPolicy.assertSafe(dto.url)).toString()
      : undefined;
    const events = dto.events ? [...new Set(dto.events)].sort() : undefined;
    const endpoint = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.webhookEndpoint.update({
        where: { id },
        data: { url, eventTypes: events, active: dto.active },
      });
      await this.audit(tx, principal, id, 'webhook_endpoint.updated', {
        url: url ?? null,
        events: events ?? null,
        active: dto.active ?? null,
      });
      return updated;
    });
    return this.response(endpoint);
  }

  async deactivate(id: string, principal: ApplicationPrincipal) {
    await this.find(id, principal.applicationId, principal.environment);
    const endpoint = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.webhookEndpoint.update({
        where: { id },
        data: { active: false },
      });
      await tx.webhookDelivery.updateMany({
        where: { endpointId: id, status: 'PENDING' },
        data: {
          status: 'DEAD',
          lastError: 'Endpoint desactivado por la aplicación',
        },
      });
      await this.audit(tx, principal, id, 'webhook_endpoint.deactivated');
      return updated;
    });
    return this.response(endpoint);
  }

  async rotateSecret(id: string, principal: ApplicationPrincipal) {
    await this.find(id, principal.applicationId, principal.environment);
    const signingSecret = this.secret();
    const endpoint = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.webhookEndpoint.update({
        where: { id },
        data: {
          signingSecretEncrypted: this.crypto.encrypt(
            signingSecret,
            this.context(principal.applicationId, id),
          ),
        },
      });
      await this.audit(tx, principal, id, 'webhook_endpoint.secret_rotated');
      return updated;
    });
    return this.response(endpoint, signingSecret);
  }

  private async find(
    id: string,
    applicationId: string,
    environment: 'BETA' | 'PRODUCTION',
  ) {
    const endpoint = await this.prisma.webhookEndpoint.findFirst({
      where: { id, applicationId, environment },
    });
    if (!endpoint) throw new NotFoundException('Webhook no encontrado');
    return endpoint;
  }

  private response(
    endpoint: {
      id: string;
      url: string;
      environment: 'BETA' | 'PRODUCTION';
      eventTypes: string[];
      active: boolean;
      createdAt: Date;
      updatedAt: Date;
    },
    signingSecret?: string,
  ) {
    return {
      id: endpoint.id,
      url: endpoint.url,
      environment: endpoint.environment,
      events: endpoint.eventTypes,
      active: endpoint.active,
      createdAt: endpoint.createdAt.toISOString(),
      updatedAt: endpoint.updatedAt.toISOString(),
      ...(signingSecret ? { signingSecret } : {}),
    };
  }

  private secret() {
    return `whsec_${randomBytes(32).toString('base64url')}`;
  }

  private context(applicationId: string, endpointId: string) {
    return `${applicationId}:webhook:${endpointId}`;
  }

  private audit(
    tx: Prisma.TransactionClient,
    principal: ApplicationPrincipal,
    resourceId: string,
    action: string,
    data?: Prisma.InputJsonValue,
  ) {
    return tx.auditEvent.create({
      data: {
        tenantId: principal.tenantId,
        applicationId: principal.applicationId,
        actorType: 'API_KEY',
        actorId: principal.apiKeyId,
        action,
        resourceType: 'webhook_endpoint',
        resourceId,
        data,
      },
    });
  }
}
