import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { CurrentPrincipal } from '../auth/auth.decorators';
import { RequireScopes } from '../auth/scope.decorator';
import type { ApplicationPrincipal } from '../auth/auth.types';
import type { RequestWithId } from '../common/request-id.middleware';
import {
  CreateDocumentDto,
  ListDocumentsQueryDto,
} from './dto/create-document.dto';
import { DocumentsService } from './documents.service';

@Controller('documents')
export class DocumentsController {
  constructor(private readonly documents: DocumentsService) {}

  @Post()
  @HttpCode(202)
  @RequireScopes('documents:write')
  async create(
    @Body() dto: CreateDocumentDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @CurrentPrincipal() principal: ApplicationPrincipal,
    @Req() request: RequestWithId,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.documents.create(
      dto,
      idempotencyKey ?? '',
      principal,
      request,
    );
    if (
      typeof result === 'object' &&
      result &&
      'id' in result &&
      typeof result.id === 'string'
    ) {
      response.setHeader('Location', `/v1/documents/${result.id}`);
    }
    return result;
  }

  @Get()
  @RequireScopes('documents:read')
  list(
    @CurrentPrincipal() principal: ApplicationPrincipal,
    @Query() query: ListDocumentsQueryDto,
  ) {
    return this.documents.list(principal, query);
  }

  @Get(':documentId')
  @RequireScopes('documents:read')
  get(
    @Param('documentId', ParseUUIDPipe) documentId: string,
    @CurrentPrincipal() principal: ApplicationPrincipal,
  ) {
    return this.documents.get(documentId, principal);
  }

  @Post(':documentId/retry')
  @HttpCode(202)
  @RequireScopes('documents:write')
  retry(
    @Param('documentId', ParseUUIDPipe) documentId: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @CurrentPrincipal() principal: ApplicationPrincipal,
    @Req() request: RequestWithId,
  ) {
    return this.documents.retry(
      documentId,
      idempotencyKey ?? '',
      principal,
      request,
    );
  }
}
