import {
  BadRequestException,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Put,
  Req,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { adminContext } from '../admin/request-context.helper';
import { PlatformAdmin } from '../auth/auth.decorators';
import type { RequestWithId } from '../common/request-id.middleware';
import { TenantBrandingService } from './tenant-branding.service';

@PlatformAdmin()
@Controller('admin/tenants/:tenantId/branding')
export class TenantBrandingController {
  constructor(private readonly branding: TenantBrandingService) {}

  @Get()
  get(@Param('tenantId', ParseUUIDPipe) tenantId: string) {
    return this.branding.get(tenantId);
  }

  @Put('logo')
  @UseInterceptors(
    FileInterceptor('logo', { limits: { fileSize: 5 * 1024 * 1024 } }),
  )
  uploadLogo(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Req() request: RequestWithId,
  ) {
    if (!file) {
      throw new BadRequestException('Debe adjuntar el logo en el campo logo');
    }
    return this.branding.uploadLogo(tenantId, file, adminContext(request));
  }
}
