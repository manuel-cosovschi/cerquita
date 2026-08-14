import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import {
  loginSchema,
  refreshSchema,
  registerSchema,
} from '@cerquita/validation';
import { AuthService, type AuthTokens } from './auth.service';
import { zodBody } from '../../common/zod-validation.pipe';
import { CurrentUser, type AuthenticatedUser } from '../../common/current-user.decorator';
import { Public } from './jwt-auth.guard';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('register')
  register(@Body(zodBody(registerSchema)) body: unknown): Promise<AuthTokens> {
    return this.auth.register(body as Parameters<AuthService['register']>[0]);
  }

  @Public()
  @Post('login')
  @HttpCode(200)
  login(@Body(zodBody(loginSchema)) body: unknown): Promise<AuthTokens> {
    return this.auth.login(body as Parameters<AuthService['login']>[0]);
  }

  @Public()
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
