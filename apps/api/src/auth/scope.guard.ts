import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { REQUIRED_SCOPES } from './scope.decorator';
import type { RequestWithPrincipal } from './auth.types';

@Injectable()
export class ScopeGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext) {
    const required = this.reflector.getAllAndOverride<string[]>(
      REQUIRED_SCOPES,
      [context.getHandler(), context.getClass()],
    );
    if (!required?.length) return true;
    const principal = context
      .switchToHttp()
      .getRequest<RequestWithPrincipal>().principal;
    if (
      principal?.type !== 'API_KEY' ||
      !required.every((scope) => principal.scopes.includes(scope))
    ) {
      throw new ForbiddenException('La API key no tiene el alcance requerido');
    }
    return true;
  }
}
