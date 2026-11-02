import { Module } from '@nestjs/common';
import { AuthenticationGuard } from './authentication.guard';
import { MeController } from './me.controller';

@Module({
  controllers: [MeController],
  providers: [AuthenticationGuard],
  exports: [AuthenticationGuard],
})
export class AuthModule {}
