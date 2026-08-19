import type { ReactNode } from 'react';
import { FloatingDock, type DockDestination } from './FloatingDock';
import styles from './AppScreen.module.css';

/**
 * The shell every dock destination shares.
 *
 * It reserves space for the floating dock so content never ends up hidden
 * behind it — the one real cost of a dock over a fixed bar.
 */
export function AppScreen({
  title,
  subtitle,
  active,
  children,
}: {
  title: string;
  subtitle?: string;
  active: DockDestination;
  children: ReactNode;
}) {
  return (
    <div className={styles.screen}>
      <header className={styles.header}>
        <h1 className={styles.title}>{title}</h1>
        {subtitle && <p className={styles.subtitle}>{subtitle}</p>}
      </header>

      <main id="contenido" className={styles.body}>
        {children}
      </main>

      <FloatingDock active={active} />
    </div>
  );
}

/**
 * An empty state that offers a way forward instead of a dead end (spec §103).
 * Every screen below uses it, so "nothing here yet" always comes with an action.
 */
export function EmptyState({
  title,
  body,
  actions,
}: {
  title: string;
  body: string;
  actions?: ReactNode;
}) {
  return (
    <div className={styles.empty}>
      <p className={styles.emptyTitle}>{title}</p>
      <p className={styles.emptyBody}>{body}</p>
      {actions && <div className={styles.actions}>{actions}</div>}
    </div>
  );
}

export { styles as appScreenStyles };
