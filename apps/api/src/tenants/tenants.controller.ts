import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
} from '@nestjs/common';
import { adminContext } from '../admin/request-context.helper';
import { PlatformAdmin } from '../auth/auth.decorators';
import type { RequestWithId } from '../common/request-id.middleware';
import { CreateTenantDto } from './dto/create-tenant.dto';
import { UpdateTenantStatusDto } from './dto/update-tenant-status.dto';
import { TenantsService } from './tenants.service';

@PlatformAdmin()
@Controller('admin/tenants')
export class TenantsController {
  constructor(private readonly tenants: TenantsService) {}

  @Get()
  list() {
    return this.tenants.list();
  }

  @Get(':tenantId')
  get(@Param('tenantId', ParseUUIDPipe) tenantId: string) {
    return this.tenants.get(tenantId);
  }

  @Post()
  create(@Body() dto: CreateTenantDto, @Req() request: RequestWithId) {
    return this.tenants.create(dto, adminContext(request));
  }

  @Patch(':tenantId/status')
  updateStatus(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Body() dto: UpdateTenantStatusDto,
    @Req() request: RequestWithId,
  ) {
    return this.tenants.updateStatus(
      tenantId,
      dto.status,
      adminContext(request),
    );
  }
}
