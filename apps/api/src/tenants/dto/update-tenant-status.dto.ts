import { TenantStatus } from '@prisma/client';
import { IsEnum } from 'class-validator';

export class UpdateTenantStatusDto {
  @IsEnum(TenantStatus)
  status!: TenantStatus;
}
