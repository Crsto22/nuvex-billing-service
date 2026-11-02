import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateTaxDocumentVoidRequestDto {
  @IsString()
  @MinLength(3)
  @MaxLength(100)
  reason!: string;

  @IsBoolean()
  documentDelivered!: boolean;
}

export class CreateGreVoidRequestDto {
  @IsString()
  @MinLength(3)
  @MaxLength(100)
  reason!: string;

  @IsBoolean()
  transferStarted!: boolean;

  @IsBoolean()
  recipientChanged!: boolean;
}

export class ConfirmGreVoidRequestDto {
  @IsIn(['ACCEPTED', 'REJECTED'])
  result!: 'ACCEPTED' | 'REJECTED';

  @IsString()
  @MinLength(3)
  @MaxLength(100)
  solReference!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}
