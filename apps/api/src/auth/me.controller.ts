import { Controller, Get } from '@nestjs/common';
import { CurrentPrincipal } from './auth.decorators';
import type { ApplicationPrincipal } from './auth.types';

@Controller('me')
export class MeController {
  @Get()
  getMe(@CurrentPrincipal() principal: ApplicationPrincipal) {
    return principal;
  }
}
