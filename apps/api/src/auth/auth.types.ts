import type { Environment } from '@prisma/client';
import type { RequestWithId } from '../common/request-id.middleware';

export type PlatformAdminPrincipal = {
  type: 'PLATFORM_ADMIN';
};

export type ApplicationPrincipal = {
  type: 'API_KEY';
  apiKeyId: string;
  applicationId: string;
  tenantId: string;
  environment: Environment;
  scopes: string[];
};

export type AuthPrincipal = PlatformAdminPrincipal | ApplicationPrincipal;
export type RequestWithPrincipal = RequestWithId & {
  principal: AuthPrincipal;
};
