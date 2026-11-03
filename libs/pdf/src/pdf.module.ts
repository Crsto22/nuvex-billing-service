import { Module } from '@nestjs/common';
import { StorageModule } from '../../storage/src/storage.module';
import { PdfArtifactService } from './pdf-artifact.service';
import { PdfRendererService } from './pdf-renderer.service';
import { SunatQrService } from './sunat-qr.service';
import { DespatchGuideQrService } from './despatch-guide-qr.service';
import { DespatchGuidePdfRendererService } from './despatch-guide-pdf-renderer.service';
import { DespatchGuidePdfArtifactService } from './despatch-guide-pdf-artifact.service';
import { BrandingLogoResolverService } from './branding-logo-resolver.service';

@Module({
  imports: [StorageModule],
  providers: [
    PdfArtifactService,
    PdfRendererService,
    SunatQrService,
    DespatchGuideQrService,
    DespatchGuidePdfRendererService,
    DespatchGuidePdfArtifactService,
    BrandingLogoResolverService,
  ],
  exports: [
    PdfArtifactService,
    PdfRendererService,
    SunatQrService,
    DespatchGuideQrService,
    DespatchGuidePdfRendererService,
    DespatchGuidePdfArtifactService,
    BrandingLogoResolverService,
  ],
})
export class PdfModule {}
