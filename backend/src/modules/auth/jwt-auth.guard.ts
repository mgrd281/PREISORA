import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Request } from 'express';
import { AppException } from '../../common/errors/app-exception';
import { TokenService } from './token.service';

export interface AuthenticatedRequest extends Request {
  authUserId?: string;
}

/**
 * Bearer-JWT guard for every user-scoped operation. Any failure is the platform's
 * `UNAUTHORIZED` envelope — never a framework-shaped 401 body.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly tokens: TokenService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const claims = this.tokens.tryVerifyAccessToken(request.header('authorization'));
    if (!claims?.sub) {
      throw new AppException('UNAUTHORIZED');
    }
    request.authUserId = claims.sub;
    return true;
  }
}

/**
 * Same resolution, but a missing/invalid token is not fatal. Used by
 * `POST /auth/register`, where an anonymous bearer token UPGRADES the existing
 * account instead of creating a second one.
 */
@Injectable()
export class OptionalJwtAuthGuard implements CanActivate {
  constructor(private readonly tokens: TokenService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const claims = this.tokens.tryVerifyAccessToken(request.header('authorization'));
    if (claims?.sub) request.authUserId = claims.sub;
    return true;
  }
}
