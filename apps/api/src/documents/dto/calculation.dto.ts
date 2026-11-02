import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { DocumentType } from '@prisma/client';
import { TAX_AFFECTATIONS } from '../tax-engine.policy';

export enum DiscountKind {
  PERCENTAGE = 'PERCENTAGE',
  AMOUNT = 'AMOUNT',
}

export class DiscountDto {
  @IsEnum(DiscountKind)
  kind!: DiscountKind;

  @Matches(/^\d+(\.\d{1,10})?$/)
  value!: string;
}

export class DocumentLineDto {
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

  @Matches(/^\d+(\.\d{1,10})?$/)
  unitPrice!: string;

  @IsBoolean()
  unitPriceIncludesTax!: boolean;

  @IsIn(Object.keys(TAX_AFFECTATIONS))
  taxAffectationCode!: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => DiscountDto)
  discount?: DiscountDto | null;
}

export class CalculationDto {
  @IsIn([DocumentType.INVOICE, DocumentType.RECEIPT])
  documentType!: DocumentType;

  @Matches(/^[A-Z]{3}$/)
  currency!: string;

  @IsOptional()
  @Matches(/^\d+(\.\d{1,4})?$/)
  taxRate?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => DiscountDto)
  globalDiscount?: DiscountDto | null;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => DocumentLineDto)
  lines!: DocumentLineDto[];
}
