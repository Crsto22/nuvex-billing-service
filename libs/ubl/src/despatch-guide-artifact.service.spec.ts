import { PrismaService } from '../../database/src/prisma.service';
import { SecretCryptoService } from '../../security/src/secret-crypto.service';
import { PrivateObjectStorageService } from '../../storage/src/private-object-storage.service';
import { DespatchGuideArtifactService } from './despatch-guide-artifact.service';
import { UblDespatchAdviceBuilderService } from './ubl-despatch-advice-builder.service';
import { XmlSignatureService } from './xml-signature.service';

describe('DespatchGuideArtifactService', () => {
  it('regenera artefactos heredados usando el tipo 09 de GRE Remitente', async () => {
    const guide = {
      id: 'guide-id',
      tenantId: 'tenant-id',
      applicationId: 'application-id',
      environment: 'BETA',
      status: 'ACCEPTED',
      series: 'T001',
      number: 4,
      issueDate: new Date('2026-11-02T00:00:00.000Z'),
      submittedAt: new Date('2026-11-02T01:00:00.000Z'),
      sunatHash: 'old-hash',
      issuerSnapshot: { ruc: '20615136663' },
      recipient: {},
      carrier: null,
      vehicles: [],
      drivers: [],
      items: [],
      artifacts: [
        { type: 'XML', fileName: '20615136663-31-T001-4.xml' },
        { type: 'ZIP', fileName: '20615136663-31-T001-4.zip' },
      ],
    };
    const prisma = {
      despatchGuide: {
        findFirst: jest.fn().mockResolvedValue(guide),
        update: jest.fn().mockResolvedValue({}),
      },
      taxCredential: {
        findUnique: jest.fn().mockResolvedValue({
          active: true,
          certificateObjectKey: 'certificate.p12',
          certificatePasswordEncrypted: 'encrypted',
        }),
      },
      despatchGuideArtifact: {
        upsert: jest
          .fn()
          .mockImplementation(({ create, update }: ArtifactUpsertArguments) =>
            Promise.resolve({
              ...(create ?? update),
              fileName: create?.fileName ?? update?.fileName,
            }),
          ),
      },
      $transaction: jest.fn((operations: Promise<unknown>[]) =>
        Promise.all(operations),
      ),
    };
    const storage = {
      get: jest.fn().mockResolvedValue(Buffer.from('pfx')),
      put: jest.fn().mockResolvedValue(undefined),
    };
    const crypto = { decrypt: jest.fn().mockReturnValue('password') };
    const builder = { build: jest.fn().mockReturnValue('<DespatchAdvice/>') };
    const signer = {
      sign: jest.fn().mockReturnValue({
        bytes: Buffer.from('<signed/>'),
        digestValue: 'new-hash',
      }),
    };
    const service = new DespatchGuideArtifactService(
      prisma as unknown as PrismaService,
      storage as unknown as PrivateObjectStorageService,
      crypto as unknown as SecretCryptoService,
      builder as unknown as UblDespatchAdviceBuilderService,
      signer as unknown as XmlSignatureService,
    );

    const result = await service.generate('guide-id', {
      tenantId: 'tenant-id',
      applicationId: 'application-id',
      environment: 'BETA',
    });

    expect(result.xml.fileName).toBe('20615136663-09-T001-4.xml');
    expect(result.zip.fileName).toBe('20615136663-09-T001-4.zip');
    expect(storage.put).toHaveBeenCalledWith(
      expect.stringContaining('/20615136663-09-T001-4.xml'),
      expect.any(Buffer),
      'application/xml',
    );
    expect(signer.sign).toHaveBeenCalledTimes(1);
  });
});

type ArtifactUpsertArguments = {
  create?: { fileName: string };
  update?: { fileName: string };
};
