import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { createHash, randomBytes } from 'node:crypto';
import type { AdminRole, StoreRole } from '@cerquita/types';
import { PrismaService } from '../../prisma/prisma.service';
import { loadConfig } from '../../config/configuration';

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface AccessTokenClaims {
  sub: string;
  username: string;
}

/**
 * Sessions and credentials.
 *
 * Refresh tokens are stored only as SHA-256 hashes, so a database leak does not
 * hand an attacker usable sessions. Rotation is mandatory: using a refresh token
 * revokes it and issues a new one.
 */
@Injectable()
export class AuthService {
  private readonly config = loadConfig();

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  async register(input: {
    email: string;
    password: string;
    username: string;
    displayName: string;
  }): Promise<AuthTokens> {
    const existing = await this.prisma.user.findFirst({
      where: { OR: [{ email: input.email }, { username: input.username }] },
      select: { id: true, email: true },
    });

    if (existing) {
      throw new ConflictException({
        message:
          existing.email === input.email
            ? 'Ya existe una cuenta con ese email'
            : 'Ese nombre de usuario no está disponible',
        code: 'account_exists',
      });
    }

    const user = await this.prisma.user.create({
      data: {
        email: input.email,
        username: input.username,
        displayName: input.displayName,
        passwordHash: await this.hashPassword(input.password),
      },
      select: { id: true, username: true },
    });

    return this.issueTokens(user.id, user.username);
  }

  async login(input: {
    email: string;
    password: string;
    deviceName?: string;
  }): Promise<AuthTokens> {
    const user = await this.prisma.user.findUnique({
      where: { email: input.email },
      select: { id: true, username: true, passwordHash: true, bannedAt: true },
    });

    // Verify against a real decoy hash when the account is missing, so the
    // response time does not reveal whether the email is registered.
    const hash = user?.passwordHash ?? (await decoyHash());
    const valid = await argon2.verify(hash, input.password).catch(() => false);

    if (!user || !user.passwordHash || !valid) {
      throw new UnauthorizedException({
        message: 'Email o contraseña incorrectos',
        code: 'invalid_credentials',
      });
    }
    if (user.bannedAt) {
      throw new UnauthorizedException({
        message: 'Esta cuenta está suspendida',
        code: 'account_banned',
      });
    }

    return this.issueTokens(user.id, user.username, input.deviceName);
  }

  /** Rotates a refresh token. The presented token is revoked whether or not it wins. */
  async refresh(refreshToken: string): Promise<AuthTokens> {
    const tokenHash = hashToken(refreshToken);

    const session = await this.prisma.session.findUnique({
      where: { tokenHash },
      select: {
        id: true,
        userId: true,
        expiresAt: true,
        revokedAt: true,
        deviceName: true,
        user: { select: { username: true, bannedAt: true } },
      },
    });

    if (!session || session.revokedAt || session.expiresAt < new Date()) {
      throw new UnauthorizedException({
        message: 'Tu sesión expiró. Iniciá sesión de nuevo.',
        code: 'session_expired',
      });
    }
    if (session.user.bannedAt) {
      throw new UnauthorizedException({ message: 'Cuenta suspendida', code: 'account_banned' });
    }

    await this.prisma.session.update({
      where: { id: session.id },
      data: { revokedAt: new Date() },
    });

    return this.issueTokens(session.userId, session.user.username, session.deviceName ?? undefined);
  }

  async logout(refreshToken: string): Promise<void> {
    await this.prisma.session.updateMany({
      where: { tokenHash: hashToken(refreshToken), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  /** Revokes every session for a user — used on password change and by admins. */
  async revokeAllSessions(userId: string): Promise<void> {
    await this.prisma.session.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  /**
   * Resolves the request-scoped identity, including store memberships and admin
   * role. These come from the database on every request rather than from the
   * token, so revoking a role takes effect immediately.
   */
  async resolveIdentity(userId: string): Promise<{
    userId: string;
    username: string;
    storeRoles: Record<string, StoreRole>;
    adminRole?: AdminRole;
  } | null> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        username: true,
        adminRole: true,
        bannedAt: true,
        suspendedUntil: true,
        stores: { select: { storeId: true, role: true } },
      },
    });

    if (!user || user.bannedAt) return null;
    if (user.suspendedUntil && user.suspendedUntil > new Date()) return null;

    const storeRoles: Record<string, StoreRole> = {};
    for (const membership of user.stores) {
      storeRoles[membership.storeId] = membership.role as StoreRole;
    }

    return {
      userId: user.id,
      username: user.username,
      storeRoles,
      adminRole: (user.adminRole as AdminRole | null) ?? undefined,
    };
  }

  verifyAccessToken(token: string): AccessTokenClaims {
    try {
      return this.jwt.verify<AccessTokenClaims>(token);
    } catch {
      throw new UnauthorizedException({ message: 'Token inválido', code: 'invalid_token' });
    }
  }

  private async issueTokens(
    userId: string,
    username: string,
    deviceName?: string,
  ): Promise<AuthTokens> {
    const accessToken = this.jwt.sign({ sub: userId, username });

    const refreshToken = randomBytes(48).toString('base64url');
    const expiresAt = new Date(
      Date.now() + this.config.JWT_REFRESH_TTL_DAYS * 24 * 60 * 60 * 1000,
    );

    await this.prisma.session.create({
      data: {
        userId,
        tokenHash: hashToken(refreshToken),
        deviceName,
        expiresAt,
      },
    });

    return { accessToken, refreshToken, expiresIn: parseTtlSeconds(this.config.JWT_ACCESS_TTL) };
  }

  private hashPassword(password: string): Promise<string> {
    // argon2id with parameters that stay under ~100ms on commodity hardware.
    return argon2.hash(password, {
      type: argon2.argon2id,
      memoryCost: 19_456,
      timeCost: 2,
      parallelism: 1,
    });
  }
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function parseTtlSeconds(ttl: string): number {
  const match = /^(\d+)([smhd])$/.exec(ttl);
  if (!match) return 900;
  const value = Number(match[1]);
  const unit = match[2];
  const multipliers: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86_400 };
  return value * (multipliers[unit as string] ?? 60);
}

/**
 * A genuine argon2 hash of a random secret, verified against when the account
 * does not exist. It must be real: verifying a malformed hash fails fast and
 * would reintroduce exactly the timing difference this is here to remove.
 *
 * Computed once, lazily, and reused.
 */
let decoyHashPromise: Promise<string> | undefined;

function decoyHash(): Promise<string> {
  decoyHashPromise ??= argon2.hash(randomBytes(32).toString('hex'), {
    type: argon2.argon2id,
    memoryCost: 19_456,
    timeCost: 2,
    parallelism: 1,
  });
  return decoyHashPromise;
}
