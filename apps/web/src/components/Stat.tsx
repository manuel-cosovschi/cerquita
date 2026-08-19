import styles from './Stat.module.css';

export interface StatProps {
  value: number;
  /** The label as it reads for any count other than one. */
  label: string;
  /**
   * The label for exactly one. Omit for figures that are not counts — a rating
   * is an average, and "1 reputación" would be nonsense either way.
   */
  one?: string;
}

/**
 * One number with its name under it, as used on profiles and storefronts.
 *
 * Shared because the two copies had already drifted into the same bug: both
 * hard-coded the plural, so a seller with a single review read "1 RESEÑAS" and
 * a shop with one thing for sale read "1 PUBLICACIONES". Those are ordinary
 * states, not edge cases — everybody passes through them on the way up.
 */
export function Stat({ value, label, one }: StatProps) {
  return (
    <div className={styles.stat}>
      <span className={styles.statValue}>{value}</span>
      <span className={styles.statLabel}>{value === 1 && one ? one : label}</span>
    </div>
  );
}
