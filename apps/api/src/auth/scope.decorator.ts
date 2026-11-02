import { SetMetadata } from '@nestjs/common';

export const REQUIRED_SCOPES = 'required-scopes';
export const RequireScopes = (...scopes: string[]) =>
  SetMetadata(REQUIRED_SCOPES, scopes);
