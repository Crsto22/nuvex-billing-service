import { Module } from '@nestjs/common';
import { StorageModule } from '../../../../libs/storage/src/storage.module';
import { LogoImageOptimizerService } from './logo-image-optimizer.service';
import { TenantBrandingController } from './tenant-branding.controller';
import { TenantBrandingService } from './tenant-branding.service';

@Module({
  imports: [StorageModule],
  controllers: [TenantBrandingController],
  providers: [TenantBrandingService, LogoImageOptimizerService],
  exports: [TenantBrandingService],
})
export class BrandingModule {}
