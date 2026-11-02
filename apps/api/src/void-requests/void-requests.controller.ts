import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { CurrentPrincipal } from '../auth/auth.decorators';
import type { ApplicationPrincipal } from '../auth/auth.types';
import { RequireScopes } from '../auth/scope.decorator';
import type { RequestWithId } from '../common/request-id.middleware';
import {
  ConfirmGreVoidRequestDto,
  CreateGreVoidRequestDto,
  CreateTaxDocumentVoidRequestDto,
} from './dto/create-void-request.dto';
import { VoidRequestsService } from './void-requests.service';

@Controller()
export class VoidRequestsController {
  constructor(private readonly voidRequests: VoidRequestsService) {}

  @Post('documents/:documentId/void')
  @HttpCode(202)
  @RequireScopes('documents:write')
  async createForDocument(
    @Param('documentId', ParseUUIDPipe) documentId: string,
    @Body() dto: CreateTaxDocumentVoidRequestDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @CurrentPrincipal() principal: ApplicationPrincipal,
    @Req() request: RequestWithId,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.voidRequests.createForDocument(
      documentId,
      dto,
      idempotencyKey ?? '',
      principal,
      request,
    );
    response.setHeader('Location', `/v1/void-requests/${result.id}`);
    return result;
  }

  @Post('despatch-guides/:guideId/void')
  @HttpCode(202)
  @RequireScopes('documents:write')
  async createForGuide(
    @Param('guideId', ParseUUIDPipe) guideId: string,
    @Body() dto: CreateGreVoidRequestDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @CurrentPrincipal() principal: ApplicationPrincipal,
    @Req() request: RequestWithId,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.voidRequests.createForGuide(
      guideId,
      dto,
      idempotencyKey ?? '',
      principal,
      request,
    );
    response.setHeader('Location', `/v1/void-requests/${result.id}`);
    return result;
  }

  @Get('void-requests/:requestId')
  @RequireScopes('documents:read')
  get(
    @Param('requestId', ParseUUIDPipe) requestId: string,
    @CurrentPrincipal() principal: ApplicationPrincipal,
  ) {
    return this.voidRequests.get(requestId, principal);
  }

  @Post('void-requests/:requestId/retry')
  @HttpCode(202)
  @RequireScopes('documents:write')
  retry(
    @Param('requestId', ParseUUIDPipe) requestId: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @CurrentPrincipal() principal: ApplicationPrincipal,
    @Req() request: RequestWithId,
  ) {
    return this.voidRequests.retry(
      requestId,
      idempotencyKey ?? '',
      principal,
      request,
    );
  }

  @Post('void-requests/:requestId/daily-summary/artifacts')
  @HttpCode(200)
  @RequireScopes('documents:write')
  generateDailySummaryArtifacts(
    @Param('requestId', ParseUUIDPipe) requestId: string,
    @CurrentPrincipal() principal: ApplicationPrincipal,
  ) {
    return this.voidRequests.generateDailySummaryArtifacts(
      requestId,
      principal,
    );
  }

  @Post('void-requests/:requestId/artifacts')
  @HttpCode(200)
  @RequireScopes('documents:write')
  generateArtifacts(
    @Param('requestId', ParseUUIDPipe) requestId: string,
    @CurrentPrincipal() principal: ApplicationPrincipal,
  ) {
    return this.voidRequests.generateDailySummaryArtifacts(
      requestId,
      principal,
    );
  }

  @Post('void-requests/:requestId/submit')
  @HttpCode(202)
  @RequireScopes('documents:write')
  submit(
    @Param('requestId', ParseUUIDPipe) requestId: string,
    @CurrentPrincipal() principal: ApplicationPrincipal,
  ) {
    return this.voidRequests.enqueue(requestId, principal);
  }

  @Get('void-requests/:requestId/cdr')
  @RequireScopes('documents:read')
  getCdr(
    @Param('requestId', ParseUUIDPipe) requestId: string,
    @CurrentPrincipal() principal: ApplicationPrincipal,
  ) {
    return this.voidRequests.getCdr(requestId, principal);
  }

  @Post('void-requests/:requestId/manual-confirmation')
  @HttpCode(200)
  @RequireScopes('documents:write')
  confirmGreManualResult(
    @Param('requestId', ParseUUIDPipe) requestId: string,
    @Body() dto: ConfirmGreVoidRequestDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @CurrentPrincipal() principal: ApplicationPrincipal,
    @Req() request: RequestWithId,
  ) {
    return this.voidRequests.confirmGreManualResult(
      requestId,
      dto,
      idempotencyKey ?? '',
      principal,
      request,
    );
  }
}
