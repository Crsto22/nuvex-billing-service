import {
  Controller,
  Get,
  Param,
  ParseEnumPipe,
  ParseUUIDPipe,
} from '@nestjs/common';
import { ArtifactType } from '@prisma/client';
import { CurrentPrincipal } from '../auth/auth.decorators';
import type { ApplicationPrincipal } from '../auth/auth.types';
import { RequireScopes } from '../auth/scope.decorator';
import { ArtifactDownloadService } from './artifact-download.service';

@Controller('documents/:documentId/artifacts')
export class ArtifactDownloadController {
  constructor(private readonly artifacts: ArtifactDownloadService) {}

  @Get()
  @RequireScopes('documents:read')
  list(
    @Param('documentId', ParseUUIDPipe) documentId: string,
    @CurrentPrincipal() principal: ApplicationPrincipal,
  ) {
    return this.artifacts.list(documentId, principal);
  }

  @Get(':artifactType')
  @RequireScopes('documents:read')
  get(
    @Param('documentId', ParseUUIDPipe) documentId: string,
    @Param('artifactType', new ParseEnumPipe(ArtifactType))
    artifactType: ArtifactType,
    @CurrentPrincipal() principal: ApplicationPrincipal,
  ) {
    return this.artifacts.get(documentId, artifactType, principal);
  }
}
