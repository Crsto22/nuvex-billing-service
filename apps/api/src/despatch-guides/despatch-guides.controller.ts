import {
  BadRequestException,
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
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { CurrentPrincipal } from '../auth/auth.decorators';
import type { ApplicationPrincipal } from '../auth/auth.types';
import { RequireScopes } from '../auth/scope.decorator';
import type { RequestWithId } from '../common/request-id.middleware';
import { DespatchGuidesService } from './despatch-guides.service';
import {
  CancelDespatchGuideDto,
  CreateDespatchGuideDto,
  ListDespatchGuidesQueryDto,
} from './dto/create-despatch-guide.dto';

@Controller('despatch-guides')
export class DespatchGuidesController {
  constructor(private readonly guides: DespatchGuidesService) {}

  @Post()
  @HttpCode(201)
  @RequireScopes('documents:write')
  async create(
    @Body() dto: CreateDespatchGuideDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @CurrentPrincipal() principal: ApplicationPrincipal,
    @Req() request: RequestWithId,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.guides.create(
      dto,
      idempotencyKey ?? '',
      principal,
      request,
    );
    if (isGuideResponse(result)) {
      response.setHeader('Location', `/v1/despatch-guides/${result.id}`);
    }
    return result;
  }

  @Get()
  @RequireScopes('documents:read')
  list(
    @CurrentPrincipal() principal: ApplicationPrincipal,
    @Query() query: ListDespatchGuidesQueryDto,
  ) {
    return this.guides.list(principal, query);
  }

  @Get(':guideId')
  @RequireScopes('documents:read')
  get(
    @Param('guideId', ParseUUIDPipe) guideId: string,
    @CurrentPrincipal() principal: ApplicationPrincipal,
  ) {
    return this.guides.get(guideId, principal);
  }

  @Post(':guideId/submit')
  @RequireScopes('documents:write')
  submit(
    @Param('guideId', ParseUUIDPipe) guideId: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @CurrentPrincipal() principal: ApplicationPrincipal,
    @Req() request: RequestWithId,
  ) {
    return this.guides.submit(
      guideId,
      idempotencyKey ?? '',
      principal,
      request,
    );
  }

  @Post(':guideId/artifacts')
  @RequireScopes('documents:write')
  generateArtifacts(
    @Param('guideId', ParseUUIDPipe) guideId: string,
    @CurrentPrincipal() principal: ApplicationPrincipal,
    @Req() request: RequestWithId,
  ) {
    return this.guides.generateArtifacts(guideId, principal, request);
  }

  @Post(':guideId/artifacts/pdf-a4')
  @RequireScopes('documents:write')
  generatePdfA4(
    @Param('guideId', ParseUUIDPipe) guideId: string,
    @CurrentPrincipal() principal: ApplicationPrincipal,
  ) {
    return this.guides.generatePdfA4(guideId, principal);
  }

  @Get(':guideId/artifacts')
  @RequireScopes('documents:read')
  listArtifacts(
    @Param('guideId', ParseUUIDPipe) guideId: string,
    @CurrentPrincipal() principal: ApplicationPrincipal,
  ) {
    return this.guides.listArtifacts(guideId, principal);
  }

  @Get(':guideId/artifacts/:artifactType')
  @RequireScopes('documents:read')
  downloadArtifact(
    @Param('guideId', ParseUUIDPipe) guideId: string,
    @Param('artifactType') artifactType: string,
    @CurrentPrincipal() principal: ApplicationPrincipal,
  ) {
    return this.guides.downloadArtifact(guideId, artifactType, principal);
  }

  @Post(':guideId/cdr')
  @UseInterceptors(
    FileInterceptor('cdr', { limits: { fileSize: 2 * 1024 * 1024 } }),
  )
  @RequireScopes('documents:write')
  processCdr(
    @Param('guideId', ParseUUIDPipe) guideId: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentPrincipal() principal: ApplicationPrincipal,
  ) {
    if (!file) throw new BadRequestException('Debe adjuntar el ZIP CDR');
    return this.guides.processCdr(guideId, file.buffer, principal);
  }

  @Post(':guideId/cancel')
  @RequireScopes('documents:write')
  cancel(
    @Param('guideId', ParseUUIDPipe) guideId: string,
    @Body() dto: CancelDespatchGuideDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @CurrentPrincipal() principal: ApplicationPrincipal,
    @Req() request: RequestWithId,
  ) {
    return this.guides.cancel(
      guideId,
      dto,
      idempotencyKey ?? '',
      principal,
      request,
    );
  }
}

function isGuideResponse(value: unknown): value is { id: string } {
  return Boolean(
    value &&
    typeof value === 'object' &&
    'id' in value &&
    typeof value.id === 'string',
  );
}
