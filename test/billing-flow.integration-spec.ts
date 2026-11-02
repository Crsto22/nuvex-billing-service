/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unnecessary-type-assertion, @typescript-eslint/require-await -- El adaptador Prisma en memoria reproduce una API dinamica solo dentro de esta prueba integral. */
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { unzipSync, zipSync } from 'fflate';
import forge from 'node-forge';
import { EmissionJobProcessorService } from '../apps/worker/src/emission-job-processor.service';
import { EmissionJobRepository } from '../apps/worker/src/emission-job.repository';
import { WebhookDeliveryProcessorService } from '../apps/worker/src/webhook-delivery-processor.service';
import { WebhookDeliveryRepository } from '../apps/worker/src/webhook-delivery.repository';
import { PrismaService } from '../libs/database/src/prisma.service';
import { PdfArtifactService } from '../libs/pdf/src/pdf-artifact.service';
import { PdfRendererService } from '../libs/pdf/src/pdf-renderer.service';
import { SunatQrService } from '../libs/pdf/src/sunat-qr.service';
import { SecretCryptoService } from '../libs/security/src/secret-crypto.service';
import { ArtifactIntegrityService } from '../libs/storage/src/artifact-integrity.service';
import { PrivateObjectStorageService } from '../libs/storage/src/private-object-storage.service';
import { SunatCdrParserService } from '../libs/sunat/src/sunat-cdr-parser.service';
import { SunatSoapClientService } from '../libs/sunat/src/sunat-soap-client.service';
import { SunatSubmissionService } from '../libs/sunat/src/sunat-submission.service';
import { SunatDailySummaryService } from '../libs/sunat/src/sunat-daily-summary.service';
import { UblArtifactService } from '../libs/ubl/src/ubl-artifact.service';
import { UblInvoiceBuilderService } from '../libs/ubl/src/ubl-invoice-builder.service';
import { UblNoteBuilderService } from '../libs/ubl/src/ubl-note-builder.service';
import { XmlSignatureService } from '../libs/ubl/src/xml-signature.service';
import { WebhookEventPublisherService } from '../libs/webhooks/src/webhook-event-publisher.service';
import { WebhookHttpClientService } from '../libs/webhooks/src/webhook-http-client.service';
import { WebhookSignatureService } from '../libs/webhooks/src/webhook-signature.service';
import { ClaimedWebhookDelivery } from '../libs/webhooks/src/webhook.types';
import { WebhookUrlPolicyService } from '../libs/webhooks/src/webhook-url-policy.service';

describe('Flujo integral de facturacion', () => {
  it('firma, envia, procesa el CDR, genera PDF y entrega el webhook', async () => {
    const harness = createHarness('0', 'La factura ha sido aceptada');

    await harness.processor.process(harness.job, 'emission-worker-1');

    expect(harness.state.jobStatus).toBe('COMPLETED');
    expect(harness.document.status).toBe('ACCEPTED');
    expect(harness.document.sunatCode).toBe('0');
    expect(harness.soap.sendBill).toHaveBeenCalledTimes(1);
    expect(harness.artifact('XML').body.toString()).toContain('ds:Signature');
    expect(Object.keys(unzipSync(harness.artifact('ZIP').body))).toEqual([
      '20123456789-01-F001-42.xml',
    ]);
    expect(harness.artifact('CDR').body.length).toBeGreaterThan(0);
    expect(harness.artifact('PDF_A4').body.subarray(0, 5).toString()).toBe(
      '%PDF-',
    );
    expect(harness.artifact('PDF_TICKET').body.subarray(0, 5).toString()).toBe(
      '%PDF-',
    );
    expect(harness.state.events).toHaveLength(1);
    expect(harness.state.events[0].eventType).toBe('document.accepted');
    expect(harness.state.deliveries).toHaveLength(1);

    const delivery = harness.claimDelivery();
    await harness.webhookProcessor.process(delivery, 'webhook-worker-1');

    expect(harness.state.deliveries[0].status).toBe('DELIVERED');
    expect(harness.http.post).toHaveBeenCalledTimes(1);
    const [url, headers, body] = harness.http.post.mock.calls[0] as [
      URL,
      Record<string, string>,
      string,
    ];
    expect(url.toString()).toBe('https://hooks.example.com/nuvex');
    expect(headers['x-nuvex-event']).toBe('document.accepted');
    expect(JSON.parse(body)).toEqual(harness.state.events[0].payload);
    expect(
      harness.signatures.verify(
        harness.webhookSecret,
        Number(headers['x-nuvex-timestamp']),
        body,
        headers['x-nuvex-signature'],
      ),
    ).toBe(true);
  }, 20_000);

  it('persiste el rechazo y su webhook sin generar una representacion PDF', async () => {
    const harness = createHarness('2335', 'Documento rechazado');

    await harness.processor.process(harness.job, 'emission-worker-1');

    expect(harness.state.jobStatus).toBe('COMPLETED');
    expect(harness.document.status).toBe('REJECTED');
    expect(harness.document.sunatCode).toBe('2335');
    expect(harness.state.artifacts.map((item) => item.type)).toEqual([
      'XML',
      'ZIP',
      'CDR',
    ]);
    expect(harness.state.events[0].eventType).toBe('document.rejected');
    expect(harness.state.deliveries).toHaveLength(1);
  });

  it.each(['CREDIT_NOTE', 'DEBIT_NOTE'] as const)(
    'firma, envia, procesa el CDR y genera ambos PDF para %s',
    async (documentType) => {
      const harness = createHarness(
        '0',
        'La nota ha sido aceptada',
        documentType,
      );

      await harness.processor.process(harness.job, 'emission-worker-1');

      const code = documentType === 'CREDIT_NOTE' ? '07' : '08';
      const series = documentType === 'CREDIT_NOTE' ? 'FC01' : 'FD01';
      const root = documentType === 'CREDIT_NOTE' ? 'CreditNote' : 'DebitNote';
      expect(harness.state.jobStatus).toBe('COMPLETED');
      expect(harness.document.status).toBe('ACCEPTED');
      expect(harness.soap.sendBill).toHaveBeenCalledTimes(1);
      expect(harness.artifact('XML').body.toString()).toContain(`<${root}`);
      expect(harness.artifact('XML').body.toString()).toContain('ds:Signature');
      expect(Object.keys(unzipSync(harness.artifact('ZIP').body))).toEqual([
        `20123456789-${code}-${series}-7.xml`,
      ]);
      expect(harness.artifact('CDR').body.length).toBeGreaterThan(0);
      expect(harness.artifact('PDF_A4').body.subarray(0, 5).toString()).toBe(
        '%PDF-',
      );
      expect(
        harness.artifact('PDF_TICKET').body.subarray(0, 5).toString(),
      ).toBe('%PDF-');
      expect(harness.state.events).toHaveLength(1);
      expect(harness.state.events[0]).toMatchObject({
        eventType: 'document.accepted',
        payload: {
          type: 'document.accepted',
          data: {
            document: {
              documentType,
              note: {
                referencedDocument: {
                  documentType: 'INVOICE',
                  series: 'F001',
                  number: 42,
                },
              },
            },
          },
        },
      });
    },
    20_000,
  );

  it.each(['CREDIT_NOTE', 'DEBIT_NOTE'] as const)(
    'notifica document.rejected cuando SUNAT rechaza %s',
    async (documentType) => {
      const harness = createHarness(
        '2335',
        'La nota fue rechazada',
        documentType,
      );

      await harness.processor.process(harness.job, 'emission-worker-1');

      expect(harness.document.status).toBe('REJECTED');
      expect(harness.state.events).toHaveLength(1);
      expect(harness.state.events[0]).toMatchObject({
        eventType: 'document.rejected',
        payload: {
          type: 'document.rejected',
          data: {
            document: {
              documentType,
              status: 'REJECTED',
              sunat: { code: '2335' },
            },
          },
        },
      });
      expect(harness.state.artifacts.map((item) => item.type)).toEqual([
        'XML',
        'ZIP',
        'CDR',
      ]);
    },
    20_000,
  );
});

type IntegralDocumentType = 'INVOICE' | 'CREDIT_NOTE' | 'DEBIT_NOTE';

function createHarness(
  cdrCode: string,
  cdrDescription: string,
  documentType: IntegralDocumentType = 'INVOICE',
) {
  const config = testConfig();
  const crypto = new SecretCryptoService(config as ConfigService);
  const signatures = new WebhookSignatureService();
  const webhookSecret = 'whsec_integral_test_secret';
  const certificatePassword = 'certificate-secret';
  const certificate = certificateFixture(certificatePassword);
  const document = documentFixture(documentType);
  const state = {
    artifacts: [] as StoredArtifact[],
    objects: new Map<string, Buffer>(),
    events: [] as Array<Record<string, any>>,
    deliveries: [] as Array<Record<string, any>>,
    jobStatus: 'PROCESSING',
  };
  const endpoint = {
    id: 'endpoint-1',
    applicationId: document.applicationId,
    environment: 'BETA',
    url: 'https://hooks.example.com/nuvex',
    eventTypes: ['document.accepted', 'document.rejected'],
    signingSecretEncrypted: crypto.encrypt(
      webhookSecret,
      `${document.applicationId}:webhook:endpoint-1`,
    ),
    active: true,
  };
  const credential = {
    active: true,
    certificateObjectKey: 'credentials/test-certificate.pfx',
    certificatePasswordEncrypted: crypto.encrypt(
      certificatePassword,
      `${document.tenantId}:BETA:certificate-password`,
    ),
    solUsernameEncrypted: crypto.encrypt(
      'MODDATOS',
      `${document.tenantId}:BETA:sol-username`,
    ),
    solPasswordEncrypted: crypto.encrypt(
      'sol-secret',
      `${document.tenantId}:BETA:sol-password`,
    ),
  };
  state.objects.set(credential.certificateObjectKey, certificate);

  const prisma = inMemoryPrisma(document, credential, endpoint, state);
  const storage = {
    get: jest.fn(async (key: string) => {
      const body = state.objects.get(key);
      if (!body) throw new Error(`Objeto inexistente: ${key}`);
      return Buffer.from(body);
    }),
    put: jest.fn(async (key: string, body: Buffer) => {
      state.objects.set(key, Buffer.from(body));
    }),
  };
  const soap = {
    sendBill: jest.fn(async () => ({
      cdrZip: cdr(cdrCode, cdrDescription, document),
    })),
  };
  const eventPublisher = new WebhookEventPublisherService();
  const artifacts = new UblArtifactService(
    prisma as unknown as PrismaService,
    storage as unknown as PrivateObjectStorageService,
    crypto,
    new UblInvoiceBuilderService(),
    new UblNoteBuilderService(),
    new XmlSignatureService(),
  );
  const sunat = new SunatSubmissionService(
    prisma as unknown as PrismaService,
    storage as unknown as PrivateObjectStorageService,
    new ArtifactIntegrityService(),
    crypto,
    soap as unknown as SunatSoapClientService,
    new SunatCdrParserService(config as ConfigService),
    eventPublisher,
    {} as SunatDailySummaryService,
  );
  const pdf = new PdfArtifactService(
    prisma as unknown as PrismaService,
    storage as unknown as PrivateObjectStorageService,
    new PdfRendererService(new SunatQrService()),
  );
  const repository = {
    complete: jest.fn(async () => {
      state.jobStatus = 'COMPLETED';
    }),
    fail: jest.fn(async () => {
      state.jobStatus = 'DEAD';
      return true;
    }),
    heartbeat: jest.fn(async () => true),
  };
  const processor = new EmissionJobProcessorService(
    config as ConfigService,
    repository as unknown as EmissionJobRepository,
    artifacts,
    sunat,
    pdf,
  );
  const webhookRepository = {
    delivered: jest.fn(async (delivery: ClaimedWebhookDelivery) => {
      const stored = state.deliveries.find((item) => item.id === delivery.id);
      if (stored) stored.status = 'DELIVERED';
      return true;
    }),
    failed: jest.fn(async () => ({ dead: false, owned: true })),
  };
  const http = { post: jest.fn(async () => 204) };
  const urlPolicy = {
    assertSafe: jest.fn(async (url: string) => new URL(url)),
  };
  const webhookProcessor = new WebhookDeliveryProcessorService(
    config as ConfigService,
    webhookRepository as unknown as WebhookDeliveryRepository,
    crypto,
    signatures,
    urlPolicy as unknown as WebhookUrlPolicyService,
    http as unknown as WebhookHttpClientService,
  );
  const job = {
    id: 'job-1',
    documentId: document.id,
    operation: 'ISSUE' as const,
    attempts: 1,
    maxAttempts: 10,
  };

  return {
    document,
    state,
    soap,
    http,
    signatures,
    webhookSecret,
    processor,
    webhookProcessor,
    job,
    artifact(type: string) {
      const metadata = state.artifacts.find((item) => item.type === type);
      if (!metadata) throw new Error(`Artefacto ${type} no encontrado`);
      const body = state.objects.get(metadata.objectKey);
      if (!body) throw new Error(`Contenido ${type} no encontrado`);
      return { ...metadata, body };
    },
    claimDelivery(): ClaimedWebhookDelivery {
      const stored = state.deliveries[0];
      const event = state.events.find((item) => item.id === stored.eventId)!;
      stored.status = 'PROCESSING';
      stored.attempts += 1;
      return {
        id: stored.id,
        eventId: event.id,
        endpointId: endpoint.id,
        applicationId: endpoint.applicationId,
        url: endpoint.url,
        signingSecretEncrypted: endpoint.signingSecretEncrypted,
        eventType: event.eventType,
        payload: event.payload,
        attempts: stored.attempts,
        maxAttempts: stored.maxAttempts,
      } as ClaimedWebhookDelivery;
    },
  };
}

type StoredArtifact = {
  id: string;
  documentId: string;
  type: string;
  fileName: string;
  objectKey: string;
  contentType: string;
  sizeBytes: number;
  sha256: string;
  createdAt: Date;
};

function inMemoryPrisma(
  document: Record<string, any>,
  credential: Record<string, any>,
  endpoint: Record<string, any>,
  state: {
    artifacts: StoredArtifact[];
    events: Array<Record<string, any>>;
    deliveries: Array<Record<string, any>>;
  },
) {
  const withArtifacts = () => ({ ...document, artifacts: state.artifacts });
  const artifact = {
    upsert: jest.fn(async ({ create, update }: Record<string, any>) => {
      const current = state.artifacts.find(
        (item) =>
          item.documentId === create.documentId && item.type === create.type,
      );
      if (current) {
        Object.assign(current, update);
        return current;
      }
      const stored = {
        id: `artifact-${state.artifacts.length + 1}`,
        createdAt: new Date(),
        ...create,
      } as StoredArtifact;
      state.artifacts.push(stored);
      return stored;
    }),
  };
  const taxDocument = {
    findUnique: jest.fn(async () => withArtifacts()),
    updateMany: jest.fn(async ({ data }: Record<string, any>) => {
      Object.assign(document, data, { updatedAt: new Date() });
      return { count: 1 };
    }),
    update: jest.fn(async ({ data }: Record<string, any>) => {
      Object.assign(document, data, { updatedAt: new Date() });
      return withArtifacts();
    }),
  };
  const prisma: Record<string, any> = {
    taxDocument,
    taxCredential: { findUnique: jest.fn(async () => credential) },
    artifact,
    auditEvent: { create: jest.fn(async ({ data }) => data) },
    webhookEvent: {
      create: jest.fn(async ({ data }) => {
        state.events.push(data);
        return data;
      }),
    },
    webhookEndpoint: {
      findMany: jest.fn(async ({ where }) =>
        endpoint.active &&
        endpoint.applicationId === where.applicationId &&
        endpoint.environment === where.environment &&
        endpoint.eventTypes.includes(where.eventTypes.has)
          ? [{ id: endpoint.id }]
          : [],
      ),
    },
    webhookDelivery: {
      createMany: jest.fn(async ({ data }) => {
        for (const item of data) {
          state.deliveries.push({
            id: `delivery-${state.deliveries.length + 1}`,
            status: 'PENDING',
            attempts: 0,
            maxAttempts: 10,
            ...item,
          });
        }
        return { count: data.length };
      }),
    },
  };
  prisma.$transaction = jest.fn(async (input: unknown) =>
    typeof input === 'function'
      ? (input as (tx: typeof prisma) => unknown)(prisma)
      : Promise.all(input as Promise<unknown>[]),
  );
  return prisma;
}

function documentFixture(documentType: IntegralDocumentType = 'INVOICE') {
  const decimal = (value: string) => new Prisma.Decimal(value);
  const isCredit = documentType === 'CREDIT_NOTE';
  const isDebit = documentType === 'DEBIT_NOTE';
  const isNote = isCredit || isDebit;
  return {
    id: 'document-1',
    tenantId: 'tenant-1',
    applicationId: 'application-1',
    externalId: isNote ? `NOTE-${isCredit ? 'C' : 'D'}-1001` : 'ORDER-1001',
    environment: 'BETA',
    documentType,
    status: 'PROCESSING',
    series: isCredit ? 'FC01' : isDebit ? 'FD01' : 'F001',
    number: isNote ? 7 : 42,
    issueDate: new Date('2026-11-01T00:00:00.000Z'),
    issueTime: '10:30:00',
    currency: 'PEN',
    paymentMethod: 'CASH',
    issuerSnapshot: {
      ruc: '20123456789',
      legalName: 'EMPRESA DEMO SAC',
      tradeName: 'NUVEX DEMO',
      address: 'AV. DEMO 123, LIMA',
      ubigeo: '150101',
      establishmentCode: '0000',
    },
    customerSnapshot: {
      documentType: 'RUC',
      documentNumber: '20987654321',
      name: 'CLIENTE EMPRESA SAC',
      address: 'JR. CLIENTE 456, LIMA',
    },
    taxableAmount: decimal('100'),
    exemptAmount: decimal('0'),
    unaffectedAmount: decimal('0'),
    discountAmount: decimal('0'),
    taxAmount: decimal('18'),
    totalAmount: decimal('118'),
    submittedAt: null,
    respondedAt: null,
    sunatCode: null,
    sunatMessage: null,
    sunatObservations: [],
    sunatHash: null,
    reasonCode: isCredit ? '07' : isDebit ? '02' : null,
    reasonDescription: isNote ? 'Ajuste del comprobante original' : null,
    updatedAt: new Date('2026-11-01T10:30:00.000Z'),
    installments: [],
    references: isNote
      ? [
          {
            id: 'reference-1',
            documentId: 'document-1',
            referencedDocumentId: 'original-document-1',
            referencedType: 'INVOICE',
            referencedSeries: 'F001',
            referencedNumber: 42,
            createdAt: new Date('2026-11-01T10:30:00.000Z'),
          },
        ]
      : [],
    lines: [
      {
        lineNumber: 1,
        externalId: 'ITEM-1',
        sku: 'SKU-1',
        description: 'Servicio profesional de implementacion',
        unitCode: 'ZZ',
        quantity: decimal('1'),
        unitPrice: decimal('118'),
        unitPriceIncludesTax: true,
        taxAffectationCode: '10',
        unitValue: decimal('100'),
        discountAmount: decimal('0'),
        lineValue: decimal('100'),
        taxAmount: decimal('18'),
        totalAmount: decimal('118'),
      },
    ],
  };
}

function testConfig() {
  const values: Record<string, unknown> = {
    SECRETS_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
    SUNAT_MAX_RESPONSE_BYTES: 10_485_760,
    WORKER_LOCK_TIMEOUT_MS: 120_000,
    WORKER_RETRY_BASE_MS: 5_000,
    WORKER_RETRY_MAX_MS: 900_000,
    WEBHOOK_TIMEOUT_MS: 10_000,
    WEBHOOK_RETRY_BASE_MS: 10_000,
    WEBHOOK_RETRY_MAX_MS: 900_000,
  };
  return { getOrThrow: jest.fn((key: string) => values[key]) };
}

function certificateFixture(password: string) {
  const keys = forge.pki.rsa.generateKeyPair(1024);
  const certificate = forge.pki.createCertificate();
  certificate.publicKey = keys.publicKey;
  certificate.serialNumber = '01';
  certificate.validity.notBefore = new Date('2025-01-01T00:00:00Z');
  certificate.validity.notAfter = new Date('2030-01-01T00:00:00Z');
  const attributes = [{ name: 'commonName', value: 'Nuvex Integral Test' }];
  certificate.setSubject(attributes);
  certificate.setIssuer(attributes);
  certificate.sign(keys.privateKey, forge.md.sha256.create());
  const asn1 = forge.pkcs12.toPkcs12Asn1(
    keys.privateKey,
    [certificate],
    password,
    { algorithm: '3des' },
  );
  return Buffer.from(forge.asn1.toDer(asn1).getBytes(), 'binary');
}

function cdr(
  code: string,
  description: string,
  document: ReturnType<typeof documentFixture>,
) {
  const reference = `${document.series}-${document.number}`;
  const typeCode = {
    INVOICE: '01',
    CREDIT_NOTE: '07',
    DEBIT_NOTE: '08',
  }[document.documentType];
  const xml = `<?xml version="1.0"?><ApplicationResponse xmlns="urn:oasis:names:specification:ubl:schema:xsd:ApplicationResponse-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2"><cac:DocumentResponse><cac:Response><cbc:ReferenceID>${reference}</cbc:ReferenceID><cbc:ResponseCode>${code}</cbc:ResponseCode><cbc:Description>${description}</cbc:Description></cac:Response></cac:DocumentResponse></ApplicationResponse>`;
  return Buffer.from(
    zipSync({
      [`R-20123456789-${typeCode}-${reference}.xml`]: Buffer.from(xml),
    }),
  );
}
