import { Module } from '@nestjs/common';
import { StorageModule } from '../../../../libs/storage/src/storage.module';
import { CertificateInspectorService } from './certificate-inspector.service';
import { SunatCredentialsController } from './sunat-credentials.controller';
import { SunatCredentialsService } from './sunat-credentials.service';

@Module({
  imports: [StorageModule],
  controllers: [SunatCredentialsController],
  providers: [SunatCredentialsService, CertificateInspectorService],
  exports: [SunatCredentialsService],
})
export class SunatCredentialsModule {}
