import { Module } from '@nestjs/common';
import { StorageModule } from '../../../../libs/storage/src/storage.module';
import { ArtifactDownloadController } from './artifact-download.controller';
import { ArtifactDownloadService } from './artifact-download.service';
import { CalculationsController } from './calculations.controller';
import { DocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';
import { FiscalSetupController } from './fiscal-setup.controller';
import { TaxCalculatorService } from './tax-calculator.service';

@Module({
  imports: [StorageModule],
  controllers: [
    ArtifactDownloadController,
    CalculationsController,
    DocumentsController,
    FiscalSetupController,
  ],
  providers: [ArtifactDownloadService, DocumentsService, TaxCalculatorService],
  exports: [DocumentsService, TaxCalculatorService],
})
export class DocumentsModule {}
