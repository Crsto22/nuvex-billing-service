import { Module } from '@nestjs/common';
import { DespatchGuidesController } from './despatch-guides.controller';
import { DespatchGuidesService } from './despatch-guides.service';
import { UblModule } from '../../../../libs/ubl/src/ubl.module';
import { SunatModule } from '../../../../libs/sunat/src/sunat.module';
import { PdfModule } from '../../../../libs/pdf/src/pdf.module';

@Module({
  imports: [UblModule, SunatModule, PdfModule],
  controllers: [DespatchGuidesController],
  providers: [DespatchGuidesService],
})
export class DespatchGuidesModule {}
