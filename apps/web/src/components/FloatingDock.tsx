'use client';

import Link from 'next/link';
import styles from './FloatingDock.module.css';

export type DockDestination = 'map' | 'feed' | 'chats' | 'profile';

/**
 * The floating dock, direction 1a — with 1c's feed promoted to a first-class
 * destination.
 *
 * Not a fixed bottom bar: it is inset from every edge and blurs what is behind
 * it, so the map stays visible underneath. That is the whole point of "map
 * first" — you never fully leave the map.
 *
 * Publishing is the centre button rather than a menu item, because it is the
 * single action the product most wants people to take (spec §58).
 *
 * The feed tab is the 1c contribution: it gives anyone who wants a specific
 * thing a way in that does not require exploring the map first, which is the
 * risk the board flags for 1a.
 */
export function FloatingDock({ active }: { active: DockDestination }) {
  return (
    <nav className={styles.dock} aria-label="Navegación principal">
      <DockItem href="/" label="Mapa" active={active === 'map'} shape="square" />
      <DockItem href="/feed" label="Feed" active={active === 'feed'} shape="square" />

      <Link href="/sell" className={styles.publish} aria-label="Publicar algo">
        <span aria-hidden="true">+</span>
      </Link>

      <DockItem href="/messages" label="Chats" active={active === 'chats'} shape="square" />
      <DockItem href="/account" label="Perfil" active={active === 'profile'} shape="circle" />
    </nav>
  );
}

function DockItem({
  href,
  label,
  active,
  shape,
}: {
  href: string;
  label: string;
  active: boolean;
  shape: 'square' | 'circle';
}) {
  return (
    <Link
      href={href}
      className={`${styles.item} ${active ? styles.active : ''}`}
      aria-current={active ? 'page' : undefined}
    >
      <span
        className={`${styles.icon} ${shape === 'circle' ? styles.iconCircle : ''}`}
        aria-hidden="true"
      />
      <span className={styles.label}>{label}</span>
    </Link>
  );
}
