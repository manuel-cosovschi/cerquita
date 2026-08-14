import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { moderationActionSchema, resolveDisputeSchema, updateGlobalConfigSchema } from '@cerquita/validation';
import { AdminService } from './admin.service';
import { zodBody } from '../../common/zod-validation.pipe';
import { CurrentUser, type AuthenticatedUser } from '../../common/current-user.decorator';

const resolveReportSchema = z.object({ resolution: z.enum(['actioned', 'dismissed']) });

/**
 * Admin surface. Every route checks an admin role; there is no path here that a
 * regular authenticated user can reach.
 */
@Controller('admin')
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get('dashboard')
  dashboard(@CurrentUser() user: AuthenticatedUser) {
    return this.admin.dashboard(user);
  }

  @Get('reports')
  reports(@CurrentUser() user: AuthenticatedUser, @Query('status') status?: string) {
    return this.admin.listReports(user, status ?? 'open');
  }

  @Post('reports/:id/resolve')
  resolveReport(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(resolveReportSchema)) body: { resolution: 'actioned' | 'dismissed' },
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.admin.resolveReport(id, body.resolution, user);
  }

  /** Moderation. `reason` is required — it goes straight into the audit log. */
  @Post('moderate')
  moderate(
    @Body(zodBody(moderationActionSchema)) body: Parameters<AdminService['moderate']>[0],
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.admin.moderate(body, user);
  }

  @Get('disputes')
  disputes(@CurrentUser() user: AuthenticatedUser) {
    return this.admin.listDisputes(user);
  }

  @Post('disputes/:id/resolve')
  resolveDispute(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(resolveDisputeSchema)) body: Parameters<AdminService['resolveDispute']>[1],
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.admin.resolveDispute(id, body, user);
  }

  @Get('users/:id/risk')
  risk(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.admin.assessUser(id, user);
  }

  @Get('audit-log')
  auditLog(@CurrentUser() user: AuthenticatedUser, @Query('targetId') targetId?: string) {
    return this.admin.auditLog(user, targetId);
  }

  @Get('config/flags')
  flags(@CurrentUser() user: AuthenticatedUser) {
    return this.admin.featureFlags(user);
  }

  @Patch('config')
  updateConfig(
    @Body(zodBody(updateGlobalConfigSchema)) body: Record<string, unknown>,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.admin.updateGlobalConfig(body, user);
  }
}
