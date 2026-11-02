import { Module } from '@nestjs/common';
import { StorageModule } from '../../storage/src/storage.module';
import { UblArtifactService } from './ubl-artifact.service';
import { UblInvoiceBuilderService } from './ubl-invoice-builder.service';
import { XmlSignatureService } from './xml-signature.service';
import { UblDailySummaryBuilderService } from './ubl-daily-summary-builder.service';
import { UblNoteBuilderService } from './ubl-note-builder.service';
import { UblDespatchAdviceBuilderService } from './ubl-despatch-advice-builder.service';
import { DespatchGuideArtifactService } from './despatch-guide-artifact.service';
import { UblVoidedDocumentsBuilderService } from './ubl-voided-documents-builder.service';

@Module({
  imports: [StorageModule],
  providers: [
    UblArtifactService,
    UblInvoiceBuilderService,
    XmlSignatureService,
    UblDailySummaryBuilderService,
    UblNoteBuilderService,
    UblDespatchAdviceBuilderService,
    DespatchGuideArtifactService,
    UblVoidedDocumentsBuilderService,
  ],
  exports: [
    UblArtifactService,
    UblInvoiceBuilderService,
    UblDailySummaryBuilderService,
    UblNoteBuilderService,
    XmlSignatureService,
    UblDespatchAdviceBuilderService,
    DespatchGuideArtifactService,
    UblVoidedDocumentsBuilderService,
  ],
})
export class UblModule {}
