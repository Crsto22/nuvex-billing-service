import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { zipSync } from 'fflate';
import { PrismaService } from '../../database/src/prisma.service';
import { SecretCryptoService } from '../../security/src/secret-crypto.service';
import { PrivateObjectStorageService } from '../../storage/src/private-object-storage.service';
import { UblInvoiceBuilderService } from './ubl-invoice-builder.service';
import { XmlSignatureService } from './xml-signature.service';
import { DocumentType } from '@prisma/client';
import { UblNoteBuilderService } from './ubl-note-builder.service';

@Injectable()
export class UblArtifactService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: PrivateObjectStorageService,
    private readonly crypto: SecretCryptoService,
    private readonly builder: UblInvoiceBuilderService,
    private readonly noteBuilder: UblNoteBuilderService,
    private readonly signer: XmlSignatureService,
  ) {}

  async generate(documentId: string) {
    const document = await this.prisma.taxDocument.findUnique({
      where: { id: documentId },
      include: {
        lines: true,
        installments: true,
        artifacts: true,
        references: true,
      },
    });
    if (!document) throw new NotFoundException('Documento no encontrado');
    if (document.submittedAt) {
      const xml = document.artifacts.find((item) => item.type === 'XML');
      const zip = document.artifacts.find((item) => item.type === 'ZIP');
      if (!xml || !zip) {
        throw new ConflictException(
          'Los archivos enviados a SUNAT están incompletos y no pueden regenerarse',
        );
      }
      return { xml, zip, digestValue: document.sunatHash };
    }
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
      !credential.certificateObjectKey ||
      !credential.certificatePasswordEncrypted
    ) {
      throw new ConflictException('No existe un certificado SUNAT activo');
    }

    const unsignedXml = ['CREDIT_NOTE', 'DEBIT_NOTE'].includes(
      document.documentType,
    )
      ? this.noteBuilder.build(document)
      : this.builder.build(document);
    const [pfx, password] = await Promise.all([
      this.storage.get(credential.certificateObjectKey),
      Promise.resolve(
        this.crypto.decrypt(
          credential.certificatePasswordEncrypted,
          `${document.tenantId}:${document.environment}:certificate-password`,
        ),
      ),
    ]);
    const rootLocalName = {
      INVOICE: 'Invoice',
      RECEIPT: 'Invoice',
      CREDIT_NOTE: 'CreditNote',
      DEBIT_NOTE: 'DebitNote',
      DESPATCH_GUIDE: 'DespatchAdvice',
    }[document.documentType];
    const signed = this.signer.sign(unsignedXml, pfx, password, rootLocalName);
    const baseName = this.baseName(
      document.issuerSnapshot as { ruc?: string },
      document.documentType,
      document.series,
      document.number,
    );
    const xmlName = `${baseName}.xml`;
    const zipName = `${baseName}.zip`;
    const zip = Buffer.from(zipSync({ [xmlName]: signed.bytes }, { level: 9 }));
    const date = document.issueDate.toISOString().slice(0, 7).replace('-', '/');
    const prefix = `tenants/${document.tenantId}/${document.environment.toLowerCase()}/documents/${date}/${document.id}`;
    const xmlKey = `${prefix}/${xmlName}`;
    const zipKey = `${prefix}/${zipName}`;

    await Promise.all([
      this.storage.put(xmlKey, signed.bytes, 'application/xml'),
      this.storage.put(zipKey, zip, 'application/zip'),
    ]);
    const artifacts = await this.prisma.$transaction([
      this.prisma.artifact.upsert({
        where: { documentId_type: { documentId, type: 'XML' } },
        create: this.artifact(
          documentId,
          'XML',
          xmlName,
          xmlKey,
          'application/xml',
          signed.bytes,
        ),
        update: this.artifactUpdate(
          xmlName,
          xmlKey,
          'application/xml',
          signed.bytes,
        ),
      }),
      this.prisma.artifact.upsert({
        where: { documentId_type: { documentId, type: 'ZIP' } },
        create: this.artifact(
          documentId,
          'ZIP',
          zipName,
          zipKey,
          'application/zip',
          zip,
        ),
        update: this.artifactUpdate(zipName, zipKey, 'application/zip', zip),
      }),
      this.prisma.taxDocument.update({
        where: { id: documentId },
        data: { sunatHash: signed.digestValue },
      }),
    ]);
    return {
      xml: artifacts[0],
      zip: artifacts[1],
      digestValue: signed.digestValue,
    };
  }

  private artifact(
    documentId: string,
    type: 'XML' | 'ZIP',
    fileName: string,
    objectKey: string,
    contentType: string,
    body: Buffer,
  ) {
    return {
      documentId,
      type,
      ...this.artifactUpdate(fileName, objectKey, contentType, body),
    };
  }

  private artifactUpdate(
    fileName: string,
    objectKey: string,
    contentType: string,
    body: Buffer,
  ) {
    return {
      fileName,
      objectKey,
      contentType,
      sizeBytes: body.length,
      sha256: createHash('sha256').update(body).digest('hex'),
    };
  }

  private baseName(
    issuer: { ruc?: string },
    type: DocumentType,
    series: string,
    number: number,
  ) {
    if (!issuer.ruc) throw new ConflictException('El emisor no tiene RUC');
    const code = {
      INVOICE: '01',
      RECEIPT: '03',
      CREDIT_NOTE: '07',
      DEBIT_NOTE: '08',
      DESPATCH_GUIDE: '31',
    }[type];
    return `${issuer.ruc}-${code}-${series}-${number}`;
  }
}
