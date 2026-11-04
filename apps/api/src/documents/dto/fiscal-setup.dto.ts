import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsString,
  IsUUID,
  IsOptional,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { DocumentType, Environment } from '@prisma/client';

export class CreateEstablishmentDto {
  @IsString()
  @MinLength(1)
  @MaxLength(10)
  code!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name!: string;

  @IsString()
  @MinLength(3)
  @MaxLength(255)
  address!: string;

  @Matches(/^\d{6}$/)
  ubigeo!: string;
}

export class CreateFiscalSeriesDto {
  @IsUUID()
  applicationId!: string;

  @IsUUID()
  establishmentId!: string;

  @IsEnum(Environment)
  environment!: Environment;

  @IsEnum(DocumentType)
  documentType!: DocumentType;

  @Matches(/^[FBT][A-Z0-9]{3}$/)
  series!: string;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(99_999_999)
  initialNumber = 0;
}

export class UpdateFiscalSeriesAssignmentDto {
  @IsUUID()
  applicationId!: string;

  @IsUUID()
  establishmentId!: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(99_999_999)
  minimumNumber?: number;
}
