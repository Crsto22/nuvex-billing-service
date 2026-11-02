import { Module } from '@nestjs/common';
import { WebhooksModule } from '../../webhooks/src/webhooks.module';
import { StorageModule } from '../../storage/src/storage.module';
import { SunatCdrParserService } from './sunat-cdr-parser.service';
import { SunatSoapClientService } from './sunat-soap-client.service';
import { SunatSubmissionService } from './sunat-submission.service';
import { UblModule } from '../../ubl/src/ubl.module';
import { SunatDailySummaryService } from './sunat-daily-summary.service';
import { DespatchGuideCdrService } from './despatch-guide-cdr.service';

@Module({
  imports: [StorageModule, WebhooksModule, UblModule],
  providers: [
    SunatSoapClientService,
    SunatCdrParserService,
    SunatSubmissionService,
    SunatDailySummaryService,
    DespatchGuideCdrService,
  ],
  exports: [
    SunatSubmissionService,
    SunatDailySummaryService,
    DespatchGuideCdrService,
  ],
})
export class SunatModule {}
