import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Public } from '../auth/jwt-auth.guard';

/**
 * Liveness and readiness (spec §93).
 *
 * `/health` answers "is the process up" and must never touch a dependency —
 * otherwise a database blip restarts healthy pods. `/ready` answers "can it
 * serve traffic" and does check the database, so a starting instance is kept out
 * of the load balancer until it can actually answer.
 */
@Controller()
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Public()
  @Get('health')
  health(): { status: 'ok'; uptime: number } {
    return { status: 'ok', uptime: Math.round(process.uptime()) };
  }

  @Public()
  @Get('ready')
  async ready(): Promise<{ status: 'ready'; checks: Record<string, string> }> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      throw new ServiceUnavailableException({
        status: 'not_ready',
        checks: { database: 'unreachable' },
      });
    }
    return { status: 'ready', checks: { database: 'ok' } };
  }
}
