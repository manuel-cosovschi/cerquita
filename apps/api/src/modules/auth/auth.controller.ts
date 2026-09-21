import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { loginSchema, refreshSchema, registerSchema } from '@cerquita/validation';
import { AuthService, type AuthTokens } from './auth.service';
import { zodBody } from '../../common/zod-validation.pipe';
import { CurrentUser, type AuthenticatedUser } from '../../common/current-user.decorator';
import { Public } from './jwt-auth.guard';
import { Throttle } from '@nestjs/throttler';

/**
 * Credential endpoints get their own budget.
 *
 * The global limit is sized for a person using the app; this one is sized for
 * a person typing a password. Ten attempts a minute is generous for someone who
 * forgot theirs and useless for credential stuffing, which is the actual threat
 * to a login route.
 */
const CREDENTIAL_LIMIT = { short: { ttl: 60_000, limit: 10 } };

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Throttle(CREDENTIAL_LIMIT)
  @Post('register')
  register(@Body(zodBody(registerSchema)) body: unknown): Promise<AuthTokens> {
    return this.auth.register(body as Parameters<AuthService['register']>[0]);
  }

  @Public()
  @Throttle(CREDENTIAL_LIMIT)
  @Post('login')
  @HttpCode(200)
  login(@Body(zodBody(loginSchema)) body: unknown): Promise<AuthTokens> {
    return this.auth.login(body as Parameters<AuthService['login']>[0]);
  }

  // Refresh is not a guessing target — the token is already a secret — but it is
  // an unauthenticated route, so it keeps a bound.
  @Public()
  @Throttle({ short: { ttl: 60_000, limit: 30 } })
  @Post('refresh')
  @HttpCode(200)
  refresh(@Body(zodBody(refreshSchema)) body: { refreshToken: string }): Promise<AuthTokens> {
    return this.auth.refresh(body.refreshToken);
  }

  @Public()
  @Post('logout')
  @HttpCode(204)
  async logout(@Body(zodBody(refreshSchema)) body: { refreshToken: string }): Promise<void> {
    await this.auth.logout(body.refreshToken);
  }

  /** Echoes the resolved identity — used by clients to bootstrap after a refresh. */
  @Get('me')
  me(@CurrentUser() user: AuthenticatedUser): AuthenticatedUser {
    return user;
  }
}
