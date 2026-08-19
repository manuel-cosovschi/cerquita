import type { PricePoint } from '@cerquita/types';
import { formatMoney, money } from '@cerquita/utils';
import styles from './PriceHistory.module.css';

/**
 * Price history (spec §22).
 *
 * A timeline rather than a chart: with a handful of points, the dates and the
 * amounts are what a buyer actually wants to read, and a line chart of four
 * values adds decoration without adding information.
 */
export function PriceHistory({ points }: { points: PricePoint[] }) {
  const formatter = new Intl.DateTimeFormat('es-AR', { day: 'numeric', month: 'short' });

  return (
    <ol className={styles.timeline}>
      {points.map((point, index) => {
        const previous = points[index - 1];
        const current = money(point.price.amount, point.price.currency);
        const dropped = previous !== undefined && point.price.amount < previous.price.amount;
        const isLatest = index === points.length - 1;

        return (
          <li key={`${point.recordedAt}-${index}`} className={styles.entry}>
            <span className={styles.date}>
              {index === 0
                ? 'Publicado'
                : isLatest
                  ? 'Hoy'
                  : formatter.format(new Date(point.recordedAt))}
            </span>
            <span className={`${styles.amount} ${dropped ? styles.dropped : ''} numeric`}>
              {formatMoney(current)}
            </span>
            {dropped && (
              <span className={styles.delta} aria-label="Bajó de precio">
                ↓
              </span>
            )}
          </li>
        );
      })}
    </ol>
  );
}
