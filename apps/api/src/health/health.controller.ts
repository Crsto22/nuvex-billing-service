import { Controller, Get } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { Public } from '../auth/auth.decorators';

@Public()
@Controller('health')
export class HealthController {
  @Get()
  @SkipThrottle()
  getHealth() {
    return {
      status: 'ok' as const,
      service: 'nuvex-billing-api',
      version: '0.1.0',
      timestamp: new Date().toISOString(),
    };
  }
}
