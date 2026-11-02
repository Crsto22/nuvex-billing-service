import {
  isPublicIp,
  WebhookUrlPolicyService,
} from './webhook-url-policy.service';

describe('isPublicIp', () => {
  it.each([
    '127.0.0.1',
    '10.0.0.1',
    '172.16.0.1',
    '192.168.1.1',
    '169.254.169.254',
    '::1',
    'fd00::1',
    'fe80::1',
    '::ffff:127.0.0.1',
  ])('bloquea direcciones internas: %s', (address) => {
    expect(isPublicIp(address)).toBe(false);
  });

  it.each(['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111'])(
    'permite direcciones públicas: %s',
    (address) => {
      expect(isPublicIp(address)).toBe(true);
    },
  );
});

describe('WebhookUrlPolicyService', () => {
  const service = new WebhookUrlPolicyService();

  it.each([
    'http://hooks.example.com',
    'https://user:password@hooks.example.com',
    'https://127.0.0.1/hook',
    'https://169.254.169.254/latest/meta-data',
    'https://localhost/hook',
  ])('rechaza un destino inseguro: %s', async (url) => {
    await expect(service.assertSafe(url)).rejects.toThrow();
  });
});
