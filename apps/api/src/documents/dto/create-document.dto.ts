import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsDateString,
  IsDefined,
  IsEmail,
  IsEnum,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Max,
  Min,
  MinLength,
  IsUUID,
  ValidateNested,
} from 'class-validator';
import { PaymentMethod } from '@prisma/client';
import { CalculationDto } from './calculation.dto';

export enum CustomerDocumentType {
  NONE = 'NONE',
  DNI = 'DNI',
  FOREIGN_ID = 'FOREIGN_ID',
  RUC = 'RUC',
  PASSPORT = 'PASSPORT',
  DIPLOMATIC_ID = 'DIPLOMATIC_ID',
}

export class CustomerDto {
  @IsEnum(CustomerDocumentType)
  documentType!: CustomerDocumentType;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  documentNumber?: string | null;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  address?: string | null;

  @IsOptional()
  @IsEmail()
  @MaxLength(254)
  email?: string | null;
}

export class InstallmentDto {
  @IsInt()
  @Min(1)
  number!: number;

  @Matches(/^\d+(\.\d{1,2})?$/)
  amount!: string;

  @IsDateString({ strict: true })
  dueDate!: string;
}

export class PaymentTermsDto {
  @IsEnum(PaymentMethod)
  method!: PaymentMethod;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => InstallmentDto)
  installments?: InstallmentDto[];
}

export class ExpectedTotalsDto {
  @Matches(/^\d+(\.\d{1,2})?$/)
  taxable!: string;
  @Matches(/^\d+(\.\d{1,2})?$/)
  exempt!: string;
  @Matches(/^\d+(\.\d{1,2})?$/)
  unaffected!: string;
  @Matches(/^\d+(\.\d{1,2})?$/)
  tax!: string;
  @Matches(/^\d+(\.\d{1,2})?$/)
  total!: string;
}

export class CreateDocumentDto extends CalculationDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  externalId!: string;

  @Matches(/^[FB][A-Z0-9]{3}$/)
  series!: string;

  @IsDateString({ strict: true })
  issueDate!: string;

  @IsOptional()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d:[0-5]\d$/)
  issueTime?: string | null;

  @IsString()
  @MinLength(1)
  @MaxLength(10)
  establishmentCode!: string;

  @ValidateNested()
  @IsDefined()
  @Type(() => CustomerDto)
  customer!: CustomerDto;

  @ValidateNested()
  @IsDefined()
  @Type(() => PaymentTermsDto)
  paymentTerms!: PaymentTermsDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => ExpectedTotalsDto)
  expectedTotals?: ExpectedTotalsDto | null;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string | null;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, string | number | boolean | null>;
}

export class ListDocumentsQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  externalId?: string;

  @IsOptional()
  @IsIn([
    'RECEIVED',
    'VALIDATING',
    'QUEUED',
    'PROCESSING',
    'ACCEPTED',
    'ACCEPTED_WITH_OBSERVATIONS',
    'REJECTED',
    'RETRY_SCHEDULED',
    'FAILED',
  ])
  status?: string;

  @IsOptional()
  @IsUUID()
  cursor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 20;
}
