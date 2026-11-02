import {
  Body,
  Controller,
  Headers,
  HttpCode,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { CurrentPrincipal } from '../auth/auth.decorators';
import type { ApplicationPrincipal } from '../auth/auth.types';
import { RequireScopes } from '../auth/scope.decorator';
import type { RequestWithId } from '../common/request-id.middleware';
import { CreateTaxNoteDto } from './dto/create-tax-note.dto';
import { NotesService } from './notes.service';

@Controller()
export class NotesController {
  constructor(private readonly notes: NotesService) {}

  @Post('credit-notes')
  @HttpCode(201)
  @RequireScopes('documents:write')
  createCreditNote(
    @Body() dto: CreateTaxNoteDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @CurrentPrincipal() principal: ApplicationPrincipal,
    @Req() request: RequestWithId,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.create(
      'CREDIT_NOTE',
      dto,
      idempotencyKey,
      principal,
      request,
      response,
    );
  }

  @Post('debit-notes')
  @HttpCode(201)
  @RequireScopes('documents:write')
  createDebitNote(
    @Body() dto: CreateTaxNoteDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @CurrentPrincipal() principal: ApplicationPrincipal,
    @Req() request: RequestWithId,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.create(
      'DEBIT_NOTE',
      dto,
      idempotencyKey,
      principal,
      request,
      response,
    );
  }

  private async create(
    type: 'CREDIT_NOTE' | 'DEBIT_NOTE',
    dto: CreateTaxNoteDto,
    idempotencyKey: string | undefined,
    principal: ApplicationPrincipal,
    request: RequestWithId,
    response: Response,
  ) {
    const result = await this.notes.create(
      type,
      dto,
      idempotencyKey ?? '',
      principal,
      request,
    );
    response.setHeader('Location', `/v1/documents/${result.id}`);
    return result;
  }
}
