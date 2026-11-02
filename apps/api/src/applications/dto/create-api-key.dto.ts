import { Environment } from '@prisma/client';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsIn,
  IsISO8601,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export const API_KEY_SCOPES = [
  'calculations:write',
  'documents:read',
  'documents:write',
  'webhooks:manage',
] as const;

export class CreateApiKeyDto {
  @IsString()
  @MaxLength(120)
  name!: string;

  @IsEnum(Environment)
  environment!: Environment;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(API_KEY_SCOPES.length)
  @IsIn(API_KEY_SCOPES, { each: true })
  scopes!: string[];

  @IsOptional()
  @IsISO8601({ strict: true })
  expiresAt?: string;
}
