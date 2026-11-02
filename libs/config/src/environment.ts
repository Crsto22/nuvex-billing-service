export type RuntimeEnvironment = 'development' | 'test' | 'production';

const TEST_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
const TEST_API_KEY_PEPPER = 'test-api-key-pepper-with-32-characters';
const TEST_PLATFORM_ADMIN_KEY = 'test-platform-admin-key-with-32-characters';
const TEST_DATABASE_URL =
  'postgresql://test:test@127.0.0.1:5432/nuvex_billing_test?schema=public';

export function validateEnvironment(
  input: Record<string, unknown>,
): Record<string, unknown> {
  const nodeEnv = enumValue(
    input.NODE_ENV,
    ['development', 'test', 'production'] as const,
    'development',
    'NODE_ENV',
  );
  const testMode = nodeEnv === 'test';
  const encryptionKey = requiredString(
    input.SECRETS_ENCRYPTION_KEY,
    'SECRETS_ENCRYPTION_KEY',
    testMode ? TEST_ENCRYPTION_KEY : undefined,
  );
  const apiKeyPepper = requiredString(
    input.API_KEY_PEPPER,
    'API_KEY_PEPPER',
    testMode ? TEST_API_KEY_PEPPER : undefined,
  );
  const platformAdminKey = requiredString(
    input.PLATFORM_ADMIN_KEY,
    'PLATFORM_ADMIN_KEY',
    testMode ? TEST_PLATFORM_ADMIN_KEY : undefined,
  );
  const databaseUrl = requiredString(
    input.DATABASE_URL,
    'DATABASE_URL',
    testMode ? TEST_DATABASE_URL : undefined,
  );

  validateEncryptionKey(encryptionKey);
  if (apiKeyPepper.length < 32) {
    throw new Error('API_KEY_PEPPER debe tener al menos 32 caracteres');
  }
  if (platformAdminKey.length < 32) {
    throw new Error('PLATFORM_ADMIN_KEY debe tener al menos 32 caracteres');
  }
  validateDatabaseUrl(databaseUrl);

  const corsOrigins = parseCorsOrigins(input.CORS_ORIGINS, nodeEnv);
  const cloudflareAccountId = stringValue(input.CLOUDFLARE_R2_ACCOUNT_ID, '');
  const privateStorage = {
    endpoint: stringValue(
      input.PRIVATE_STORAGE_ENDPOINT,
      cloudflareAccountId
        ? `https://${cloudflareAccountId}.r2.cloudflarestorage.com`
        : '',
    ),
    region: stringValue(input.PRIVATE_STORAGE_REGION, 'auto'),
    accessKeyId: stringValue(
      input.PRIVATE_STORAGE_ACCESS_KEY_ID,
      stringValue(input.CLOUDFLARE_R2_ACCESS_KEY_ID, ''),
    ),
    secretAccessKey: stringValue(
      input.PRIVATE_STORAGE_SECRET_ACCESS_KEY,
      stringValue(input.CLOUDFLARE_R2_SECRET_ACCESS_KEY, ''),
    ),
    bucket: stringValue(
      input.PRIVATE_STORAGE_BUCKET,
      stringValue(
        input.CLOUDFLARE_R2_PRIVATE_BUCKET,
        stringValue(input.CLOUDFLARE_R2_BUCKET, ''),
      ),
    ),
  };
  if (nodeEnv === 'production') {
    for (const [name, value] of Object.entries(privateStorage)) {
      if (!value) {
        throw new Error(
          `PRIVATE_STORAGE_${storageConfigSuffix(name)} es obligatorio en producciÃ³n`,
        );
      }
    }
  }

  const output = {
    ...input,
    NODE_ENV: nodeEnv,
    API_HOST: stringValue(input.API_HOST, '0.0.0.0'),
    API_PORT: integerValue(input.API_PORT, 3100, 1, 65_535, 'API_PORT'),
    CORS_ORIGINS: corsOrigins,
    TRUST_PROXY_HOPS: integerValue(
      input.TRUST_PROXY_HOPS,
      0,
      0,
      10,
      'TRUST_PROXY_HOPS',
    ),
    RATE_LIMIT_TTL_MS: integerValue(
      input.RATE_LIMIT_TTL_MS,
      60_000,
      1_000,
      3_600_000,
      'RATE_LIMIT_TTL_MS',
    ),
    RATE_LIMIT_LIMIT: integerValue(
      input.RATE_LIMIT_LIMIT,
      120,
      1,
      100_000,
      'RATE_LIMIT_LIMIT',
    ),
    SECRETS_ENCRYPTION_KEY: encryptionKey,
    API_KEY_PEPPER: apiKeyPepper,
    PLATFORM_ADMIN_KEY: platformAdminKey,
    DATABASE_URL: databaseUrl,
    PRIVATE_STORAGE_ENDPOINT: privateStorage.endpoint,
    PRIVATE_STORAGE_REGION: privateStorage.region,
    PRIVATE_STORAGE_ACCESS_KEY_ID: privateStorage.accessKeyId,
    PRIVATE_STORAGE_SECRET_ACCESS_KEY: privateStorage.secretAccessKey,
    PRIVATE_STORAGE_BUCKET: privateStorage.bucket,
    PRIVATE_STORAGE_SIGNED_URL_TTL_SECONDS: integerValue(
      input.PRIVATE_STORAGE_SIGNED_URL_TTL_SECONDS ??
        input.CLOUDFLARE_R2_SIGNED_URL_TTL_SECONDS,
      300,
      60,
      900,
      'PRIVATE_STORAGE_SIGNED_URL_TTL_SECONDS',
    ),
    WORKER_POLL_INTERVAL_MS: integerValue(
      input.WORKER_POLL_INTERVAL_MS,
      1_000,
      100,
      60_000,
      'WORKER_POLL_INTERVAL_MS',
    ),
    WORKER_CONCURRENCY: integerValue(
      input.WORKER_CONCURRENCY,
      4,
      1,
      50,
      'WORKER_CONCURRENCY',
    ),
    WORKER_LOCK_TIMEOUT_MS: integerValue(
      input.WORKER_LOCK_TIMEOUT_MS,
      120_000,
      5_000,
      3_600_000,
      'WORKER_LOCK_TIMEOUT_MS',
    ),
    WORKER_RETRY_BASE_MS: integerValue(
      input.WORKER_RETRY_BASE_MS,
      5_000,
      100,
      3_600_000,
      'WORKER_RETRY_BASE_MS',
    ),
    WORKER_RETRY_MAX_MS: integerValue(
      input.WORKER_RETRY_MAX_MS,
      900_000,
      1_000,
      86_400_000,
      'WORKER_RETRY_MAX_MS',
    ),
    SUNAT_BETA_BILL_ENDPOINT: httpsUrl(
      input.SUNAT_BETA_BILL_ENDPOINT,
      'https://e-beta.sunat.gob.pe/ol-ti-itcpfegem-beta/billService',
      'SUNAT_BETA_BILL_ENDPOINT',
    ),
    SUNAT_PRODUCTION_BILL_ENDPOINT: httpsUrl(
      input.SUNAT_PRODUCTION_BILL_ENDPOINT,
      'https://e-factura.sunat.gob.pe/ol-ti-itcpfegem/billService',
      'SUNAT_PRODUCTION_BILL_ENDPOINT',
    ),
    SUNAT_SOAP_TIMEOUT_MS: integerValue(
      input.SUNAT_SOAP_TIMEOUT_MS,
      60_000,
      1_000,
      120_000,
      'SUNAT_SOAP_TIMEOUT_MS',
    ),
    SUNAT_MAX_RESPONSE_BYTES: integerValue(
      input.SUNAT_MAX_RESPONSE_BYTES,
      10_485_760,
      1_024,
      52_428_800,
      'SUNAT_MAX_RESPONSE_BYTES',
    ),
    WEBHOOK_POLL_INTERVAL_MS: integerValue(
      input.WEBHOOK_POLL_INTERVAL_MS,
      1_000,
      100,
      60_000,
      'WEBHOOK_POLL_INTERVAL_MS',
    ),
    WEBHOOK_CONCURRENCY: integerValue(
      input.WEBHOOK_CONCURRENCY,
      8,
      1,
      100,
      'WEBHOOK_CONCURRENCY',
    ),
    WEBHOOK_LOCK_TIMEOUT_MS: integerValue(
      input.WEBHOOK_LOCK_TIMEOUT_MS,
      60_000,
      5_000,
      600_000,
      'WEBHOOK_LOCK_TIMEOUT_MS',
    ),
    WEBHOOK_TIMEOUT_MS: integerValue(
      input.WEBHOOK_TIMEOUT_MS,
      10_000,
      500,
      60_000,
      'WEBHOOK_TIMEOUT_MS',
    ),
    WEBHOOK_RETRY_BASE_MS: integerValue(
      input.WEBHOOK_RETRY_BASE_MS,
      10_000,
      100,
      3_600_000,
      'WEBHOOK_RETRY_BASE_MS',
    ),
    WEBHOOK_RETRY_MAX_MS: integerValue(
      input.WEBHOOK_RETRY_MAX_MS,
      3_600_000,
      1_000,
      86_400_000,
      'WEBHOOK_RETRY_MAX_MS',
    ),
  };
  if (output.WORKER_RETRY_MAX_MS < output.WORKER_RETRY_BASE_MS) {
    throw new Error(
      'WORKER_RETRY_MAX_MS debe ser mayor o igual que WORKER_RETRY_BASE_MS',
    );
  }
  if (output.WEBHOOK_RETRY_MAX_MS < output.WEBHOOK_RETRY_BASE_MS) {
    throw new Error(
      'WEBHOOK_RETRY_MAX_MS debe ser mayor o igual que WEBHOOK_RETRY_BASE_MS',
    );
  }
  return output;
}

function storageConfigSuffix(name: string) {
  return name.replace(/[A-Z]/g, (letter) => `_${letter}`).toUpperCase();
}

function validateDatabaseUrl(value: string) {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('DATABASE_URL no es una URL válida');
  }
  if (!['postgresql:', 'postgres:'].includes(parsed.protocol)) {
    throw new Error('DATABASE_URL debe usar PostgreSQL');
  }
}

function parseCorsOrigins(
  value: unknown,
  environment: RuntimeEnvironment,
): string[] {
  const origins = stringValue(value, '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  for (const origin of origins) {
    let parsed: URL;
    try {
      parsed = new URL(origin);
    } catch {
      throw new Error(`CORS_ORIGINS contiene un origen inválido: ${origin}`);
    }

    if (
      parsed.origin !== origin ||
      !['http:', 'https:'].includes(parsed.protocol)
    ) {
      throw new Error(
        `CORS_ORIGINS debe contener orígenes sin ruta: ${origin}`,
      );
    }
    if (environment === 'production' && parsed.protocol !== 'https:') {
      throw new Error(
        `CORS_ORIGINS solo permite HTTPS en producción: ${origin}`,
      );
    }
  }

  return [...new Set(origins)];
}

function validateEncryptionKey(value: string) {
  const decoded = Buffer.from(value, 'base64');
  if (decoded.length !== 32 || decoded.toString('base64') !== value) {
    throw new Error(
      'SECRETS_ENCRYPTION_KEY debe contener exactamente 32 bytes en base64',
    );
  }
}

function stringValue(value: unknown, fallback: string) {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function requiredString(value: unknown, name: string, fallback?: string) {
  const result = stringValue(value, fallback ?? '');
  if (!result) throw new Error(`${name} es obligatorio`);
  return result;
}

function httpsUrl(value: unknown, fallback: string, name: string) {
  const result = stringValue(value, fallback);
  let parsed: URL;
  try {
    parsed = new URL(result);
  } catch {
    throw new Error(`${name} no es una URL valida`);
  }
  if (parsed.protocol !== 'https:') {
    throw new Error(`${name} debe usar HTTPS`);
  }
  return parsed.toString();
}

function integerValue(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number,
  name: string,
) {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} debe ser un entero entre ${minimum} y ${maximum}`);
  }
  return parsed;
}

function enumValue<const T extends readonly string[]>(
  value: unknown,
  allowed: T,
  fallback: T[number],
  name: string,
): T[number] {
  const result = stringValue(value, fallback);
  if (!allowed.includes(result)) {
    throw new Error(`${name} debe ser uno de: ${allowed.join(', ')}`);
  }
  return result;
}
