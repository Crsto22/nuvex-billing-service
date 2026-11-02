import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseEnumPipe,
  ParseUUIDPipe,
  Put,
  Req,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Environment } from '@prisma/client';
import { adminContext } from '../admin/request-context.helper';
import { PlatformAdmin } from '../auth/auth.decorators';
import type { RequestWithId } from '../common/request-id.middleware';
import { UpdateSunatCredentialDto } from './dto/update-sunat-credential.dto';
import { UploadSunatCertificateDto } from './dto/upload-sunat-certificate.dto';
import { SunatCredentialsService } from './sunat-credentials.service';

@PlatformAdmin()
@Controller('admin/tenants/:tenantId/sunat-credentials')
export class SunatCredentialsController {
  constructor(private readonly credentials: SunatCredentialsService) {}

  @Get()
  list(@Param('tenantId', ParseUUIDPipe) tenantId: string) {
    return this.credentials.list(tenantId);
  }

  @Get(':environment')
  get(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Param('environment', new ParseEnumPipe(Environment))
    environment: Environment,
  ) {
    return this.credentials.get(tenantId, environment);
  }

  @Put(':environment')
  update(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Param('environment', new ParseEnumPipe(Environment))
    environment: Environment,
    @Body() dto: UpdateSunatCredentialDto,
    @Req() request: RequestWithId,
  ) {
    return this.credentials.update(
      tenantId,
      environment,
      dto,
      adminContext(request),
    );
  }

  @Put(':environment/certificate')
  @UseInterceptors(
    FileInterceptor('certificate', { limits: { fileSize: 2 * 1024 * 1024 } }),
  )
  uploadCertificate(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Param('environment', new ParseEnumPipe(Environment))
    environment: Environment,
    @Body() dto: UploadSunatCertificateDto,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Req() request: RequestWithId,
  ) {
    if (!file) throw new BadRequestException('Debe adjuntar el certificado');
    return this.credentials.uploadCertificate(
      tenantId,
      environment,
      dto.password,
      file,
      adminContext(request),
    );
  }

  @Delete(':environment/certificate')
  deleteCertificate(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Param('environment', new ParseEnumPipe(Environment))
    environment: Environment,
    @Req() request: RequestWithId,
  ) {
    return this.credentials.deleteCertificate(
      tenantId,
      environment,
      adminContext(request),
    );
  }
}
