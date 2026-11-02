import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { CurrentPrincipal } from '../auth/auth.decorators';
import type { ApplicationPrincipal } from '../auth/auth.types';
import { RequireScopes } from '../auth/scope.decorator';
import {
  CreateWebhookEndpointDto,
  UpdateWebhookEndpointDto,
} from './dto/webhook-endpoint.dto';
import { WebhookEndpointsService } from './webhook-endpoints.service';

@Controller('webhook-endpoints')
@RequireScopes('webhooks:manage')
export class WebhookEndpointsController {
  constructor(private readonly endpoints: WebhookEndpointsService) {}

  @Get()
  list(@CurrentPrincipal() principal: ApplicationPrincipal) {
    return this.endpoints.list(principal);
  }

  @Post()
  create(
    @Body() dto: CreateWebhookEndpointDto,
    @CurrentPrincipal() principal: ApplicationPrincipal,
  ) {
    return this.endpoints.create(dto, principal);
  }

  @Patch(':endpointId')
  update(
    @Param('endpointId', ParseUUIDPipe) endpointId: string,
    @Body() dto: UpdateWebhookEndpointDto,
    @CurrentPrincipal() principal: ApplicationPrincipal,
  ) {
    return this.endpoints.update(endpointId, dto, principal);
  }

  @Delete(':endpointId')
  @HttpCode(200)
  deactivate(
    @Param('endpointId', ParseUUIDPipe) endpointId: string,
    @CurrentPrincipal() principal: ApplicationPrincipal,
  ) {
    return this.endpoints.deactivate(endpointId, principal);
  }

  @Post(':endpointId/rotate-secret')
  rotateSecret(
    @Param('endpointId', ParseUUIDPipe) endpointId: string,
    @CurrentPrincipal() principal: ApplicationPrincipal,
  ) {
    return this.endpoints.rotateSecret(endpointId, principal);
  }
}
