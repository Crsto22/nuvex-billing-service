import { ConfigService } from '@nestjs/config';
import { SecretCryptoService } from './secret-crypto.service';
import { TokenHashService } from './token-hash.service';

describe('security services', () => {
  const config = new ConfigService({
    SECRETS_ENCRYPTION_KEY: Buffer.alloc(32, 5).toString('base64'),
    API_KEY_PEPPER: 'unit-test-pepper-with-at-least-32-characters',
  });

  it('encrypts and decrypts with authenticated context', () => {
    const service = new SecretCryptoService(config);
    const encrypted = service.encrypt('clave-sol', 'tenant:123');

    expect(encrypted).not.toContain('clave-sol');
    expect(service.decrypt(encrypted, 'tenant:123')).toBe('clave-sol');
    expect(() => service.decrypt(encrypted, 'tenant:456')).toThrow(
      'No se pudo descifrar',
    );
  });

  it('hashes tokens deterministically and compares them safely', () => {
    const service = new TokenHashService(config);
    const hash = service.hash('nb_test_secret');

    expect(service.hash('nb_test_secret')).toBe(hash);
    expect(service.verify('nb_test_secret', hash)).toBe(true);
    expect(service.verify('another-token', hash)).toBe(false);
  });
});
