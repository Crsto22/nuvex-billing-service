import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
} from '@nestjs/common';
import { PlatformAdmin } from '../auth/auth.decorators';
import type { RequestWithId } from '../common/request-id.middleware';
import {
  CreateEstablishmentDto,
  CreateFiscalSeriesDto,
} from './dto/fiscal-setup.dto';
import { DocumentsService } from './documents.service';

@PlatformAdmin()
@Controller('admin/tenants/:tenantId')
export class FiscalSetupController {
  constructor(private readonly documents: DocumentsService) {}

  @Get('establishments')
  listEstablishments(@Param('tenantId', ParseUUIDPipe) tenantId: string) {
    return this.documents.listEstablishments(tenantId);
  }

  @Post('establishments')
  createEstablishment(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Body() dto: CreateEstablishmentDto,
    @Req() request: RequestWithId,
  ) {
    return this.documents.createEstablishment(tenantId, dto, request);
  }

  @Get('fiscal-series')
  listFiscalSeries(@Param('tenantId', ParseUUIDPipe) tenantId: string) {
    return this.documents.listFiscalSeries(tenantId);
  }

  @Post('fiscal-series')
  createFiscalSeries(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Body() dto: CreateFiscalSeriesDto,
    @Req() request: RequestWithId,
  ) {
    return this.documents.createFiscalSeries(tenantId, dto, request);
  }
}
