import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtAuthGuard } from './jwt-auth.guard';
import { loadConfig } from '../../config/configuration';

@Global()
@Module({
  imports: [
    JwtModule.registerAsync({
      useFactory: () => {
        const config = loadConfig();
        return {
          secret: config.JWT_SECRET,
          // `expiresIn` is typed as a literal duration union by @types/ms; the
          // value is validated as a duration string by the config schema.
          signOptions: { expiresIn: config.JWT_ACCESS_TTL as `${number}${'s' | 'm' | 'h' | 'd'}` },
        };
      },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtAuthGuard],
  exports: [AuthService, JwtAuthGuard, JwtModule],
})
export class AuthModule {}
