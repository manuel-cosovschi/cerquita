import { Injectable, type ExecutionContext } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import type { Request } from 'express';

/**
 * Rate limiting (spec §95).
 *
 * Two things this does that the stock guard does not:
 *
 * 1. It keys authenticated requests by USER ID rather than by IP. Everyone
 *    behind one office NAT or one mobile carrier shares an address, so an IP
 *    bucket punishes a neighbourhood for one person's behaviour — which in a
 *    hyperlocal marketplace is exactly the population that shares an IP.
 * 2. It reads `x-forwarded-for` only when the app is explicitly behind a proxy.
 *    Trusting that header unconditionally makes the limit trivially bypassable:
 *    a caller just sends a different value on each request.
 */
@Injectable()
export class UserAwareThrottlerGuard extends ThrottlerGuard {
  protected override async getTracker(req: Record<string, unknown>): Promise<string> {
    const request = req as unknown as Request & {
      user?: { userId?: string };
      body?: { email?: unknown };
    };

    // A signed-in caller is identified, so the limit follows the account. This
    // also means logging out does not reset somebody's budget.
    const userId = request.user?.userId;
    if (userId) return `user:${userId}`;

    /*
     * Credential routes are keyed by the ACCOUNT being attempted, not only by
     * address. A shared office or a mobile carrier is one IP for hundreds of
     * people, and an IP-wide login budget locks all of them out because one
     * mistyped a password — in a hyperlocal marketplace, neighbours sharing an
     * IP is the normal case, not the edge one.
     *
     * Rotating emails from one address does not escape the limit: the global
     * medium and long windows still bound total volume per IP, so this narrows
     * who gets punished without widening what gets through.
     */
    const email = typeof request.body?.email === 'string' ? request.body.email : undefined;
    if (email && isCredentialRoute(request.path)) {
      return `cred:${email.trim().toLowerCase()}:${clientIp(request)}`;
    }

    return `ip:${clientIp(request)}`;
  }

  /**
   * Health checks are excluded.
   *
   * A load balancer polls `/health` far more often than any human clicks, and
   * throttling it would take the service out of rotation for looking healthy
   * too enthusiastically.
   */
  protected override async shouldSkip(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    return request.path.endsWith('/health') || request.path.endsWith('/ready');
  }
}

function isCredentialRoute(path: string): boolean {
  return path.endsWith('/auth/login') || path.endsWith('/auth/register');
}

/**
 * The caller's address.
 *
 * `TRUST_PROXY` must be set deliberately: behind a load balancer the socket
 * address is the balancer's and the real client is in `x-forwarded-for`, but
 * without a proxy that header is attacker-supplied and using it would let
 * anyone mint a fresh rate-limit bucket per request.
 */
function clientIp(request: Request): string {
  if (process.env.TRUST_PROXY === 'true') {
    const forwarded = request.headers['x-forwarded-for'];
    const first = Array.isArray(forwarded) ? forwarded[0] : forwarded?.split(',')[0];
    if (first?.trim()) return first.trim();
  }
  return request.ip ?? request.socket.remoteAddress ?? 'unknown';
}
