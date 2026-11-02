import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
} from 'class-validator';
import { WEBHOOK_EVENT_TYPES } from '../../../../../libs/webhooks/src/webhook.types';

export class CreateWebhookEndpointDto {
  @IsString()
  @MaxLength(500)
  @IsUrl({ protocols: ['https'], require_protocol: true })
  url!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(WEBHOOK_EVENT_TYPES.length)
  @ArrayUnique()
  @IsIn(WEBHOOK_EVENT_TYPES, { each: true })
  events!: string[];
}

export class UpdateWebhookEndpointDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  @IsUrl({ protocols: ['https'], require_protocol: true })
  url?: string;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(WEBHOOK_EVENT_TYPES.length)
  @ArrayUnique()
  @IsIn(WEBHOOK_EVENT_TYPES, { each: true })
  events?: string[];

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
