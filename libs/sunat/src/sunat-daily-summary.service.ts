import {
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { zipSync } from 'fflate';
import { Environment, SunatVoidProcedure } from '@prisma/client';
import { PrismaService } from '../../database/src/prisma.service';
import { SecretCryptoService } from '../../security/src/secret-crypto.service';
import { PrivateObjectStorageService } from '../../storage/src/private-object-storage.service';
import { UblDailySummaryBuilderService } from '../../ubl/src/ubl-daily-summary-builder.service';
import { UblVoidedDocumentsBuilderService } from '../../ubl/src/ubl-voided-documents-builder.service';
import { XmlSignatureService } from '../../ubl/src/xml-signature.service';
import { WebhookEventPublisherService } from '../../webhooks/src/webhook-event-publisher.service';
import { SunatCdrParserService } from './sunat-cdr-parser.service';
import { SunatSoapClientService } from './sunat-soap-client.service';

@Injectable()
export class SunatDailySummaryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: PrivateObjectStorageService,
    private readonly crypto: SecretCryptoService,
    private readonly soap: SunatSoapClientService,
    private readonly cdrParser: SunatCdrParserService,
    private readonly builder: UblDailySummaryBuilderService,
    private readonly voidedBuilder: UblVoidedDocumentsBuilderService,
    private readonly signer: XmlSignatureService,
    private readonly webhooks: WebhookEventPublisherService,
  ) {}

  async submitDocument(documentId: string) {
    let summary = await this.summaryFor(documentId);
    const document = summary.items[0]?.document;
    if (!document) throw new ConflictException('El Resumen Diario esta vacio');
    if (summary.status === 'ACCEPTED' || summary.status === 'REJECTED') {
      return this.documentResult(document);
    }
    const credentials = await this.credentials(
      document.tenantId,
      document.environment,
    );
    const issuer = document.issuerSnapshot as { ruc?: string };
    if (!issuer.ruc) throw new ConflictException('El emisor no tiene RUC');
    const username = credentials.solUser.startsWith(issuer.ruc)
      ? credentials.solUser
      : `${issuer.ruc}${credentials.solUser}`;

    if (!summary.ticket) {
      summary = await this.generate(summary.id, credentials);
      const zip = await this.storage.get(summary.zipObjectKey!);
      const sent = await this.soap.sendSummary({
        environment: summary.environment,
        username,
        password: credentials.solPassword,
        fileName: summary.fileName!,
        zip,
      });
      summary = await this.prisma.dailySummary.update({
        where: { id: summary.id },
        data: {
          status: 'SUBMITTED',
          ticket: sent.ticket,
          submittedAt: new Date(),
        },
        include: {
          items: {
            include: { document: { include: { references: true } } },
          },
          tenant: true,
        },
      });
      await this.prisma.taxDocument.updateMany({
        where: { id: documentId, submittedAt: null },
        data: { submittedAt: new Date(), status: 'PROCESSING' },
      });
    }

    const status = await this.soap.getStatus({
      environment: summary.environment,
      username,
      password: credentials.solPassword,
      ticket: summary.ticket!,
    });
    if (status.statusCode === '98' || !status.cdrZip) {
      await this.prisma.dailySummary.update({
        where: { id: summary.id },
        data: { status: 'PROCESSING', sunatCode: status.statusCode },
      });
      throw new SunatSummaryProcessingException();
    }
    return this.persistResult(summary.id, status.cdrZip);
  }

  async generateVoidRequestArtifacts(
    requestId: string,
    scope: {
      tenantId: string;
      applicationId: string;
      environment: Environment;
    },
  ) {
    const request = await this.prisma.sunatVoidRequest.findFirst({
      where: {
        id: requestId,
        tenantId: scope.tenantId,
        applicationId: scope.applicationId,
        environment: scope.environment,
      },
      include: {
        taxDocument: true,
        summaryItem: { include: { summary: true } },
      },
    });
    if (!request) {
      throw new NotFoundException('Solicitud de baja no encontrada');
    }
    if (
      request.procedure === SunatVoidProcedure.GRE_SOL ||
      !request.taxDocument
    ) {
      throw new ConflictException(
        'La solicitud no corresponde a una baja electronica enviada a SUNAT',
      );
    }
    if (!['PENDING', 'FAILED'].includes(request.status)) {
      throw new ConflictException(
        'Los artefactos solo pueden generarse antes del envio a SUNAT',
      );
    }

    const credentials = await this.credentials(
      request.tenantId,
      request.environment,
    );
    let summaryId = request.summaryItem?.summaryId;
    if (!summaryId) {
      let conditionCode: '1' | '3' | '4' = '1';
      if (request.procedure === SunatVoidProcedure.DAILY_SUMMARY) {
        const previouslyReported =
          request.taxDocument.submittedAt !== null ||
          (await this.prisma.dailySummaryItem.findFirst({
            where: {
              documentId: request.taxDocument.id,
              conditionCode: { in: ['1', '2'] },
              summary: {
                status: { in: ['SUBMITTED', 'PROCESSING', 'ACCEPTED'] },
              },
            },
            select: { id: true },
          })) !== null;
        conditionCode = previouslyReported ? '3' : '4';
      }
      summaryId = await this.createVoidSummary(
        request.id,
        request.taxDocument.id,
        request.tenantId,
        request.environment,
        request.referenceDate,
        conditionCode,
      );
    }

    const summary = await this.generate(
      summaryId,
      credentials,
      request.procedure,
    );
    if (!summary.fileName || !summary.xmlObjectKey || !summary.zipObjectKey) {
      throw new ConflictException(
        'No fue posible generar los artefactos del Resumen Diario',
      );
    }
    const expiresIn = this.storage.signedUrlTtlSeconds();
    const xmlName = summary.fileName.replace(/\.zip$/i, '.xml');
    const [xmlUrl, zipUrl] = await Promise.all([
      this.storage.temporaryDownloadUrl(
        summary.xmlObjectKey,
        xmlName,
        expiresIn,
      ),
      this.storage.temporaryDownloadUrl(
        summary.zipObjectKey,
        summary.fileName,
        expiresIn,
      ),
    ]);
    return {
      requestId,
      summaryId: summary.id,
      procedure: request.procedure,
      conditionCode:
        request.procedure === SunatVoidProcedure.DAILY_SUMMARY
          ? summary.items[0]?.conditionCode
          : null,
      signature: 'XMLDSIG-SHA256',
      artifacts: {
        xml: { fileName: xmlName, url: xmlUrl },
        zip: { fileName: summary.fileName, url: zipUrl },
      },
      expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
    };
  }

  async submitVoidRequest(requestId: string) {
    let request = await this.voidRequestForSubmission(requestId);
    if (request.status === 'ACCEPTED' || request.status === 'REJECTED') {
      return this.voidResult(request);
    }
    if (!request.summaryItem) {
      await this.generateVoidRequestArtifacts(request.id, {
        tenantId: request.tenantId,
        applicationId: request.applicationId,
        environment: request.environment,
      });
      request = await this.voidRequestForSubmission(requestId);
    }
    if (!request.summaryItem) {
      throw new ConflictException('La baja no tiene un lote SUNAT asociado');
    }

    const credentials = await this.credentials(
      request.tenantId,
      request.environment,
    );
    let summary = request.summaryItem.summary;
    if (!summary.zipObjectKey || !summary.fileName) {
      summary = await this.generate(summary.id, credentials, request.procedure);
    }
    const issuer = request.taxDocument?.issuerSnapshot as { ruc?: string };
    if (!issuer?.ruc) throw new ConflictException('El emisor no tiene RUC');
    const username = credentials.solUser.startsWith(issuer.ruc)
      ? credentials.solUser
      : `${issuer.ruc}${credentials.solUser}`;

    let ticket = request.ticket ?? summary.ticket;
    if (!ticket) {
      const zip = await this.storage.get(summary.zipObjectKey!);
      const sent = await this.soap.sendSummary({
        environment: request.environment,
        username,
        password: credentials.solPassword,
        fileName: summary.fileName!,
        zip,
      });
      ticket = sent.ticket;
      const submittedAt = new Date();
      await this.prisma.$transaction([
        this.prisma.dailySummary.update({
          where: { id: summary.id },
          data: { status: 'SUBMITTED', ticket, submittedAt },
        }),
        this.prisma.sunatVoidRequest.update({
          where: { id: request.id },
          data: {
            status: 'SUBMITTED',
            ticket,
            submittedAt,
            attempts: { increment: 1 },
          },
        }),
      ]);
    }

    await this.prisma.$transaction([
      this.prisma.dailySummary.update({
        where: { id: summary.id },
        data: { status: 'PROCESSING' },
      }),
      this.prisma.sunatVoidRequest.update({
        where: { id: request.id },
        data: { status: 'PROCESSING' },
      }),
    ]);
    const status = await this.soap.getStatus({
      environment: request.environment,
      username,
      password: credentials.solPassword,
      ticket,
    });
    if (status.statusCode === '98' || !status.cdrZip) {
      await this.prisma.$transaction([
        this.prisma.dailySummary.update({
          where: { id: summary.id },
          data: { status: 'PROCESSING', sunatCode: status.statusCode },
        }),
        this.prisma.sunatVoidRequest.update({
          where: { id: request.id },
          data: { status: 'PROCESSING', sunatCode: status.statusCode },
        }),
      ]);
      throw new SunatSummaryProcessingException();
    }
    return this.persistVoidResult(request.id, summary.id, status.cdrZip);
  }

  async getVoidRequestCdr(
    requestId: string,
    scope: {
      tenantId: string;
      applicationId: string;
      environment: Environment;
    },
  ) {
    const request = await this.prisma.sunatVoidRequest.findFirst({
      where: {
        id: requestId,
        tenantId: scope.tenantId,
        applicationId: scope.applicationId,
        environment: scope.environment,
      },
      include: { summaryItem: { include: { summary: true } } },
    });
    const summary = request?.summaryItem?.summary;
    if (!request)
      throw new NotFoundException('Solicitud de baja no encontrada');
    if (!summary?.cdrObjectKey || !summary.fileName) {
      throw new NotFoundException('El CDR de la baja aun no esta disponible');
    }
    const fileName = `R-${summary.fileName}`;
    const expiresIn = this.storage.signedUrlTtlSeconds();
    const url = await this.storage.temporaryDownloadUrl(
      summary.cdrObjectKey,
      fileName,
      expiresIn,
    );
    return {
      requestId,
      ticket: request.ticket,
      fileName,
      contentType: 'application/zip',
      url,
      expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
    };
  }

  private async voidRequestForSubmission(requestId: string) {
    const request = await this.prisma.sunatVoidRequest.findUnique({
      where: { id: requestId },
      include: {
        taxDocument: true,
        summaryItem: {
          include: {
            summary: {
              include: {
                items: {
                  include: {
                    document: { include: { references: true } },
                  },
                },
                tenant: true,
              },
            },
          },
        },
      },
    });
    if (!request)
      throw new NotFoundException('Solicitud de baja no encontrada');
    if (
      request.procedure === SunatVoidProcedure.GRE_SOL ||
      !request.taxDocument
    ) {
      throw new ConflictException(
        'La solicitud no corresponde a una baja electronica enviada a SUNAT',
      );
    }
    return request;
  }

  private async persistVoidResult(
    requestId: string,
    summaryId: string,
    cdrZip: Buffer,
  ) {
    const request = await this.voidRequestForSubmission(requestId);
    const summary = request.summaryItem?.summary;
    if (!summary || summary.id !== summaryId || !summary.fileName) {
      throw new ConflictException(
        'El Resumen Diario enviado no esta disponible',
      );
    }
    const reference =
      request.procedure === SunatVoidProcedure.VOIDED_DOCUMENTS
        ? this.voidedBuilder.id(summary)
        : this.builder.id(summary);
    const result = this.cdrParser.parse(cdrZip, reference);
    const cdrName = `R-${summary.fileName}`;
    const cdrObjectKey = `${summary.zipObjectKey!.slice(0, summary.zipObjectKey!.lastIndexOf('/') + 1)}${cdrName}`;
    await this.storage.put(cdrObjectKey, cdrZip, 'application/zip');
    const accepted = result.status !== 'REJECTED';
    const respondedAt = new Date();
    await this.prisma.$transaction(async (tx) => {
      await tx.dailySummary.update({
        where: { id: summary.id },
        data: {
          status: accepted ? 'ACCEPTED' : 'REJECTED',
          cdrObjectKey,
          sunatCode: result.code,
          sunatMessage: result.message,
          respondedAt,
        },
      });
      await tx.dailySummaryItem.update({
        where: { id: request.summaryItem!.id },
        data: {
          status: accepted ? 'ACCEPTED' : 'REJECTED',
          sunatCode: result.code,
          sunatMessage: result.message,
        },
      });
      await tx.sunatVoidRequest.update({
        where: { id: request.id },
        data: {
          status: accepted ? 'ACCEPTED' : 'REJECTED',
          sunatCode: result.code,
          sunatMessage: result.message,
          respondedAt,
          completedAt: respondedAt,
        },
      });
      if (accepted && request.taxDocumentId) {
        await tx.taxDocument.update({
          where: { id: request.taxDocumentId },
          data: { status: 'VOIDED' },
        });
      }
      await this.webhooks.publishVoidRequest(
        tx,
        request.id,
        accepted ? 'sunat_void.accepted' : 'sunat_void.rejected',
      );
    });
    return {
      requestId: request.id,
      status: accepted ? 'ACCEPTED' : 'REJECTED',
      ticket: request.ticket,
      code: result.code,
      message: result.message,
      observations: result.observations,
      cdrAvailable: true,
    };
  }

  private voidResult(request: {
    id: string;
    status: string;
    ticket: string | null;
    sunatCode: string | null;
    sunatMessage: string | null;
    summaryItem: { summary: { cdrObjectKey: string | null } } | null;
  }) {
    return {
      requestId: request.id,
      status: request.status,
      ticket: request.ticket,
      code: request.sunatCode,
      message: request.sunatMessage,
      cdrAvailable: Boolean(request.summaryItem?.summary.cdrObjectKey),
    };
  }

  private async createVoidSummary(
    voidRequestId: string,
    documentId: string,
    tenantId: string,
    environment: Environment,
    referenceDate: Date,
    conditionCode: '1' | '3' | '4',
  ) {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.dailySummaryItem.findUnique({
        where: { voidRequestId },
        select: { summaryId: true },
      });
      if (existing) return existing.summaryId;
      const generationDate = dateOnly(new Date());
      const latest = await tx.dailySummary.findFirst({
        where: { tenantId, environment, generationDate },
        orderBy: { sequence: 'desc' },
        select: { sequence: true },
      });
      const summary = await tx.dailySummary.create({
        data: {
          tenantId,
          environment,
          referenceDate,
          generationDate,
          sequence: (latest?.sequence ?? 0) + 1,
          items: {
            create: {
              lineId: 1,
              documentId,
              voidRequestId,
              conditionCode,
            },
          },
        },
        select: { id: true },
      });
      return summary.id;
    });
  }

  private async summaryFor(documentId: string) {
    const existing = await this.prisma.dailySummaryItem.findFirst({
      where: { documentId, conditionCode: '1', voidRequestId: null },
      include: {
        summary: {
          include: {
            items: {
              include: { document: { include: { references: true } } },
            },
            tenant: true,
          },
        },
      },
    });
    if (existing) return existing.summary;

    const document = await this.prisma.taxDocument.findUnique({
      where: { id: documentId },
    });
    if (!document) throw new NotFoundException('Documento no encontrado');
    if (
      document.documentType !== 'RECEIPT' &&
      !(
        ['CREDIT_NOTE', 'DEBIT_NOTE'].includes(document.documentType) &&
        document.series.startsWith('B')
      )
    ) {
      throw new ConflictException(
        'El Resumen Diario solo admite boletas y sus notas',
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const alreadyCreated = await tx.dailySummaryItem.findFirst({
        where: { documentId, conditionCode: '1', voidRequestId: null },
        include: {
          summary: {
            include: {
              items: {
                include: { document: { include: { references: true } } },
              },
              tenant: true,
            },
          },
        },
      });
      if (alreadyCreated) return alreadyCreated.summary;
      const generationDate = dateOnly(new Date());
      const latest = await tx.dailySummary.findFirst({
        where: {
          tenantId: document.tenantId,
          environment: document.environment,
          generationDate,
        },
        orderBy: { sequence: 'desc' },
        select: { sequence: true },
      });
      return tx.dailySummary.create({
        data: {
          tenantId: document.tenantId,
          environment: document.environment,
          referenceDate: document.issueDate,
          generationDate,
          sequence: (latest?.sequence ?? 0) + 1,
          items: {
            create: {
              lineId: 1,
              documentId,
              conditionCode: '1',
            },
          },
        },
        include: {
          items: {
            include: { document: { include: { references: true } } },
          },
          tenant: true,
        },
      });
    });
  }

  private async credentials(tenantId: string, environment: Environment) {
    const credential = await this.prisma.taxCredential.findUnique({
      where: { tenantId_environment: { tenantId, environment } },
    });
    if (
      !credential?.active ||
      !credential.solUsernameEncrypted ||
      !credential.solPasswordEncrypted ||
      !credential.certificateObjectKey ||
      !credential.certificatePasswordEncrypted
    ) {
      throw new ConflictException(
        `No existen credenciales SOL y certificado ${environment} activos`,
      );
    }
    return {
      certificateObjectKey: credential.certificateObjectKey,
      certificatePassword: this.crypto.decrypt(
        credential.certificatePasswordEncrypted,
        `${tenantId}:${environment}:certificate-password`,
      ),
      solUser: this.crypto.decrypt(
        credential.solUsernameEncrypted,
        `${tenantId}:${environment}:sol-username`,
      ),
      solPassword: this.crypto.decrypt(
        credential.solPasswordEncrypted,
        `${tenantId}:${environment}:sol-password`,
      ),
    };
  }

  private async generate(
    summaryId: string,
    credentials: {
      certificateObjectKey: string;
      certificatePassword: string;
    },
    procedure: SunatVoidProcedure = SunatVoidProcedure.DAILY_SUMMARY,
  ) {
    const summary = await this.prisma.dailySummary.findUnique({
      where: { id: summaryId },
      include: {
        items: {
          include: {
            document: { include: { references: true } },
            voidRequest: true,
          },
        },
        tenant: true,
      },
    });
    if (!summary) throw new NotFoundException('Resumen Diario no encontrado');
    if (summary.zipObjectKey && summary.fileName) return summary;
    const isVoidedDocuments = procedure === SunatVoidProcedure.VOIDED_DOCUMENTS;
    const unsigned = isVoidedDocuments
      ? this.voidedBuilder.build(summary)
      : this.builder.build(summary);
    const pfx = await this.storage.get(credentials.certificateObjectKey);
    const signed = this.signer.sign(
      unsigned,
      pfx,
      credentials.certificatePassword,
      isVoidedDocuments ? 'VoidedDocuments' : 'SummaryDocuments',
    );
    const summaryIdValue = isVoidedDocuments
      ? this.voidedBuilder.id(summary)
      : this.builder.id(summary);
    const baseName = `${summary.tenant.ruc}-${summaryIdValue}`;
    const xmlName = `${baseName}.xml`;
    const zipName = `${baseName}.zip`;
    const zip = Buffer.from(zipSync({ [xmlName]: signed.bytes }, { level: 9 }));
    const batchFolder = isVoidedDocuments ? 'voided-documents' : 'summaries';
    const prefix = `tenants/${summary.tenantId}/${summary.environment.toLowerCase()}/${batchFolder}/${summary.generationDate.toISOString().slice(0, 10)}/${summary.id}`;
    const xmlObjectKey = `${prefix}/${xmlName}`;
    const zipObjectKey = `${prefix}/${zipName}`;
    await Promise.all([
      this.storage.put(xmlObjectKey, signed.bytes, 'application/xml'),
      this.storage.put(zipObjectKey, zip, 'application/zip'),
    ]);
    return this.prisma.dailySummary.update({
      where: { id: summary.id },
      data: { fileName: zipName, xmlObjectKey, zipObjectKey },
      include: {
        items: {
          include: {
            document: { include: { references: true } },
            voidRequest: true,
          },
        },
        tenant: true,
      },
    });
  }

  private async persistResult(summaryId: string, cdrZip: Buffer) {
    const summary = await this.prisma.dailySummary.findUnique({
      where: { id: summaryId },
      include: {
        items: { include: { document: { include: { references: true } } } },
        tenant: true,
      },
    });
    if (!summary?.fileName || !summary.zipObjectKey) {
      throw new ConflictException('El Resumen Diario no tiene ZIP enviado');
    }
    const reference = this.builder.id(summary);
    const result = this.cdrParser.parse(cdrZip, reference);
    const cdrName = `R-${summary.fileName}`;
    const cdrObjectKey = `${summary.zipObjectKey.slice(0, summary.zipObjectKey.lastIndexOf('/') + 1)}${cdrName}`;
    await this.storage.put(cdrObjectKey, cdrZip, 'application/zip');
    const finalStatus = result.status === 'REJECTED' ? 'REJECTED' : 'ACCEPTED';
    const documentStatus = result.status;
    const respondedAt = new Date();
    await this.prisma.$transaction(async (tx) => {
      await tx.dailySummary.update({
        where: { id: summary.id },
        data: {
          status: finalStatus,
          cdrObjectKey,
          sunatCode: result.code,
          sunatMessage: result.message,
          respondedAt,
        },
      });
      for (const item of summary.items) {
        await tx.dailySummaryItem.update({
          where: { id: item.id },
          data: {
            status: result.status === 'REJECTED' ? 'REJECTED' : 'ACCEPTED',
            sunatCode: result.code,
            sunatMessage: result.message,
          },
        });
        await tx.artifact.upsert({
          where: {
            documentId_type: { documentId: item.documentId, type: 'CDR' },
          },
          create: {
            documentId: item.documentId,
            type: 'CDR',
            fileName: cdrName,
            objectKey: cdrObjectKey,
            contentType: 'application/zip',
            sizeBytes: cdrZip.length,
            sha256: createHash('sha256').update(cdrZip).digest('hex'),
          },
          update: {
            fileName: cdrName,
            objectKey: cdrObjectKey,
            sizeBytes: cdrZip.length,
            sha256: createHash('sha256').update(cdrZip).digest('hex'),
          },
        });
        await tx.taxDocument.update({
          where: { id: item.documentId },
          data: {
            status: documentStatus,
            sunatCode: result.code,
            sunatMessage: result.message,
            sunatObservations: result.observations,
            respondedAt,
          },
        });
        await this.webhooks.publish(
          tx,
          item.documentId,
          result.status === 'ACCEPTED'
            ? 'document.accepted'
            : result.status === 'ACCEPTED_WITH_OBSERVATIONS'
              ? 'document.accepted_with_observations'
              : 'document.rejected',
        );
      }
    });
    return result;
  }

  private documentResult(document: {
    status: string;
    sunatCode: string | null;
    sunatMessage: string | null;
  }) {
    return {
      status: document.status,
      code: document.sunatCode ?? '',
      message: document.sunatMessage ?? '',
    };
  }
}

export class SunatSummaryProcessingException extends ServiceUnavailableException {
  constructor() {
    super('SUNAT aun esta procesando el ticket del Resumen Diario');
  }
}

function dateOnly(value: Date) {
  return new Date(`${value.toISOString().slice(0, 10)}T00:00:00.000Z`);
}
