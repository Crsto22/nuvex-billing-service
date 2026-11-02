import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { CustomerDocumentType } from '../../documents/dto/create-document.dto';

export class TaxNoteCustomerDto {
  @IsEnum(CustomerDocumentType)
  documentType!: CustomerDocumentType;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  documentNumber?: string | null;
}

export class TaxNoteAdjustmentDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  referenceLineNumber!: number;

  @IsOptional()
  @Matches(/^\d+(\.\d{1,10})?$/)
  quantity?: string | null;

  @Matches(/^\d+(\.\d{1,2})?$/)
  amount!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string | null;
}

export class CreateTaxNoteDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  externalId!: string;

  @IsUUID()
  referenceDocumentId!: string;

  @Matches(/^[FB][A-Z0-9]{3}$/)
  series!: string;

  @IsDateString({ strict: true })
  issueDate!: string;

  @Matches(/^[A-Z]{3}$/)
  currency!: string;

  @Matches(/^\d{2}$/)
  reasonCode!: string;

  @IsString()
  @MinLength(3)
  @MaxLength(250)
  reasonDescription!: string;

  @ValidateNested()
  @Type(() => TaxNoteCustomerDto)
  customer!: TaxNoteCustomerDto;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => TaxNoteAdjustmentDto)
  adjustments!: TaxNoteAdjustmentDto[];
}
