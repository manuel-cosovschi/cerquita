/**
 * Risk scoring (spec §76).
 *
 * Explicitly advisory. This module produces a score and the signals behind it so
 * a human moderator can act; it takes no automatic irreversible action, which is
 * what the spec asks for. Every signal carries its own explanation so the admin
 * UI can show *why* a score is high rather than an unexplained number.
 */

import type { UUID } from '@cerquita/types';
import { DAY_MS } from '@cerquita/utils';

export type RiskSignalCode =
  | 'new_account'
  | 'abnormal_listing_volume'
  | 'price_far_below_market'
  | 'multiple_reports'
  | 'spam_content'
  | 'high_cancellation_rate'
  | 'payment_failures'
  | 'shared_device_fingerprint';

export interface RiskSignal {
  readonly code: RiskSignalCode;
  /** 0-100 contribution before weighting. */
  readonly severity: number;
  readonly explanation: string;
}

export interface RiskInputs {
  readonly userId: UUID;
  readonly accountCreatedAt: Date;
  readonly listingsLast24h: number;
  readonly reportsLast30d: number;
  readonly cancelledOrders: number;
  readonly totalOrders: number;
  readonly failedPayments: number;
  readonly distinctDevicesLast7d: number;
  /**
   * Ratio of the user's median listing price to the category median.
   * `0.2` means they list at a fifth of the going rate.
   */
  readonly priceRatioToCategoryMedian?: number;
  readonly duplicateContentRatio?: number;
  readonly now: Date;
}

const WEIGHTS: Record<RiskSignalCode, number> = {
  new_account: 0.8,
  abnormal_listing_volume: 1.0,
  price_far_below_market: 1.2,
  multiple_reports: 1.5,
  spam_content: 1.0,
  high_cancellation_rate: 1.1,
  payment_failures: 1.0,
  shared_device_fingerprint: 0.7,
};

export interface RiskAssessment {
  /** 0-100. Higher is riskier. */
  readonly score: number;
  readonly signals: RiskSignal[];
  readonly band: 'low' | 'medium' | 'high';
}

export function assessRisk(inputs: RiskInputs): RiskAssessment {
  const signals: RiskSignal[] = [];

  const accountAgeDays = (inputs.now.getTime() - inputs.accountCreatedAt.getTime()) / DAY_MS;
  if (accountAgeDays < 7) {
    signals.push({
      code: 'new_account',
      severity: Math.round(clamp01((7 - accountAgeDays) / 7) * 100),
      explanation: `La cuenta tiene ${Math.max(0, Math.floor(accountAgeDays))} días`,
    });
  }

  if (inputs.listingsLast24h > 20) {
    signals.push({
      code: 'abnormal_listing_volume',
      severity: Math.round(clamp01((inputs.listingsLast24h - 20) / 60) * 100),
      explanation: `${inputs.listingsLast24h} publicaciones en 24 horas`,
    });
  }

  const priceRatio = inputs.priceRatioToCategoryMedian;
  if (priceRatio !== undefined && priceRatio < 0.4) {
    signals.push({
      code: 'price_far_below_market',
      severity: Math.round(clamp01((0.4 - priceRatio) / 0.4) * 100),
      explanation: `Publica a ${Math.round(priceRatio * 100)}% de la mediana de la categoría`,
    });
  }

  if (inputs.reportsLast30d > 0) {
    signals.push({
      code: 'multiple_reports',
      severity: Math.round(clamp01(inputs.reportsLast30d / 5) * 100),
      explanation: `${inputs.reportsLast30d} reportes en 30 días`,
    });
  }

  const duplicateRatio = inputs.duplicateContentRatio ?? 0;
  if (duplicateRatio > 0.5) {
    signals.push({
      code: 'spam_content',
      severity: Math.round(clamp01((duplicateRatio - 0.5) / 0.5) * 100),
      explanation: `${Math.round(duplicateRatio * 100)}% de las publicaciones son duplicadas`,
    });
  }

  if (inputs.totalOrders >= 5) {
    const cancellationRate = inputs.cancelledOrders / inputs.totalOrders;
    if (cancellationRate > 0.25) {
      signals.push({
        code: 'high_cancellation_rate',
        severity: Math.round(clamp01((cancellationRate - 0.25) / 0.75) * 100),
        explanation: `${Math.round(cancellationRate * 100)}% de las órdenes canceladas`,
      });
    }
  }

  if (inputs.failedPayments >= 3) {
    signals.push({
      code: 'payment_failures',
      severity: Math.round(clamp01(inputs.failedPayments / 10) * 100),
      explanation: `${inputs.failedPayments} pagos fallidos`,
    });
  }

  if (inputs.distinctDevicesLast7d > 5) {
    signals.push({
      code: 'shared_device_fingerprint',
      severity: Math.round(clamp01((inputs.distinctDevicesLast7d - 5) / 10) * 100),
      explanation: `${inputs.distinctDevicesLast7d} dispositivos distintos en 7 días`,
    });
  }

  // Weighted mean over the maximum possible weighted total, so adding a new
  // signal type does not silently deflate every existing score.
  const weightedSum = signals.reduce(
    (acc, signal) => acc + signal.severity * WEIGHTS[signal.code],
    0,
  );
  const maxWeight = Object.values(WEIGHTS).reduce((acc, weight) => acc + weight, 0) * 100;
  const score = Math.round(clamp01(weightedSum / maxWeight) * 100);

  return {
    score,
    signals,
    band: score >= 60 ? 'high' : score >= 30 ? 'medium' : 'low',
  };
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}
