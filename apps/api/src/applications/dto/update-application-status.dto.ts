import { ApplicationStatus } from '@prisma/client';
import { IsEnum } from 'class-validator';

export class UpdateApplicationStatusDto {
  @IsEnum(ApplicationStatus)
  status!: ApplicationStatus;
}
