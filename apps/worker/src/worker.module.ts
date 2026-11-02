import { Module } from '@nestjs/common';
import { BillingConfigModule } from '../../../libs/config/src/billing-config.module';
import { DatabaseModule } from '../../../libs/database/src/database.module';
import { SecurityModule } from '../../../libs/security/src/security.module';
import { StorageModule } from '../../../libs/storage/src/storage.module';
import { UblModule } from '../../../libs/ubl/src/ubl.module';
import { SunatModule } from '../../../libs/sunat/src/sunat.module';
import { PdfModule } from '../../../libs/pdf/src/pdf.module';
import { WebhooksModule } from '../../../libs/webhooks/src/webhooks.module';
import { WorkerService } from './worker.service';
import { EmissionJobProcessorService } from './emission-job-processor.service';
import { EmissionJobRepository } from './emission-job.repository';
import { WebhookDeliveryProcessorService } from './webhook-delivery-processor.service';
import { WebhookDeliveryRepository } from './webhook-delivery.repository';
import { WebhookWorkerService } from './webhook-worker.service';
import { SunatVoidJobRepository } from './sunat-void-job.repository';
import { SunatVoidJobProcessorService } from './sunat-void-job-processor.service';
import { SunatVoidWorkerService } from './sunat-void-worker.service';

@Module({
  imports: [
    BillingConfigModule,
    DatabaseModule,
    SecurityModule,
    StorageModule,
    UblModule,
    SunatModule,
    PdfModule,
    WebhooksModule,
  ],
  providers: [
    WorkerService,
    EmissionJobRepository,
    EmissionJobProcessorService,
    WebhookDeliveryRepository,
    WebhookDeliveryProcessorService,
    WebhookWorkerService,
    SunatVoidJobRepository,
    SunatVoidJobProcessorService,
    SunatVoidWorkerService,
  ],
})
export class WorkerModule {}
