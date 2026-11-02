process.env.NODE_ENV = 'test';
process.env.SECRETS_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
process.env.API_KEY_PEPPER = 'test-api-key-pepper-with-32-characters';
process.env.PLATFORM_ADMIN_KEY = 'test-platform-admin-key-with-32-characters';
process.env.DATABASE_URL =
  'postgresql://test:test@127.0.0.1:5432/nuvex_billing_test?schema=public';
