import {
  IsBoolean,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class UpdateSunatCredentialDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  solUsername?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  solPassword?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(300)
  clientId?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  clientSecret?: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
