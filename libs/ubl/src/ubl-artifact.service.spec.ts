import { ConflictException } from '@nestjs/common';
import { PrismaService } from '../../database/src/prisma.service';
import { SecretCryptoService } from '../../security/src/secret-crypto.service';
import { PrivateObjectStorageService } from '../../storage/src/private-object-storage.service';
import { UblArtifactService } from './ubl-artifact.service';
import { UblInvoiceBuilderService } from './ubl-invoice-builder.service';
import { XmlSignatureService } from './xml-signature.service';
import { UblNoteBuilderService } from './ubl-note-builder.service';

describe('UblArtifactService', () => {
  it('reutiliza XML y ZIP después del primer envío', async () => {
    const xml = { type: 'XML', fileName: 'document.xml' };
    const zip = { type: 'ZIP', fileName: 'document.zip' };
    const prisma = {
      taxDocument: {
        findUnique: jest.fn().mockResolvedValue({
          submittedAt: new Date(),
          sunatHash: 'digest',
          artifacts: [xml, zip],
        }),
      },
      taxCredential: { findUnique: jest.fn() },
    };
    const storage = { get: jest.fn(), put: jest.fn() };
    const builder = { build: jest.fn() };
    const signer = { sign: jest.fn() };
    const service = new UblArtifactService(
      prisma as unknown as PrismaService,
      storage as unknown as PrivateObjectStorageService,
      {} as SecretCryptoService,
      builder as unknown as UblInvoiceBuilderService,
      {} as UblNoteBuilderService,
      signer as unknown as XmlSignatureService,
    );

    await expect(service.generate('document-1')).resolves.toEqual({
      xml,
      zip,
      digestValue: 'digest',
    });
    expect(prisma.taxCredential.findUnique).not.toHaveBeenCalled();
    expect(builder.build).not.toHaveBeenCalled();
    expect(signer.sign).not.toHaveBeenCalled();
    expect(storage.put).not.toHaveBeenCalled();
  });

  it('no regenera archivos incompletos después del primer envío', async () => {
    const prisma = {
      taxDocument: {
        findUnique: jest.fn().mockResolvedValue({
          submittedAt: new Date(),
          sunatHash: 'digest',
          artifacts: [{ type: 'XML' }],
        }),
      },
    };
    const service = new UblArtifactService(
      prisma as unknown as PrismaService,
      {} as PrivateObjectStorageService,
      {} as SecretCryptoService,
      {} as UblInvoiceBuilderService,
      {} as UblNoteBuilderService,
      {} as XmlSignatureService,
    );

    await expect(service.generate('document-1')).rejects.toBeInstanceOf(
      ConflictException,
    );
  });
});
