import {
  CanActivate,
  ExecutionContext,
  Injectable,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { AuthService } from './auth.service';
import type { AuthenticatedUser } from '../../common/current-user.decorator';

export const IS_PUBLIC_KEY = 'isPublic';
/** Marks a route as reachable without a token. */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

export const ALLOW_ANONYMOUS_KEY = 'allowAnonymous';
/**
 * Marks a route that works either way: it attaches the user when a valid token
 * is present, and still serves anonymous callers. Used by listing and map
 * endpoints, where a signed-in viewer sees social prices and a guest does not.
 */
export const OptionalAuth = () => SetMetadata(ALLOW_ANONYMOUS_KEY, true);

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly auth: AuthService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets);
    if (isPublic) return true;

    const allowAnonymous = this.reflector.getAllAndOverride<boolean>(ALLOW_ANONYMOUS_KEY, targets);

    const request = context.switchToHttp().getRequest<Request & { user?: AuthenticatedUser }>();
    const token = extractBearerToken(request);

    if (!token) {
      if (allowAnonymous) return true;
      throw new UnauthorizedException({
        message: 'Necesitás iniciar sesión',
        code: 'unauthenticated',
      });
    }

    let claims;
    try {
      claims = this.auth.verifyAccessToken(token);
    } catch (error) {
      // A malformed token on an optional route is treated as "no token" rather
      // than an error, so a stale token in a client does not break browsing.
      if (allowAnonymous) return true;
      throw error;
    }

    const identity = await this.auth.resolveIdentity(claims.sub);
    if (!identity) {
      if (allowAnonymous) return true;
      throw new UnauthorizedException({
        message: 'Tu cuenta no está disponible',
        code: 'account_unavailable',
      });
    }

    request.user = identity;
    return true;
  }
}

function extractBearerToken(request: Request): string | undefined {
  const header = request.header('authorization');
  if (!header) return undefined;
  const [scheme, value] = header.split(' ');
  return scheme?.toLowerCase() === 'bearer' && value ? value : undefined;
}
