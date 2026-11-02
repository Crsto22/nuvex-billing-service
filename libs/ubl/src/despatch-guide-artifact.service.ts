import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Environment } from '@prisma/client';
import { createHash } from 'node:crypto';
import { zipSync } from 'fflate';
import { PrismaService } from '../../database/src/prisma.service';
import { SecretCryptoService } from '../../security/src/secret-crypto.service';
import { PrivateObjectStorageService } from '../../storage/src/private-object-storage.service';
import { UblDespatchAdviceBuilderService } from './ubl-despatch-advice-builder.service';
import { XmlSignatureService } from './xml-signature.service';

export type DespatchGuideArtifactScope = {
  tenantId: string;
  applicationId: string;
  environment: Environment;
};

@Injectable()
export class DespatchGuideArtifactService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: PrivateObjectStorageService,
    private readonly crypto: SecretCryptoService,
    private readonly builder: UblDespatchAdviceBuilderService,
    private readonly signer: XmlSignatureService,
  ) {}

  async generate(guideId: string, scope: DespatchGuideArtifactScope) {
    const guide = await this.prisma.despatchGuide.findFirst({
      where: { id: guideId, ...scope },
      include: {
        recipient: true,
        carrier: true,
        vehicles: true,
        drivers: true,
        items: true,
        artifacts: true,
      },
    });
    if (!guide) throw new NotFoundException('Guía de remisión no encontrada');
    if (['CANCELLED', 'CANCELLATION_REQUESTED'].includes(guide.status)) {
      throw new ConflictException(
        'No se pueden generar archivos para una guía anulada',
      );
    }
    const issuer = guide.issuerSnapshot as { ruc?: string };
    if (!issuer.ruc) throw new ConflictException('El emisor no tiene RUC');

    // SUNAT identifies a GRE Remitente with document type 09 in both the
    // artifact name and the ZIP entry. Type 31 belongs to GRE Transportista.
    const baseName = `${issuer.ruc}-09-${guide.series}-${guide.number}`;
    if (guide.submittedAt) {
      const xml = guide.artifacts.find((artifact) => artifact.type === 'XML');
      const zip = guide.artifacts.find((artifact) => artifact.type === 'ZIP');
      if (!xml || !zip) {
        throw new ConflictException(
          'Los archivos enviados a SUNAT están incompletos y no pueden regenerarse',
        );
      }
      const hasCorrectNames =
        xml.fileName === `${baseName}.xml` &&
        zip.fileName === `${baseName}.zip`;
      if (hasCorrectNames) {
        return { xml, zip, digestValue: guide.sunatHash };
      }
    }

    const credential = await this.prisma.taxCredential.findUnique({
      where: {
        tenantId_environment: {
          tenantId: guide.tenantId,
          environment: guide.environment,
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

    const unsignedXml = this.builder.build(guide);
    const [pfx, password] = await Promise.all([
      this.storage.get(credential.certificateObjectKey),
      Promise.resolve(
        this.crypto.decrypt(
          credential.certificatePasswordEncrypted,
          `${guide.tenantId}:${guide.environment}:certificate-password`,
        ),
      ),
    ]);
    const signed = this.signer.sign(
      unsignedXml,
      pfx,
      password,
      'DespatchAdvice',
    );
    const xmlName = `${baseName}.xml`;
    const zipName = `${baseName}.zip`;
    const zip = Buffer.from(zipSync({ [xmlName]: signed.bytes }, { level: 9 }));
    const date = guide.issueDate.toISOString().slice(0, 7).replace('-', '/');
    const prefix = `tenants/${guide.tenantId}/${guide.environment.toLowerCase()}/despatch-guides/${date}/${guide.id}`;
    const xmlKey = `${prefix}/${xmlName}`;
    const zipKey = `${prefix}/${zipName}`;

    await Promise.all([
      this.storage.put(xmlKey, signed.bytes, 'application/xml'),
      this.storage.put(zipKey, zip, 'application/zip'),
    ]);
    const result = await this.prisma.$transaction([
      this.prisma.despatchGuideArtifact.upsert({
        where: { guideId_type: { guideId, type: 'XML' } },
        create: this.artifact(
          guideId,
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
      this.prisma.despatchGuideArtifact.upsert({
        where: { guideId_type: { guideId, type: 'ZIP' } },
        create: this.artifact(
          guideId,
          'ZIP',
          zipName,
          zipKey,
          'application/zip',
          zip,
        ),
        update: this.artifactUpdate(zipName, zipKey, 'application/zip', zip),
      }),
      this.prisma.despatchGuide.update({
        where: { id: guideId },
        data: { sunatHash: signed.digestValue },
      }),
    ]);

    return {
      xml: result[0],
      zip: result[1],
      digestValue: signed.digestValue,
    };
  }

  private artifact(
    guideId: string,
    type: 'XML' | 'ZIP',
    fileName: string,
    objectKey: string,
    contentType: string,
    body: Buffer,
  ) {
    return {
      guideId,
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
}
