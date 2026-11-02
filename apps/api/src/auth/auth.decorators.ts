import {
  createParamDecorator,
  ExecutionContext,
  SetMetadata,
} from '@nestjs/common';
import { IS_PLATFORM_ADMIN_ROUTE, IS_PUBLIC_ROUTE } from './auth.constants';
import type { RequestWithPrincipal } from './auth.types';

export const Public = () => SetMetadata(IS_PUBLIC_ROUTE, true);
export const PlatformAdmin = () => SetMetadata(IS_PLATFORM_ADMIN_ROUTE, true);

export const CurrentPrincipal = createParamDecorator(
  (_data: unknown, context: ExecutionContext) =>
    context.switchToHttp().getRequest<RequestWithPrincipal>().principal,
);
