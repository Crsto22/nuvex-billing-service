import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../../../../libs/database/src/prisma.service';
import { TokenHashService } from '../../../../libs/security/src/token-hash.service';
import { IS_PLATFORM_ADMIN_ROUTE, IS_PUBLIC_ROUTE } from './auth.constants';
import type { RequestWithPrincipal } from './auth.types';

@Injectable()
export class AuthenticationGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly tokenHash: TokenHashService,
  ) {}

  async canActivate(context: ExecutionContext) {
    if (
      this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_ROUTE, [
        context.getHandler(),
        context.getClass(),
      ])
    ) {
      return true;
    }

    const request = context.switchToHttp().getRequest<RequestWithPrincipal>();
    const token = this.bearerToken(request.headers.authorization);
    const platformAdmin = this.reflector.getAllAndOverride<boolean>(
      IS_PLATFORM_ADMIN_ROUTE,
      [context.getHandler(), context.getClass()],
    );

    if (platformAdmin) {
      const expected = this.config.getOrThrow<string>('PLATFORM_ADMIN_KEY');
      if (!this.tokenHash.verify(token, this.tokenHash.hash(expected))) {
        throw new UnauthorizedException('Credencial administrativa inválida');
      }
      request.principal = { type: 'PLATFORM_ADMIN' };
      return true;
    }

    const prefix = token.split('.', 1)[0];
    if (!/^nb_(test|live)_[A-Za-z0-9_-]{10,20}$/.test(prefix)) {
      throw new UnauthorizedException('API key inválida');
    }

    const apiKey = await this.prisma.apiKey.findUnique({
      where: { prefix },
      include: { application: { include: { tenant: true } } },
    });
    if (
      !apiKey ||
      apiKey.revokedAt ||
      (apiKey.expiresAt && apiKey.expiresAt <= new Date()) ||
      apiKey.application.status !== 'ACTIVE' ||
      apiKey.application.tenant.status !== 'ACTIVE' ||
      !this.tokenHash.verify(token, apiKey.secretHash)
    ) {
      throw new UnauthorizedException('API key inválida o inactiva');
    }

    const expectedMarker = apiKey.environment === 'BETA' ? 'test' : 'live';
    if (!prefix.startsWith(`nb_${expectedMarker}_`)) {
      throw new UnauthorizedException('API key inválida');
    }

    request.principal = {
      type: 'API_KEY',
      apiKeyId: apiKey.id,
      applicationId: apiKey.applicationId,
      tenantId: apiKey.application.tenantId,
      environment: apiKey.environment,
      scopes: apiKey.scopes,
    };
    await this.prisma.apiKey.update({
      where: { id: apiKey.id },
      data: { lastUsedAt: new Date() },
    });
    return true;
  }

  private bearerToken(header?: string) {
    const [scheme, token, extra] = header?.trim().split(/\s+/) ?? [];
    if (scheme !== 'Bearer' || !token || extra) {
      throw new UnauthorizedException('Se requiere Authorization: Bearer');
    }
    return token;
  }
}
