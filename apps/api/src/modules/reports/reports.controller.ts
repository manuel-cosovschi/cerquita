import { Body, Controller, Post } from '@nestjs/common';
import { createReportSchema } from '@cerquita/validation';
import { PrismaService } from '../../prisma/prisma.service';
import { zodBody } from '../../common/zod-validation.pipe';
import { CurrentUser, type AuthenticatedUser } from '../../common/current-user.decorator';

/** User-facing reporting (spec §74). Anyone can report; moderators triage. */
@Controller('reports')
export class ReportsController {
  constructor(private readonly prisma: PrismaService) {}

  @Post()
  async create(
    @Body(zodBody(createReportSchema))
    body: {
      targetType: 'listing' | 'user' | 'store' | 'message' | 'review';
      targetId: string;
      category: string;
      detail?: string;
    },
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<{ ok: true }> {
    await this.prisma.report.create({
      data: {
        reporterId: user.userId,
        targetType: body.targetType,
        targetId: body.targetId,
        category: body.category,
        detail: body.detail,
      },
    });
    return { ok: true };
  }
}
