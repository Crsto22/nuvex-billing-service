import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { PrismaService } from '../../database/src/prisma.service';
import { SecretCryptoService } from '../../security/src/secret-crypto.service';
import { ArtifactIntegrityService } from '../../storage/src/artifact-integrity.service';
import { PrivateObjectStorageService } from '../../storage/src/private-object-storage.service';
import { SunatCdrParserService } from './sunat-cdr-parser.service';
import { WebhookEventPublisherService } from '../../webhooks/src/webhook-event-publisher.service';
import {
  SunatSoapClientService,
  SunatSoapFaultException,
} from './sunat-soap-client.service';
import { SunatDailySummaryService } from './sunat-daily-summary.service';

const FINAL_STATUSES = [
  'ACCEPTED',
  'ACCEPTED_WITH_OBSERVATIONS',
  'REJECTED',
] as const;

@Injectable()
export class SunatSubmissionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: PrivateObjectStorageService,
    private readonly integrity: ArtifactIntegrityService,
    private readonly crypto: SecretCryptoService,
    private readonly soap: SunatSoapClientService,
    private readonly cdrParser: SunatCdrParserService,
    private readonly webhooks: WebhookEventPublisherService,
    private readonly dailySummaries: SunatDailySummaryService,
  ) {}

  async submit(documentId: string) {
    const document = await this.prisma.taxDocument.findUnique({
      where: { id: documentId },
      include: { artifacts: true },
    });
    if (!document) throw new NotFoundException('Documento no encontrado');
    if (
      document.documentType === 'RECEIPT' ||
      (['CREDIT_NOTE', 'DEBIT_NOTE'].includes(document.documentType) &&
        document.series.startsWith('B'))
    ) {
      return this.dailySummaries.submitDocument(documentId);
    }
    const existingCdr = document.artifacts.find((item) => item.type === 'CDR');
    if (
      existingCdr &&
      document.respondedAt &&
      FINAL_STATUSES.includes(
        document.status as (typeof FINAL_STATUSES)[number],
      )
    ) {
      return {
        status: document.status,
        code: document.sunatCode ?? '',
        message: document.sunatMessage ?? '',
      };
    }
    const zip = document.artifacts.find((item) => item.type === 'ZIP');
    if (!zip) throw new ConflictException('El documento no tiene ZIP firmado');
    const credential = await this.prisma.taxCredential.findUnique({
      where: {
        tenantId_environment: {
          tenantId: document.tenantId,
          environment: document.environment,
        },
      },
    });
    if (
      !credential?.active ||
      !credential.solUsernameEncrypted ||
      !credential.solPasswordEncrypted
    ) {
      throw new ConflictException(
        `No existen credenciales SOL ${document.environment} activas`,
      );
    }
    const issuer = document.issuerSnapshot as { ruc?: string };
    if (!issuer.ruc) throw new ConflictException('El emisor no tiene RUC');
    const solUser = this.crypto.decrypt(
      credential.solUsernameEncrypted,
      `${document.tenantId}:${document.environment}:sol-username`,
    );
    const solPassword = this.crypto.decrypt(
      credential.solPasswordEncrypted,
      `${document.tenantId}:${document.environment}:sol-password`,
    );
    const username = solUser.startsWith(issuer.ruc)
      ? solUser
      : `${issuer.ruc}${solUser}`;
    const zipBytes = await this.storage.get(zip.objectKey);
    this.integrity.assert(zipBytes, zip, 'ZIP firmado');
    const submittedAt = new Date();
    await this.prisma.taxDocument.updateMany({
      where: { id: documentId, submittedAt: null },
      data: { submittedAt },
    });

    let cdrZip: Buffer;
    try {
      ({ cdrZip } = await this.soap.sendBill({
        environment: document.environment,
        username,
        password: solPassword,
        fileName: zip.fileName,
        zip: zipBytes,
      }));
    } catch (error) {
      if (error instanceof SunatSoapFaultException) {
        await this.prisma.$transaction(async (tx) => {
          await tx.taxDocument.update({
            where: { id: documentId },
            data: {
              status: 'FAILED',
              sunatCode: error.sunatCode.slice(0, 40),
              sunatMessage: error.message.slice(0, 1_000),
              sunatObservations: [],
              respondedAt: new Date(),
            },
          });
          await this.webhooks.publish(tx, documentId, 'document.failed');
        });
      }
      throw error;
    }

    const result = this.cdrParser.parse(
      cdrZip,
      `${document.series}-${document.number}`,
    );
    const cdrName = `R-${zip.fileName}`;
    const cdrKey = `${zip.objectKey.slice(0, zip.objectKey.lastIndexOf('/') + 1)}${cdrName}`;
    await this.storage.put(cdrKey, cdrZip, 'application/zip');
    const respondedAt = new Date();
    await this.prisma.$transaction(async (tx) => {
      await tx.artifact.upsert({
        where: { documentId_type: { documentId, type: 'CDR' } },
        create: {
          documentId,
          type: 'CDR',
          fileName: cdrName,
          objectKey: cdrKey,
          contentType: 'application/zip',
          sizeBytes: cdrZip.length,
          sha256: createHash('sha256').update(cdrZip).digest('hex'),
        },
        update: {
          fileName: cdrName,
          objectKey: cdrKey,
          contentType: 'application/zip',
          sizeBytes: cdrZip.length,
          sha256: createHash('sha256').update(cdrZip).digest('hex'),
        },
      });
      await tx.taxDocument.update({
        where: { id: documentId },
        data: {
          status: result.status,
          sunatCode: result.code,
          sunatMessage: result.message,
          sunatObservations: result.observations,
          respondedAt,
        },
      });
      await tx.auditEvent.create({
        data: {
          tenantId: document.tenantId,
          applicationId: document.applicationId,
          actorType: 'SYSTEM',
          actorId: 'billing-worker',
          action: `sunat.cdr.${result.status.toLowerCase()}`,
          resourceType: 'tax_document',
          resourceId: documentId,
          data: {
            environment: document.environment,
            code: result.code,
            observations: result.observations,
          },
        },
      });
      await this.webhooks.publish(
        tx,
        documentId,
        result.status === 'ACCEPTED'
          ? 'document.accepted'
          : result.status === 'ACCEPTED_WITH_OBSERVATIONS'
            ? 'document.accepted_with_observations'
            : 'document.rejected',
      );
    });
    return result;
  }
}
