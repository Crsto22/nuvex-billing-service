import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { createHmac } from 'node:crypto';
import type { Server } from 'node:http';
import request from 'supertest';
import { ApiModule } from '../apps/api/src/api.module';
import { configureApi } from '../apps/api/src/bootstrap/configure-api';
import { PrismaService } from '../libs/database/src/prisma.service';

describe('Nuvex Billing API (e2e)', () => {
  let app: INestApplication;
  const apiKey = 'nb_test_abcdefghij.application-secret';
  const prisma = {
    apiKey: {
      findUnique: jest.fn().mockResolvedValue({
        id: '11111111-1111-4111-8111-111111111111',
        applicationId: '22222222-2222-4222-8222-222222222222',
        environment: 'BETA',
        prefix: 'nb_test_abcdefghij',
        secretHash: createHmac(
          'sha256',
          'test-api-key-pepper-with-32-characters',
        )
          .update(apiKey)
          .digest('base64url'),
        scopes: ['documents:read'],
        revokedAt: null,
        expiresAt: null,
        application: {
          status: 'ACTIVE',
          tenantId: '33333333-3333-4333-8333-333333333333',
          tenant: { status: 'ACTIVE' },
        },
      }),
      update: jest.fn().mockResolvedValue({}),
    },
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [ApiModule] })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .compile();

    app = moduleRef.createNestApplication();
    configureApi(app, app.get(ConfigService));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('exposes public health with security headers', async () => {
    const response = await request(app.getHttpServer() as Server)
      .get('/v1/health')
      .set('X-Request-Id', 'test-request-123')
      .expect(200);

    expect(response.body).toMatchObject({
      status: 'ok',
      service: 'nuvex-billing-api',
      version: '0.1.0',
    });
    expect(response.headers['x-request-id']).toBe('test-request-123');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['x-powered-by']).toBeUndefined();
  });

  it('requires authentication by default with a correlated safe error', async () => {
    const response = await request(app.getHttpServer() as Server)
      .get('/v1/me')
      .expect(401);

    expect(response.headers['content-type']).toContain(
      'application/problem+json',
    );
    expect(response.body).toMatchObject({
      type: 'about:blank',
      status: 401,
      requestId: response.headers['x-request-id'],
    });
  });

  it('authenticates an active application API key', async () => {
    const response = await request(app.getHttpServer() as Server)
      .get('/v1/me')
      .set('Authorization', `Bearer ${apiKey}`)
      .expect(200);

    expect(response.body).toMatchObject({
      type: 'API_KEY',
      applicationId: '22222222-2222-4222-8222-222222222222',
      tenantId: '33333333-3333-4333-8333-333333333333',
      environment: 'BETA',
      scopes: ['documents:read'],
    });
  });

  it('protects administrative routes with the platform key', async () => {
    await request(app.getHttpServer() as Server)
      .get('/v1/admin/tenants')
      .set('Authorization', 'Bearer invalid-admin-key')
      .expect(401);
  });

  it('enforces API key scopes before executing a calculation', async () => {
    await request(app.getHttpServer() as Server)
      .post('/v1/calculations')
      .set('Authorization', `Bearer ${apiKey}`)
      .send({})
      .expect(403);
  });

  it('exposes the GRE routes and validates their authorization boundary', async () => {
    await request(app.getHttpServer() as Server)
      .post('/v1/despatch-guides')
      .set('Authorization', `Bearer ${apiKey}`)
      .set('Idempotency-Key', 'gre-e2e-create-key-0001')
      .send({})
      .expect(403);

    await request(app.getHttpServer() as Server)
      .get('/v1/despatch-guides/not-a-uuid')
      .set('Authorization', `Bearer ${apiKey}`)
      .expect(400);
  });
});
