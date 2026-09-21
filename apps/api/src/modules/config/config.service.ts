import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Operator-tunable platform settings (spec §78, §79).
 *
 * Commission rates, radii and auction limits live in the database so an
 * administrator can change them without a deploy. Values are cached briefly —
 * they are read on nearly every request, and a few seconds of staleness after an
 * admin edit is an acceptable trade for not querying them constantly.
 */
@Injectable()
export class ConfigService {
  private cache?: { value: GlobalSettings; expiresAt: number };
  private flagCache?: { value: Record<string, FlagState>; expiresAt: number };

  private static readonly TTL_MS = 15_000;

  constructor(private readonly prisma: PrismaService) {}

  async settings(): Promise<GlobalSettings> {
    if (this.cache && this.cache.expiresAt > Date.now()) return this.cache.value;

    const row = await this.prisma.globalConfig.upsert({
      where: { id: 1 },
      update: {},
      create: { id: 1 },
    });

    const value: GlobalSettings = {
      platformFeeBasisPoints: row.platformFeeBasisPoints,
      maxSearchRadiusMeters: row.maxSearchRadiusMeters,
      defaultReservationMinutes: row.defaultReservationMinutes,
      maxAuctionDurationDays: row.maxAuctionDurationDays,
      publicLocationFuzzMeters: row.publicLocationFuzzMeters,
      prohibitedKeywords: row.prohibitedKeywords,
    };

    this.cache = { value, expiresAt: Date.now() + ConfigService.TTL_MS };
    return value;
  }

  async platformFeeBasisPoints(): Promise<number> {
    return (await this.settings()).platformFeeBasisPoints;
  }

  async publicLocationFuzzMeters(): Promise<number> {
    return (await this.settings()).publicLocationFuzzMeters;
  }

  async defaultReservationMinutes(): Promise<number> {
    return (await this.settings()).defaultReservationMinutes;
  }

  invalidate(): void {
    this.cache = undefined;
    this.flagCache = undefined;
  }

  /**
   * Feature flags with percentage rollout.
   *
   * The rollout bucket is a hash of the flag key and the user id, so a user in
   * the first 10% of one flag is not automatically in the first 10% of every
   * other flag, and their bucket does not change between requests.
   */
  async isEnabled(key: string, userId?: string): Promise<boolean> {
    const flags = await this.flags();
    const flag = flags[key];
    if (!flag || !flag.enabled) return false;
    if (flag.rolloutPercent >= 100) return true;
    if (!userId) return false;
    return bucketOf(`${key}:${userId}`) < flag.rolloutPercent;
  }

  async flags(): Promise<Record<string, FlagState>> {
    if (this.flagCache && this.flagCache.expiresAt > Date.now()) return this.flagCache.value;

    const rows = await this.prisma.featureFlag.findMany();
    const value: Record<string, FlagState> = {};
    for (const row of rows) {
      value[row.key] = { enabled: row.enabled, rolloutPercent: row.rolloutPercent };
    }

    this.flagCache = { value, expiresAt: Date.now() + ConfigService.TTL_MS };
    return value;
  }
}

export interface GlobalSettings {
  platformFeeBasisPoints: number;
  maxSearchRadiusMeters: number;
  defaultReservationMinutes: number;
  maxAuctionDurationDays: number;
  publicLocationFuzzMeters: number;
  prohibitedKeywords: string[];
}

export interface FlagState {
  enabled: boolean;
  rolloutPercent: number;
}

function bucketOf(seed: string): number {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash % 100;
}
