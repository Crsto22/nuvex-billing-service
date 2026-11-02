import { WebhookSignatureService } from './webhook-signature.service';

describe('WebhookSignatureService', () => {
  const service = new WebhookSignatureService();

  it('firma timestamp y cuerpo y detecta alteraciones', () => {
    const signature = service.sign('whsec_test', 1_700_000_000, '{"id":"evt"}');

    expect(signature).toMatch(/^v1=[a-f0-9]{64}$/);
    expect(
      service.verify('whsec_test', 1_700_000_000, '{"id":"evt"}', signature),
    ).toBe(true);
    expect(
      service.verify('whsec_test', 1_700_000_000, '{"id":"otro"}', signature),
    ).toBe(false);
  });
});
