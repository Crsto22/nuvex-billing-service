import { Module } from '@nestjs/common';
import { SunatModule } from '../../../../libs/sunat/src/sunat.module';
import { VoidRequestsController } from './void-requests.controller';
import { VoidRequestsService } from './void-requests.service';

@Module({
  imports: [SunatModule],
  controllers: [VoidRequestsController],
  providers: [VoidRequestsService],
  exports: [VoidRequestsService],
})
export class VoidRequestsModule {}
