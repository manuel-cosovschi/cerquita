import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { AdminRole, StoreRole } from '@cerquita/types';

/**
 * The authenticated caller, resolved from the access token by `JwtAuthGuard`.
 *
 * `storeRoles` is loaded with the request so authorization checks never take the
 * caller's word for which stores they belong to.
 */
export interface AuthenticatedUser {
  readonly userId: string;
  readonly username: string;
  readonly storeRoles: Record<string, StoreRole>;
  readonly adminRole?: AdminRole;
}

export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthenticatedUser | undefined => {
    const request = context.switchToHttp().getRequest<{ user?: AuthenticatedUser }>();
    return request.user;
  },
);
