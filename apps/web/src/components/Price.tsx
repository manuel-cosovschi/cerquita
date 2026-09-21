import type { ResolvedPrice } from '@cerquita/types';
import { formatMoney, money } from '@cerquita/utils';
import styles from './Price.module.css';

export interface PriceProps {
  price: ResolvedPrice;
  size?: 'sm' | 'md' | 'lg';
}

/**
 * Displays the price this viewer is entitled to (spec §23).
 *
 * When a social discount or promotion applies, the list price is shown struck
 * through next to it — the saving is the point, and hiding the original makes
 * the discount unverifiable.
 *
 * This component only renders what the server resolved. It never computes a
 * price, so the UI cannot disagree with what checkout will charge.
 */
export function Price({ price, size = 'md' }: PriceProps) {
  const effective = money(price.effective.amount, price.effective.currency);
  const list = money(price.list.amount, price.list.currency);
  const discounted = price.discountBasisPoints > 0;

  return (
    <span className={`${styles.wrapper} ${styles[size]}`}>
      <span className={`${styles.effective} numeric`}>{formatMoney(effective)}</span>

      {discounted && (
        <>
          <s className={`${styles.list} numeric`}>{formatMoney(list)}</s>
          <span className={styles.badge}>
            −{Math.round(price.discountBasisPoints / 100)}%
            <span className="sr-only"> de descuento{tierSuffix(price.tier)}</span>
          </span>
        </>
      )}
    </span>
  );
}

function tierSuffix(tier: ResolvedPrice['tier']): string {
  switch (tier) {
    case 'friend':
      return ' por ser amigo del vendedor';
    case 'follower':
      return ' por seguir al vendedor';
    default:
      return '';
  }
}

/**
 * The seller-facing price ladder: what each audience pays. Shown on the seller's
 * own listing and in the publish flow so the configuration is legible.
 */
export function SocialPriceLadder({
  publicPrice,
  followerPrice,
  friendPrice,
}: {
  publicPrice: ResolvedPrice['list'];
  followerPrice?: ResolvedPrice['effective'];
  friendPrice?: ResolvedPrice['effective'];
}) {
  const rows: Array<[string, ResolvedPrice['list']]> = [['Público', publicPrice]];
  if (followerPrice) rows.push(['Seguidores', followerPrice]);
  if (friendPrice) rows.push(['Amigos', friendPrice]);

  return (
    <dl className={styles.ladder}>
      {rows.map(([label, value]) => (
        <div key={label} className={styles.ladderRow}>
          <dt>{label}</dt>
          <dd className="numeric">{formatMoney(money(value.amount, value.currency))}</dd>
        </div>
      ))}
    </dl>
  );
}
