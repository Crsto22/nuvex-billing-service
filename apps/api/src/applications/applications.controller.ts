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
  Req,
} from '@nestjs/common';
import { adminContext } from '../admin/request-context.helper';
import { PlatformAdmin } from '../auth/auth.decorators';
import type { RequestWithId } from '../common/request-id.middleware';
import { ApplicationsService } from './applications.service';
import { CreateApiKeyDto } from './dto/create-api-key.dto';
import { CreateApplicationDto } from './dto/create-application.dto';
import { UpdateApplicationStatusDto } from './dto/update-application-status.dto';

@PlatformAdmin()
@Controller('admin')
export class ApplicationsController {
  constructor(private readonly applications: ApplicationsService) {}

  @Get('tenants/:tenantId/applications')
  list(@Param('tenantId', ParseUUIDPipe) tenantId: string) {
    return this.applications.list(tenantId);
  }

  @Post('tenants/:tenantId/applications')
  create(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Body() dto: CreateApplicationDto,
    @Req() request: RequestWithId,
  ) {
    return this.applications.create(tenantId, dto, adminContext(request));
  }

  @Patch('applications/:applicationId/status')
  updateStatus(
    @Param('applicationId', ParseUUIDPipe) applicationId: string,
    @Body() dto: UpdateApplicationStatusDto,
    @Req() request: RequestWithId,
  ) {
    return this.applications.updateStatus(
      applicationId,
      dto.status,
      adminContext(request),
    );
  }

  @Get('applications/:applicationId/api-keys')
  listApiKeys(@Param('applicationId', ParseUUIDPipe) applicationId: string) {
    return this.applications.listApiKeys(applicationId);
  }

  @Post('applications/:applicationId/api-keys')
  createApiKey(
    @Param('applicationId', ParseUUIDPipe) applicationId: string,
    @Body() dto: CreateApiKeyDto,
    @Req() request: RequestWithId,
  ) {
    return this.applications.createApiKey(
      applicationId,
      dto,
      adminContext(request),
    );
  }

  @Delete('api-keys/:apiKeyId')
  @HttpCode(200)
  revokeApiKey(
    @Param('apiKeyId', ParseUUIDPipe) apiKeyId: string,
    @Req() request: RequestWithId,
  ) {
    return this.applications.revokeApiKey(apiKeyId, adminContext(request));
  }
}
