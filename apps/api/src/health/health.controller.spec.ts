import { HealthController } from './health.controller';

describe('HealthController', () => {
  it('reports an operational service', () => {
    const result = new HealthController().getHealth();

    expect(result.status).toBe('ok');
    expect(result.service).toBe('nuvex-billing-api');
    expect(new Date(result.timestamp).toISOString()).toBe(result.timestamp);
  });
});
