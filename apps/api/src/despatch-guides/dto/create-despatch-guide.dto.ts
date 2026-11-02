import { DespatchGuideStatus, DespatchTransportMode } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsDefined,
  IsEnum,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

export enum DespatchPartyDocumentType {
  DNI = 'DNI',
  FOREIGN_ID = 'FOREIGN_ID',
  RUC = 'RUC',
  PASSPORT = 'PASSPORT',
}

export enum SunatWeightUnit {
  KILOGRAM = 'KGM',
  METRIC_TON = 'TNE',
}

export class DespatchRecipientDto {
  @IsEnum(DespatchPartyDocumentType)
  documentType!: DespatchPartyDocumentType;

  @IsString()
  @MinLength(1)
  @MaxLength(20)
  documentNumber!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  address?: string | null;

  @IsOptional()
  @Matches(/^\d{6}$/)
  ubigeo?: string | null;
}

export class DespatchAddressDto {
  @Matches(/^\d{6}$/)
  ubigeo!: string;

  @IsString()
  @MinLength(3)
  @MaxLength(255)
  address!: string;
}

export class DespatchCarrierDto {
  @Matches(/^\d{11}$/)
  ruc!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(200)
  legalName!: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  mtcRegistrationNumber?: string | null;
}

export class DespatchVehicleDto {
  @Matches(/^[A-Z0-9-]{5,10}$/)
  plate!: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  brand?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  authorizationNumber?: string | null;

  @IsBoolean()
  primary!: boolean;
}

export class DespatchDriverDto {
  @IsEnum(DespatchPartyDocumentType)
  documentType!: DespatchPartyDocumentType;

  @IsString()
  @MinLength(1)
  @MaxLength(20)
  documentNumber!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  firstNames!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  lastNames!: string;

  @IsString()
  @MinLength(5)
  @MaxLength(30)
  licenseNumber!: string;

  @IsBoolean()
  primary!: boolean;
}

export class DespatchItemDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  externalId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  sku?: string | null;

  @IsString()
  @MinLength(1)
  @MaxLength(500)
  description!: string;

  @Matches(/^\d+(\.\d{1,10})?$/)
  quantity!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(10)
  unitCode!: string;
}

export class RelatedDespatchDocumentDto {
  @Matches(/^\d{2}$/)
  documentType!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  number!: string;
}

export class CreateDespatchGuideDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  externalId!: string;

  @Matches(/^T[A-Z0-9]{3}$/)
  series!: string;

  @IsDateString({ strict: true })
  issueDate!: string;

  @IsDateString({ strict: true })
  transferStartDate!: string;

  @IsOptional()
  @IsDateString({ strict: true })
  carrierDeliveryDate?: string | null;

  @Matches(/^\d{2}$/)
  transferReasonCode!: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  transferReasonDescription?: string | null;

  @IsEnum(DespatchTransportMode)
  transportMode!: DespatchTransportMode;

  @Matches(/^\d{1,12}(\.\d{1,3})?$/)
  grossWeight!: string;

  @IsOptional()
  @IsEnum(SunatWeightUnit)
  weightUnit = SunatWeightUnit.KILOGRAM;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1_000_000)
  packageCount?: number | null;

  @ValidateNested()
  @IsDefined()
  @Type(() => DespatchRecipientDto)
  recipient!: DespatchRecipientDto;

  @ValidateNested()
  @IsDefined()
  @Type(() => DespatchAddressDto)
  departure!: DespatchAddressDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => DespatchAddressDto)
  arrival?: DespatchAddressDto | null;

  @IsOptional()
  @ValidateNested()
  @Type(() => DespatchCarrierDto)
  carrier?: DespatchCarrierDto | null;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => DespatchVehicleDto)
  vehicles?: DespatchVehicleDto[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => DespatchDriverDto)
  drivers?: DespatchDriverDto[];

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => DespatchItemDto)
  items!: DespatchItemDto[];

  @IsOptional()
  @ValidateNested()
  @Type(() => RelatedDespatchDocumentDto)
  relatedDocument?: RelatedDespatchDocumentDto | null;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, string | number | boolean | null>;
}

export class CancelDespatchGuideDto {
  @IsString()
  @MinLength(3)
  @MaxLength(250)
  reason!: string;
}

export class ListDespatchGuidesQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  externalId?: string;

  @IsOptional()
  @IsEnum(DespatchGuideStatus)
  status?: DespatchGuideStatus;

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
