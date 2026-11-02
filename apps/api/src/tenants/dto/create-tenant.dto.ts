import {
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateTenantDto {
  @Matches(/^\d{11}$/)
  ruc!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(200)
  legalName!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  tradeName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  address?: string;

  @IsOptional()
  @Matches(/^\d{6}$/)
  ubigeo?: string;
}
