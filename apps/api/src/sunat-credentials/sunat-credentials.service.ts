import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Environment, Prisma, TaxCredential } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../../../libs/database/src/prisma.service';
import { SecretCryptoService } from '../../../../libs/security/src/secret-crypto.service';
import type { AdminContext } from '../admin/admin-context';
import { CertificateInspectorService } from './certificate-inspector.service';
import { UpdateSunatCredentialDto } from './dto/update-sunat-credential.dto';
import { PrivateObjectStorageService } from '../../../../libs/storage/src/private-object-storage.service';

const MAX_CERTIFICATE_BYTES = 2 * 1024 * 1024;

@Injectable()
export class SunatCredentialsService {
  private readonly logger = new Logger(SunatCredentialsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: SecretCryptoService,
    private readonly storage: PrivateObjectStorageService,
    private readonly inspector: CertificateInspectorService,
  ) {}

  async list(tenantId: string) {
    await this.ensureTenant(tenantId);
    const records = await this.prisma.taxCredential.findMany({
      where: { tenantId },
      orderBy: { environment: 'asc' },
    });
    const byEnvironment = new Map(
      records.map((record) => [record.environment, record]),
    );
    return Object.values(Environment).map((environment) =>
      this.toResponse(tenantId, environment, byEnvironment.get(environment)),
    );
  }

  async get(tenantId: string, environment: Environment) {
    await this.ensureTenant(tenantId);
    const record = await this.prisma.taxCredential.findUnique({
      where: { tenantId_environment: { tenantId, environment } },
    });
    return this.toResponse(tenantId, environment, record);
  }

  async update(
    tenantId: string,
    environment: Environment,
    dto: UpdateSunatCredentialDto,
    context: AdminContext,
  ) {
    await this.ensureTenant(tenantId);
    if (Object.keys(dto).length === 0) {
      throw new BadRequestException(
        'Debe indicar al menos un campo para actualizar',
      );
    }
    const current = await this.prisma.taxCredential.findUnique({
      where: { tenantId_environment: { tenantId, environment } },
    });
    const data: Prisma.TaxCredentialUncheckedUpdateInput = {};
    if (dto.solUsername !== undefined) {
      data.solUsernameEncrypted = this.encrypt(
        dto.solUsername,
        tenantId,
        environment,
        'sol-username',
      );
    }
    if (dto.solPassword !== undefined) {
      data.solPasswordEncrypted = this.encrypt(
        dto.solPassword,
        tenantId,
        environment,
        'sol-password',
      );
    }
    if (dto.clientId !== undefined) {
      data.clientIdEncrypted = this.encrypt(
        dto.clientId,
        tenantId,
        environment,
        'client-id',
      );
    }
    if (dto.clientSecret !== undefined) {
      data.clientSecretEncrypted = this.encrypt(
        dto.clientSecret,
        tenantId,
        environment,
        'client-secret',
      );
    }
    if (dto.active !== undefined) data.active = dto.active;

    if (dto.active === true) {
      const merged = { ...current, ...data };
      if (
        !merged.solUsernameEncrypted ||
        !merged.solPasswordEncrypted ||
        !merged.certificateObjectKey ||
        !merged.certificatePasswordEncrypted
      ) {
        throw new BadRequestException(
          'Para activar SUNAT debe configurar usuario SOL, clave SOL y certificado',
        );
      }
      const expiresAt = merged.certificateExpiresAt;
      const validFrom = merged.certificateValidFrom;
      if (!expiresAt || expiresAt <= new Date()) {
        throw new BadRequestException('El certificado SUNAT estÃ¡ vencido');
      }
      if (validFrom && validFrom > new Date()) {
        throw new BadRequestException(
          'El certificado SUNAT aÃºn no es vÃ¡lido',
        );
      }
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const record = await tx.taxCredential.upsert({
        where: { tenantId_environment: { tenantId, environment } },
        create: Object.assign({}, data, {
          tenantId,
          environment,
        }) as Prisma.TaxCredentialUncheckedCreateInput,
        update: data,
      });
      await this.audit(
        tx,
        tenantId,
        record.id,
        'sunat_credentials.updated',
        context,
        {
          environment,
          active: record.active,
          changedFields: Object.keys(dto),
        },
      );
      return record;
    });
    return this.toResponse(tenantId, environment, updated);
  }

  async uploadCertificate(
    tenantId: string,
    environment: Environment,
    passwordValue: string,
    file: Express.Multer.File,
    context: AdminContext,
  ) {
    await this.ensureTenant(tenantId);
    this.validateFile(file);
    const password = passwordValue.trim();
    if (!password)
      throw new BadRequestException('La contraseÃ±a es obligatoria');
    const metadata = this.inspector.inspect(file.buffer, password);
    if (metadata.expiresAt <= new Date()) {
      throw new BadRequestException('El certificado SUNAT estÃ¡ vencido');
    }
    const current = await this.prisma.taxCredential.findUnique({
      where: { tenantId_environment: { tenantId, environment } },
      select: { certificateObjectKey: true },
    });
    const extension = file.originalname.toLowerCase().endsWith('.p12')
      ? 'p12'
      : 'pfx';
    const objectKey = `tenants/${tenantId}/${environment.toLowerCase()}/certificates/${randomUUID()}.${extension}`;
    await this.storage.put(
      objectKey,
      file.buffer,
      file.mimetype || 'application/x-pkcs12',
    );

    let updated: TaxCredential;
    try {
      updated = await this.prisma.$transaction(async (tx) => {
        const record = await tx.taxCredential.upsert({
          where: { tenantId_environment: { tenantId, environment } },
          create: {
            tenantId,
            environment,
            certificateObjectKey: objectKey,
            certificatePasswordEncrypted: this.encrypt(
              password,
              tenantId,
              environment,
              'certificate-password',
            ),
            ...this.certificateData(file, metadata),
          },
          update: {
            certificateObjectKey: objectKey,
            certificatePasswordEncrypted: this.encrypt(
              password,
              tenantId,
              environment,
              'certificate-password',
            ),
            ...this.certificateData(file, metadata),
          },
        });
        await this.audit(
          tx,
          tenantId,
          record.id,
          'sunat_certificate.uploaded',
          context,
          { environment, fingerprint: metadata.fingerprint },
        );
        return record;
      });
    } catch (error) {
      await this.storage.delete(objectKey).catch(() => undefined);
      throw error;
    }
    if (current?.certificateObjectKey) {
      await this.storage
        .delete(current.certificateObjectKey)
        .catch((error) =>
          this.logger.warn(
            `No se pudo eliminar el certificado reemplazado: ${String(error)}`,
          ),
        );
    }
    return this.toResponse(tenantId, environment, updated);
  }

  async deleteCertificate(
    tenantId: string,
    environment: Environment,
    context: AdminContext,
  ) {
    const current = await this.prisma.taxCredential.findUnique({
      where: { tenantId_environment: { tenantId, environment } },
    });
    if (!current)
      throw new NotFoundException('Credenciales SUNAT no encontradas');
    const updated = await this.prisma.$transaction(async (tx) => {
      const record = await tx.taxCredential.update({
        where: { id: current.id },
        data: {
          active: false,
          certificateObjectKey: null,
          certificatePasswordEncrypted: null,
          certificateFileName: null,
          certificateMimeType: null,
          certificateSizeBytes: null,
          certificateFingerprint: null,
          certificateSerialNumber: null,
          certificateSubject: null,
          certificateIssuer: null,
          certificateValidFrom: null,
          certificateExpiresAt: null,
          certificateUploadedAt: null,
        },
      });
      await this.audit(
        tx,
        tenantId,
        current.id,
        'sunat_certificate.deleted',
        context,
        {
          environment,
        },
      );
      return record;
    });
    if (current.certificateObjectKey) {
      await this.storage
        .delete(current.certificateObjectKey)
        .catch((error) =>
          this.logger.warn(
            `No se pudo eliminar el certificado privado: ${String(error)}`,
          ),
        );
    }
    return this.toResponse(tenantId, environment, updated);
  }

  private certificateData(
    file: Express.Multer.File,
    metadata: ReturnType<CertificateInspectorService['inspect']>,
  ) {
    return {
      certificateFileName: file.originalname.slice(0, 180),
      certificateMimeType: (file.mimetype || 'application/x-pkcs12').slice(
        0,
        100,
      ),
      certificateSizeBytes: file.size,
      certificateFingerprint: metadata.fingerprint,
      certificateSerialNumber: metadata.serialNumber.slice(0, 128),
      certificateSubject: metadata.subject,
      certificateIssuer: metadata.issuer,
      certificateValidFrom: metadata.validFrom,
      certificateExpiresAt: metadata.expiresAt,
      certificateUploadedAt: new Date(),
    };
  }

  private validateFile(file: Express.Multer.File) {
    if (file.size > MAX_CERTIFICATE_BYTES) {
      throw new BadRequestException('El certificado no debe superar 2 MB');
    }
    if (!/\.(pfx|p12)$/i.test(file.originalname)) {
      throw new BadRequestException(
        'Solo se permiten certificados .pfx o .p12',
      );
    }
  }

  private async ensureTenant(tenantId: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
    });
    if (!tenant) throw new NotFoundException('Empresa no encontrada');
  }

  private encrypt(
    value: string,
    tenantId: string,
    environment: Environment,
    field: string,
  ) {
    return this.crypto.encrypt(
      value.trim(),
      `${tenantId}:${environment}:${field}`,
    );
  }

  private audit(
    tx: Prisma.TransactionClient,
    tenantId: string,
    resourceId: string,
    action: string,
    context: AdminContext,
    data: Prisma.InputJsonValue,
  ) {
    return tx.auditEvent.create({
      data: {
        tenantId,
        actorType: 'PLATFORM_ADMIN',
        actorId: 'platform-admin',
        action,
        resourceType: 'sunat_credential',
        resourceId,
        requestId: context.requestId,
        ip: context.ip,
        data,
      },
    });
  }

  private toResponse(
    tenantId: string,
    environment: Environment,
    record?: TaxCredential | null,
  ) {
    return {
      id: record?.id ?? null,
      tenantId,
      environment,
      active: record?.active ?? false,
      solUsernameConfigured: Boolean(record?.solUsernameEncrypted),
      solPasswordConfigured: Boolean(record?.solPasswordEncrypted),
      clientIdConfigured: Boolean(record?.clientIdEncrypted),
      clientSecretConfigured: Boolean(record?.clientSecretEncrypted),
      certificateConfigured: Boolean(record?.certificateObjectKey),
      certificate: record?.certificateObjectKey
        ? {
            fileName: record.certificateFileName,
            mimeType: record.certificateMimeType,
            sizeBytes: record.certificateSizeBytes,
            fingerprintSha256: record.certificateFingerprint,
            serialNumber: record.certificateSerialNumber,
            subject: record.certificateSubject,
            issuer: record.certificateIssuer,
            validFrom: record.certificateValidFrom,
            expiresAt: record.certificateExpiresAt,
            uploadedAt: record.certificateUploadedAt,
          }
        : null,
      createdAt: record?.createdAt ?? null,
      updatedAt: record?.updatedAt ?? null,
    };
  }
}
