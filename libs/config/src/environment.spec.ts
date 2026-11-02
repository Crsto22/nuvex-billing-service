import { validateEnvironment } from './environment';

describe('validateEnvironment', () => {
  const encryptionKey = Buffer.alloc(32, 3).toString('base64');
  const pepper = 'a-secure-api-key-pepper-of-32-characters';
  const adminKey = 'a-secure-platform-admin-key-32-characters';
  const databaseUrl = 'postgresql://user:pass@localhost:5432/billing';

  it('normalizes valid production configuration', () => {
    const result = validateEnvironment({
      NODE_ENV: 'production',
      API_PORT: '3200',
      CORS_ORIGINS: 'https://app.nuvex.pe,https://admin.nuvex.pe',
      TRUST_PROXY_HOPS: '1',
      SECRETS_ENCRYPTION_KEY: encryptionKey,
      API_KEY_PEPPER: pepper,
      PLATFORM_ADMIN_KEY: adminKey,
      DATABASE_URL: databaseUrl,
      PRIVATE_STORAGE_ENDPOINT: 'https://account.r2.cloudflarestorage.com',
      PRIVATE_STORAGE_REGION: 'auto',
      PRIVATE_STORAGE_ACCESS_KEY_ID: 'storage-access-key',
      PRIVATE_STORAGE_SECRET_ACCESS_KEY: 'storage-secret-key',
      PRIVATE_STORAGE_BUCKET: 'nuvex-private',
    });

    expect(result.API_PORT).toBe(3200);
    expect(result.TRUST_PROXY_HOPS).toBe(1);
    expect(result.CORS_ORIGINS).toEqual([
      'https://app.nuvex.pe',
      'https://admin.nuvex.pe',
    ]);
  });

  it('reuses the Cloudflare R2 private configuration used by Nuvex', () => {
    const result = validateEnvironment({
      NODE_ENV: 'production',
      SECRETS_ENCRYPTION_KEY: encryptionKey,
      API_KEY_PEPPER: pepper,
      PLATFORM_ADMIN_KEY: adminKey,
      DATABASE_URL: databaseUrl,
      CLOUDFLARE_R2_ACCOUNT_ID: 'nuvex-account',
      CLOUDFLARE_R2_ACCESS_KEY_ID: 'nuvex-access-key',
      CLOUDFLARE_R2_SECRET_ACCESS_KEY: 'nuvex-secret-key',
      CLOUDFLARE_R2_PRIVATE_BUCKET: 'nuvex-private',
      CLOUDFLARE_R2_SIGNED_URL_TTL_SECONDS: '600',
    });

    expect(result).toMatchObject({
      PRIVATE_STORAGE_ENDPOINT:
        'https://nuvex-account.r2.cloudflarestorage.com',
      PRIVATE_STORAGE_REGION: 'auto',
      PRIVATE_STORAGE_ACCESS_KEY_ID: 'nuvex-access-key',
      PRIVATE_STORAGE_SECRET_ACCESS_KEY: 'nuvex-secret-key',
      PRIVATE_STORAGE_BUCKET: 'nuvex-private',
      PRIVATE_STORAGE_SIGNED_URL_TTL_SECONDS: 600,
    });
  });

  it('rejects an invalid encryption key', () => {
    expect(() =>
      validateEnvironment({
        NODE_ENV: 'production',
        SECRETS_ENCRYPTION_KEY: 'invalid',
        API_KEY_PEPPER: pepper,
        PLATFORM_ADMIN_KEY: adminKey,
        DATABASE_URL: databaseUrl,
      }),
    ).toThrow('exactamente 32 bytes');
  });

  it('rejects insecure production CORS origins', () => {
    expect(() =>
      validateEnvironment({
        NODE_ENV: 'production',
        CORS_ORIGINS: 'http://app.nuvex.pe',
        SECRETS_ENCRYPTION_KEY: encryptionKey,
        API_KEY_PEPPER: pepper,
        PLATFORM_ADMIN_KEY: adminKey,
        DATABASE_URL: databaseUrl,
      }),
    ).toThrow('solo permite HTTPS');
  });

  it('normalizes worker defaults and validates retry limits', () => {
    const result = validateEnvironment({ NODE_ENV: 'test' });
    expect(result.WORKER_CONCURRENCY).toBe(4);
    expect(result.WORKER_LOCK_TIMEOUT_MS).toBe(120_000);

    expect(() =>
      validateEnvironment({
        NODE_ENV: 'test',
        WORKER_RETRY_BASE_MS: 10_000,
        WORKER_RETRY_MAX_MS: 5_000,
      }),
    ).toThrow('mayor o igual');
  });
});
